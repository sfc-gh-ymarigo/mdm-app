// ============================================================
// Matching engine — set-based candidate generation in Postgres.
//
// Pairs are generated with index-friendly joins (equality, pg_trgm `%`, phonetic code hash joins)
// instead of comparing every pair in JS, optionally restricted to blocks (`matching.blocking`:
// columns that must be equal on both sides, e.g. country_code). Candidates are written with one
// INSERT … SELECT per stage; the partial unique index on unordered PENDING pairs (migration 019)
// replaces the in-memory "existing pairs" set.
// ============================================================
import crypto from 'crypto';
import type pg from 'pg';
import { assertIdent } from './sqlGuard.js';
import { complete, embed } from './cortex.js';
import type { ModuleConfig } from './modules/types.js';
import { logger } from './logger.js';

type Client = pg.PoolClient;
type MatchCfg = NonNullable<ModuleConfig['matching']>;

const ON_PENDING_PAIR = `ON CONFLICT (entity_type, LEAST(entity_id_a, entity_id_b), GREATEST(entity_id_a, entity_id_b)) WHERE status = 'PENDING'`;
const INSERT_COLS = 'INSERT INTO mdm.match_candidate (entity_type, entity_id_a, entity_id_b, match_score, match_method, match_fields)';

export interface StageCounts { exact_keys: number; fuzzy: number; phonetic: number; composite: number; address: number }

async function tableColumns(client: Client, table: string): Promise<Set<string>> {
  const [schema, name] = table.split('.');
  const r = await client.query('SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2', [schema, name]);
  return new Set(r.rows.map((x: { column_name: string }) => x.column_name));
}

/** Validated blocking columns for a module (only columns that exist on the table). */
function blockingColumns(cfg: MatchCfg, cols: Set<string>): string[] {
  return (cfg.blocking ?? []).map(c => assertIdent(c, 'blocking column')).filter(c => cols.has(c));
}

const blockSql = (block: string[], a = 'a', b = 'b') => block.map(c => ` AND ${a}.${c} IS NOT DISTINCT FROM ${b}.${c}`).join('');

/** Runs fn in a transaction (needed for SET LOCAL similarity thresholds). */
async function tx<T>(client: Client, fn: () => Promise<T>): Promise<T> {
  await client.query('BEGIN');
  try { const r = await fn(); await client.query('COMMIT'); return r; }
  catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
}

/**
 * Candidate pairs for a text column via rare-token blocking: each value is split into words, and
 * each word plus its 4-character prefix (catches suffix typos) becomes a blocking key. Keys held by
 * more than `maxDf` records ("company", "sa", "gmbh") are dropped, and records sharing a remaining
 * key are paired with a hash join. The pair count is then bounded by keys × maxDf² instead of
 * N² — a `a.col % b.col` trigram self-join is quadratic when values share common words.
 * Pairs are emitted once as (id_a < id_b); callers score them.
 */
const tokenPairs = (table: string, col: string, maxDf: number, block: string[]) => {
  const blockCols = block.map(c => `, ${c}`).join('');
  return `(WITH w AS (SELECT id${blockCols}, regexp_split_to_table(lower(${col}::text), '[^[:alnum:]]+') AS word
                  FROM ${table} WHERE is_deleted = false AND ${col} IS NOT NULL),
          t AS (SELECT DISTINCT id${blockCols}, k FROM w,
                  LATERAL (VALUES (word), (CASE WHEN length(word) > 4 THEN 'p:' || left(word, 4) END)) v(k)
                 WHERE length(word) >= 2 AND k IS NOT NULL),
          kept AS MATERIALIZED (SELECT * FROM (SELECT t.*, count(*) OVER (PARTITION BY k) AS df FROM t) x
                                 WHERE df BETWEEN 2 AND ${maxDf})
     SELECT DISTINCT a.id AS id_a, b.id AS id_b
       FROM kept a JOIN kept b ON a.k = b.k AND a.id < b.id${blockSql(block)})`;
};

