import { Router } from 'express';
import { userDb } from '../db.js';
import { asyncHandler } from '../asyncHandler.js';
import { entityInfo } from '../modules/entities.js';

const router = Router();

// Profiles are cached per module and caller (RLS scopes what each user sees). An entry is
// reused while the caller's fingerprint (visible row count + last update) is unchanged.
interface CacheEntry { fingerprint: string; computedAt: string; body: Record<string, unknown> }
const cache = new Map<string, CacheEntry>();
const MAX_ENTRIES = 200;

export function clearProfilingCache() { cache.clear(); }

// GET /api/profiling/:entity_type[?refresh=1] — column-level profiling stats
router.get('/:entity_type', asyncHandler(async (req, res) => {
  const email = req.headers['x-mdm-user'] as string;
  // Profiles only the rows the caller can see (Postgres RLS)
  const pool = userDb(email);
  const ent = entityInfo(req.params.entity_type);
  const table = ent.table;
  // Profile the module's active scalar fields
  const fields = ent.mod.fields
    .filter(f => f.active !== false && ['text', 'number', 'ref', 'date', 'uuid'].includes(f.type) && /^[a-z_][a-z0-9_]*$/.test(f.name));
  const fieldsKey = fields.map(f => `${f.name}:${f.type}`).join(',');

  const fp = (await pool.query(
    `SELECT COUNT(*)::int AS n, COALESCE(MAX(updated_at)::text, '') AS last FROM ${table}`,
  )).rows[0];
  const fingerprint = `${fp.n}|${fp.last}|${fieldsKey}`;
  const key = `${ent.type}|${email}`;
  const hit = cache.get(key);
  if (hit && hit.fingerprint === fingerprint && req.query.refresh !== '1') {
    return res.json({ ...hit.body, computed_at: hit.computedAt, cached: true });
  }

  // One aggregate pass for every column's basic stats
  const total = (await pool.query(`SELECT COUNT(*)::int AS total FROM ${table} WHERE is_deleted = false`)).rows[0].total;
  const statsRow = fields.length ? (await pool.query(`
    SELECT ${fields.map((f, i) => `
      COUNT(${f.name})::int AS nn_${i},
      COUNT(DISTINCT ${f.name})::int AS d_${i},
      MIN(LENGTH(${f.name}::text))::int AS minl_${i},
      MAX(LENGTH(${f.name}::text))::int AS maxl_${i},
      ROUND(AVG(LENGTH(${f.name}::text)), 1)::float AS avgl_${i}`).join(',')}
    FROM ${table} WHERE is_deleted = false
  `)).rows[0] : {};

  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);
  // Per-column distributions run concurrently
  const profiles = await Promise.all(fields.map(async (f, i) => {
    const col = f.name;
    const numeric = f.type === 'number';
    const [topValues, detail] = await Promise.all([
      pool.query(`
        SELECT ${col}::text AS value, COUNT(*)::int AS count
        FROM ${table}
        WHERE is_deleted = false AND ${col} IS NOT NULL
        GROUP BY ${col}
        ORDER BY count DESC, value
        LIMIT 5`),
      numeric
        ? pool.query(`
          SELECT
            MIN(${col})::float AS min_val,
            MAX(${col})::float AS max_val,
            ROUND(AVG(${col})::numeric, 2)::float AS avg_val,
            ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${col})::numeric, 2)::float AS median_val,
            ROUND(STDDEV(${col})::numeric, 2)::float AS stddev_val
          FROM ${table}
          WHERE is_deleted = false AND ${col} IS NOT NULL`)
        // Pattern detection (for non-numeric columns)
        : pool.query(`
          SELECT
            REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(${col}::text, '[A-Z]', 'A', 'g'), '[a-z]', 'a', 'g'), '[0-9]', '9', 'g') AS pattern,
            COUNT(*)::int AS count
          FROM ${table}
          WHERE is_deleted = false AND ${col} IS NOT NULL
          GROUP BY pattern
          ORDER BY count DESC
          LIMIT 5`),
    ]);
    const nonNull = statsRow[`nn_${i}`] ?? 0;
    const distinct = statsRow[`d_${i}`] ?? 0;
    return {
      column: col,
      total_rows: total,
      non_null: nonNull,
      null_count: total - nonNull,
      null_pct: pct(total - nonNull, total),
      distinct_count: distinct,
      uniqueness_pct: pct(distinct, nonNull),
      min_length: statsRow[`minl_${i}`],
      max_length: statsRow[`maxl_${i}`],
      avg_length: statsRow[`avgl_${i}`],
      top_values: topValues.rows,
      patterns: numeric ? [] : detail.rows,
      numeric_stats: numeric ? detail.rows[0] : null,
    };
  }));

  const body = { entity_type: ent.type, total_records: total, columns: profiles };
  const computedAt = new Date().toISOString();
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
  cache.set(key, { fingerprint, computedAt, body });
  res.json({ ...body, computed_at: computedAt, cached: false });
}));

export default router;