/** Text-typed columns (trigram operators and indexes apply to these without a cast). */
async function textColumns(client: Client, table: string): Promise<Set<string>> {
  const [schema, name] = table.split('.');
  const r = await client.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2 AND data_type IN ('text', 'character varying')`, [schema, name]);
  return new Set(r.rows.map((x: { column_name: string }) => x.column_name));
}

const setTrgmThreshold = (client: Client, t: number) =>
  client.query(`SELECT set_config('pg_trgm.similarity_threshold', $1, true)`, [String(Math.min(1, Math.max(0, t)))]);

/** Runs the deterministic + fuzzy stages for one module; returns counts and per-stage timings (ms). */
export async function scanModule(client: Client, mod: ModuleConfig, shouldRun: (k: string) => boolean, ctx: { user: string }) {
  const cfg = mod.matching!;
  const methods = cfg.methods ?? {};
  const eType = mod.id.toUpperCase();
  const table = mod.table;
  const nameCol = assertIdent(mod.name_field, 'name field');
  const cols = await tableColumns(client, table);
  const block = blockingColumns(cfg, cols);
  const cap = Math.min(Math.max(cfg.max_candidates ?? 1000, 1), 20000);
  const maxDf = Math.min(Math.max(cfg.max_token_frequency ?? 50, 2), 1000);
  const textCols = await textColumns(client, table);
  const counts: StageCounts = { exact_keys: 0, fuzzy: 0, phonetic: 0, composite: 0, address: 0 };
  const timings: Record<string, number> = {};
  const live = (alias: string) => `${alias}.is_deleted = false`;
  const time = async (stage: string, fn: () => Promise<void>) => {
    const t0 = Date.now();
    await fn();
    timings[stage] = Date.now() - t0;
  };

  // ── STAGE 0: exact keys (equality join) ──
  if (shouldRun('exact_keys') && methods.exact_keys?.enabled && methods.exact_keys.keys.length > 0) {
    await time('exact_keys', async () => {
      for (const key of methods.exact_keys!.keys.map(k => assertIdent(k, 'match key')).filter(k => cols.has(k))) {
        const r = await client.query(
          `${INSERT_COLS}
           SELECT $1, a.id, b.id, 99, 'EXACT_KEY', jsonb_build_object('matched_key', $2::text, 'key_value', a.${key})
             FROM ${table} a JOIN ${table} b ON a.${key} = b.${key} AND a.id < b.id${blockSql(block)}
            WHERE ${live('a')} AND ${live('b')} AND a.${key} IS NOT NULL AND a.${key}::text <> ''
            LIMIT ${cap}
           ${ON_PENDING_PAIR} DO NOTHING`, [eType, key]);
        counts.exact_keys += r.rowCount ?? 0;
      }
    });
  }

  // ── STAGE 1: fuzzy name (rare-token blocking, scored with pg_trgm similarity) ──
  if (shouldRun('fuzzy') && methods.fuzzy?.enabled !== false) {
    const col = assertIdent(methods.fuzzy?.name_field ?? nameCol, 'match name field');
    const threshold = Math.min(1, Math.max(0, Number(methods.fuzzy?.threshold ?? 0.4)));
    if (textCols.has(col)) await time('fuzzy', async () => {
      const r = await client.query(
        `${INSERT_COLS}
         SELECT $1, id_a, id_b, score, 'FUZZY', jsonb_build_object($2::text, score / 100) FROM (
           SELECT p.id_a, p.id_b, ROUND((similarity(a.${col}, b.${col}) * 100)::numeric, 2) AS score
             FROM ${tokenPairs(table, col, maxDf, block)} p
             JOIN ${table} a ON a.id = p.id_a JOIN ${table} b ON b.id = p.id_b
            WHERE similarity(a.${col}, b.${col}) >= $3
            ORDER BY score DESC LIMIT ${cap}) x
         ${ON_PENDING_PAIR} DO NOTHING`, [eType, `${col}_similarity`, threshold]);
      counts.fuzzy = r.rowCount ?? 0;
    });
  }

  // ── STAGE 2: phonetic (double metaphone codes computed once per row, hash join on the primary field) ──
  if (shouldRun('phonetic') && methods.phonetic?.enabled && methods.phonetic.fields.length > 0) {
    const fields = methods.phonetic.fields.map(f => assertIdent(f, 'phonetic field')).filter(f => cols.has(f));
    if (fields.length) await time('phonetic', async () => {
      const codes = fields.map((f, i) => `NULLIF(mdm.dmetaphone(${f}::text), '') AS p${i}`).join(', ');
      const blockCols = block.map(c => `, ${c}`).join('');
      const matched = fields.map((_, i) => `COALESCE(a.p${i} = b.p${i}, false)::int`).join(' + ');
      const detail = fields.map((f, i) => `'${f}', CASE WHEN a.p${i} = b.p${i} THEN a.p${i} END`).join(', ');
      const r = await client.query(
        `WITH c AS MATERIALIZED (SELECT id${blockCols}, ${codes} FROM ${table} WHERE is_deleted = false)
         ${INSERT_COLS}
         SELECT $1, a.id, b.id, GREATEST(65, ROUND(100.0 * (${matched}) / ${fields.length})),
                'PHONETIC', jsonb_build_object('phonetic_matches', jsonb_strip_nulls(jsonb_build_object(${detail})))
           FROM c a JOIN c b ON a.p0 = b.p0 AND a.id < b.id${blockSql(block)}
          LIMIT ${cap}
         ${ON_PENDING_PAIR} DO NOTHING`, [eType]);
      counts.phonetic = r.rowCount ?? 0;
    });
  }

  // ── STAGE 3: composite weighted rules (candidates from per-rule index joins, scored in SQL) ──
  if (shouldRun('composite') && methods.composite?.enabled !== false) {
    const threshold = methods.composite?.threshold ?? 60;
    const rules = ((methods.composite?.rules ?? []) as { field: string; weight: number; compare: string; min_sim?: number }[])
      .map(r => ({ ...r, field: assertIdent(r.field, 'composite field'), weight: Number(r.weight) || 0, min_sim: Number(r.min_sim ?? 0.3) }))
      .filter(r => cols.has(r.field));
    if (rules.length) await time('composite', () => tx(client, async () => {
      const trigram = rules.filter(r => r.compare !== 'exact');
      if (trigram.length) await setTrgmThreshold(client, Math.min(...trigram.map(r => r.min_sim)));
      const present = (f: string, x: string) => `${x}.${f} IS NOT NULL AND ${x}.${f}::text <> ''`;
      // Candidate pairs come only from rules a pair must hit to reach the threshold: rules are taken
      // by descending weight until the remaining ones together can no longer reach it. Low-weight,
      // low-cardinality rules (city, segment) then only score pairs; generating from them is
      // quadratic (every pair in the same city).
      const target = threshold / 100;
      const genRules: typeof rules = [];
      let rest = rules.reduce((sum, r) => sum + r.weight, 0);
      for (const r of [...rules].sort((x, y) => y.weight - x.weight)) {
        if (rest < target) break;
        genRules.push(r);
        rest -= r.weight;
      }
      const generators = genRules.flatMap(r => r.compare === 'exact'
        ? [`SELECT a.id AS id_a, b.id AS id_b FROM ${table} a JOIN ${table} b ON lower(a.${r.field}::text) = lower(b.${r.field}::text) AND a.id < b.id${blockSql(block)} WHERE ${live('a')} AND ${live('b')} AND ${present(r.field, 'a')}`]
        : textCols.has(r.field) ? [tokenPairs(table, r.field, maxDf, block)] : []);
      if (!generators.length) return;
      const termSql = (r: typeof rules[number], i: number) => r.compare === 'exact'
        ? `CASE WHEN ${present(r.field, 'a')} AND ${present(r.field, 'b')} AND lower(a.${r.field}::text) = lower(b.${r.field}::text) THEN 1.0 END AS s${i}`
        : `CASE WHEN ${present(r.field, 'a')} AND ${present(r.field, 'b')} AND similarity(a.${r.field}::text, b.${r.field}::text) > ${r.min_sim} THEN similarity(a.${r.field}::text, b.${r.field}::text) END AS s${i}`;
      const total = rules.map((r, i) => `COALESCE(s${i}, 0) * ${r.weight}`).join(' + ');
      const detail = rules.map((r, i) => `'${r.field}', ROUND(s${i}::numeric, 4)`).join(', ');
      const res = await client.query(
        `WITH pairs AS (${generators.join(' UNION ')}),
              scored AS (SELECT p.id_a, p.id_b, ${rules.map(termSql).join(', ')}
                           FROM pairs p JOIN ${table} a ON a.id = p.id_a JOIN ${table} b ON b.id = p.id_b),
              final AS (SELECT id_a, id_b, ROUND(((${total}) * 100)::numeric, 2) AS score,
                               jsonb_strip_nulls(jsonb_build_object(${detail})) AS fields FROM scored)
         ${INSERT_COLS}
         SELECT $1, id_a, id_b, score, 'COMPOSITE', fields FROM final WHERE score >= $2 ORDER BY score DESC LIMIT ${cap}
         ${ON_PENDING_PAIR} DO UPDATE SET match_score = GREATEST(mdm.match_candidate.match_score, EXCLUDED.match_score),
           match_method = 'COMPOSITE', match_fields = EXCLUDED.match_fields`, [eType, threshold]);
      counts.composite = res.rowCount ?? 0;
    }));
  }

  // ── STAGE 4: address — Cortex normalisation (batched), then trigram-prefiltered levenshtein in SQL ──
  if (shouldRun('address') && methods.address?.enabled && methods.address.fields.length > 0) {
    const fields = methods.address.fields.map(f => assertIdent(f, 'address field')).filter(f => cols.has(f));
    if (fields.length >= 2) await time('address', async () => {
      const parts = fields.map(f => `NULLIF(btrim(${f}::text), '')`).join(', ');
      const rows = (await client.query(
        `SELECT id, concat_ws(', ', ${parts}) AS addr FROM ${table}
          WHERE is_deleted = false AND num_nonnulls(${parts}) >= 2 LIMIT ${cap * 5}`)).rows as { id: string; addr: string }[];
      if (rows.length < 2) return;
      const normalized = new Map<string, string>();
      const batchSize = 10;
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        try {
          const prompt = `Normalize these addresses to a standard format: uppercase, no abbreviations (Street not St, Avenue not Ave), remove accents. Return ONLY a JSON array of normalized strings in the same order.\n\n${batch.map((r, j) => `${j + 1}. ${r.addr}`).join('\n')}`;
          const raw = (await complete({ user: ctx.user, endpoint: 'matches/scan:address' }, prompt, methods.llm_judge?.model)) || '[]';
          const m = raw.match(/\[[\s\S]*\]/);
          if (m) (JSON.parse(m[0]) as string[]).forEach((n, j) => { if (n && batch[j]) normalized.set(batch[j].id, String(n).toUpperCase()); });
        } catch (e) { logger.warn({ err: e }, 'address normalisation batch failed'); }
      }
      if (normalized.size < 2) return;
      const ids = [...normalized.keys()], addrs = [...normalized.values()];
      await tx(client, async () => {
        await setTrgmThreshold(client, 0.3);
        const r = await client.query(
          `WITH n AS (SELECT * FROM unnest($2::uuid[], $3::text[]) AS n(id, addr)),
                d AS (SELECT a.id AS id_a, b.id AS id_b, a.addr AS addr_a, b.addr AS addr_b,
                             mdm.levenshtein(left(a.addr, 255), left(b.addr, 255)) AS dist,
                             GREATEST(length(a.addr), length(b.addr)) AS len
                        FROM n a JOIN n b ON a.id < b.id AND a.addr % b.addr
                        JOIN ${table} ta ON ta.id = a.id JOIN ${table} tb ON tb.id = b.id${blockSql(block, 'ta', 'tb')})
           ${INSERT_COLS}
           SELECT $1, id_a, id_b, ROUND(100 * (1 - dist::numeric / len)), 'ADDRESS',
                  jsonb_build_object('address_a', addr_a, 'address_b', addr_b, 'levenshtein_distance', dist, 'similarity', ROUND(1 - dist::numeric / len, 2))
             FROM d WHERE len > 0 AND 1 - dist::numeric / len >= 0.8 LIMIT ${cap}
           ${ON_PENDING_PAIR} DO NOTHING`, [eType, ids, addrs]);
        counts.address = r.rowCount ?? 0;
      });
    });
  }

  return { counts, timings, blocking: block };
}

// ── Embeddings ──────────────────────────────────────────────────────────────

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

const contentHash = (model: string, text: string) => crypto.createHash('sha256').update(`${model}\n${text}`).digest('hex');

/**
 * Embedding similarity stage: vectors are cached per record in mdm.embedding_cache and only
 * recomputed when the embedded text changes. Pairs are compared within blocks only.
 */
export async function embeddingStage(client: Client, mod: ModuleConfig, ctx: { user: string }) {
  const cfg = mod.matching!;
  const e = cfg.methods?.embedding;
  const eType = mod.id.toUpperCase();
  const table = mod.table;
  const cols = await tableColumns(client, table);
  const block = blockingColumns(cfg, cols);
  const model = e?.model ?? 'e5-base-v2';
  const threshold = e?.threshold ?? 0.85;
  const descFields = (e?.description_fields ?? [mod.name_field]).map(f => assertIdent(f, 'description field')).filter(f => cols.has(f));
  const cap = Math.min(Math.max(cfg.max_candidates ?? 1000, 1), 20000);
  if (!descFields.length) return { inserted: 0, embedded: 0, cached: 0 };

  const rows = (await client.query(
    `SELECT id, concat_ws(' ', ${descFields.map(f => `NULLIF(${f}::text, '')`).join(', ')}) AS text${block.map(c => `, ${c}::text AS b_${c}`).join('')}
       FROM ${table} WHERE is_deleted = false`)).rows as Record<string, string>[];
  if (rows.length < 2) return { inserted: 0, embedded: 0, cached: 0 };

  const hashes = rows.map(r => contentHash(model, r.text || ''));
  const cached = new Map<string, { hash: string; vector: number[] }>();
  for (const c of (await client.query(
    `SELECT entity_id, content_hash, vector FROM mdm.embedding_cache WHERE entity_type = $1 AND model = $2 AND entity_id = ANY($3)`,
    [eType, model, rows.map(r => r.id)])).rows) cached.set(c.entity_id, { hash: c.content_hash, vector: c.vector });

  const vectors = new Map<string, number[]>();
  const missing: number[] = [];
  rows.forEach((r, i) => {
    const c = cached.get(r.id);
    if (c && c.hash === hashes[i]) vectors.set(r.id, c.vector);
    else if (r.text) missing.push(i);
  });

  for (let i = 0; i < missing.length; i += 20) {
    const batch = missing.slice(i, i + 20);
    const vecs = await embed({ user: ctx.user, endpoint: 'matches/enrich:embedding' }, batch.map(j => rows[j].text), model);
    const ids: string[] = [], hs: string[] = [], vs: string[] = [];
    batch.forEach((j, k) => {
      const v = vecs[k];
      if (!v?.length) return;
      vectors.set(rows[j].id, v);
      ids.push(rows[j].id); hs.push(hashes[j]); vs.push(`{${v.join(',')}}`);
    });
    if (ids.length) await client.query(
      `INSERT INTO mdm.embedding_cache (entity_type, entity_id, model, content_hash, vector, updated_at)
       SELECT $1, id, $2, h, v::real[], NOW() FROM unnest($3::uuid[], $4::text[], $5::text[]) AS x(id, h, v)
       ON CONFLICT (entity_type, entity_id, model) DO UPDATE SET content_hash = EXCLUDED.content_hash, vector = EXCLUDED.vector, updated_at = NOW()`,
      [eType, model, ids, hs, vs]);
  }

  // Compare within blocks
  const blocks = new Map<string, string[]>();
  for (const r of rows) {
    if (!vectors.has(r.id)) continue;
    const key = block.map(c => r[`b_${c}`] ?? '').join('|');
    blocks.set(key, [...(blocks.get(key) ?? []), r.id]);
  }
  const ida: string[] = [], idb: string[] = [], scores: number[] = [];
  for (const ids of blocks.values()) {
    for (let i = 0; i < ids.length && ida.length < cap; i++) {
      for (let j = i + 1; j < ids.length && ida.length < cap; j++) {
        const sim = cosineSimilarity(vectors.get(ids[i])!, vectors.get(ids[j])!);
        if (sim >= threshold) { ida.push(ids[i]); idb.push(ids[j]); scores.push(Math.round(sim * 10000) / 100); }
      }
    }
  }
  let inserted = 0;
  if (ida.length) {
    const r = await client.query(
      `${INSERT_COLS}
       SELECT $1, a, b, s, 'EMBEDDING', jsonb_build_object('embedding_similarity', ROUND(s / 100, 2))
         FROM unnest($2::uuid[], $3::uuid[], $4::numeric[]) AS x(a, b, s)
       ${ON_PENDING_PAIR} DO NOTHING`, [eType, ida, idb, scores]);
    inserted = r.rowCount ?? 0;
  }
  return { inserted, embedded: missing.length, cached: rows.length - missing.length };
}
