import pool from './db.js';
import { loadConfig } from './config.js';
import { sfQuery } from './snowflake.js';
import { logger } from './logger.js';

/**
 * Single entry point for Cortex calls: model allow-list, input cap, per-user rate
 * limit and usage logging (mdm.ai_usage_log). Prompts are passed as bind variables.
 */
export interface AiSettings {
  completionModel: string;
  embeddingModel: string;
  allowedModels: string[];
  maxInputChars: number;
  rateLimitPerMinute: number;
}

const DEFAULTS: AiSettings = {
  completionModel: 'mistral-large2',
  embeddingModel: 'e5-base-v2',
  allowedModels: ['mistral-large2', 'llama3.1-70b', 'llama3.1-8b', 'snowflake-arctic', 'e5-base-v2', 'snowflake-arctic-embed-m'],
  maxInputChars: 20_000,
  rateLimitPerMinute: 30,
};

export function aiSettings(): AiSettings {
  const cfg = (loadConfig() as unknown as { ai?: Partial<AiSettings> }).ai || {};
  return { ...DEFAULTS, ...cfg };
}

export class AiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function pickModel(requested: string | undefined, kind: 'completion' | 'embedding'): string {
  const s = aiSettings();
  const model = requested || (kind === 'completion' ? s.completionModel : s.embeddingModel);
  if (!s.allowedModels.includes(model)) throw new AiError(400, `Model not allowed: ${model}`);
  return model;
}

// ── Rate limiting (per user, sliding one-minute window, all AI endpoints combined) ──
const calls = new Map<string, number[]>();

export function checkRateLimit(user: string, cost = 1) {
  const limit = aiSettings().rateLimitPerMinute;
  const now = Date.now();
  const recent = (calls.get(user) || []).filter(t => now - t < 60_000);
  if (recent.length + cost > limit) {
    calls.set(user, recent);
    throw new AiError(429, `AI rate limit reached (${limit} calls per minute). Try again shortly.`);
  }
  for (let i = 0; i < cost; i++) recent.push(now);
  calls.set(user, recent);
}

async function logUsage(user: string, endpoint: string, model: string, inputChars: number, ms: number, ok: boolean) {
  await pool.query(
    `INSERT INTO mdm.ai_usage_log (user_email, endpoint, model, input_chars, duration_ms, ok, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())`,
    [user || null, endpoint, model, inputChars, ms, ok],
  ).catch(e => logger.warn({ err: e }, 'ai_usage_log insert failed'));
}

interface CallCtx { user: string; endpoint: string }

async function tracked<T>(ctx: CallCtx, model: string, inputChars: number, fn: () => Promise<T>): Promise<T> {
  if (inputChars > aiSettings().maxInputChars) throw new AiError(413, `Input too large for AI (${inputChars} > ${aiSettings().maxInputChars} characters)`);
  const t0 = Date.now();
  try {
    const out = await fn();
    await logUsage(ctx.user, ctx.endpoint, model, inputChars, Date.now() - t0, true);
    return out;
  } catch (e) {
    await logUsage(ctx.user, ctx.endpoint, model, inputChars, Date.now() - t0, false);
    throw e;
  }
}

/** Rate limit is charged by the caller once per HTTP request (checkRateLimit); this only logs. */
export async function complete(ctx: CallCtx, prompt: string, model?: string): Promise<string> {
  const m = pickModel(model, 'completion');
  return tracked(ctx, m, prompt.length, async () => {
    const rows = await sfQuery('SELECT SNOWFLAKE.CORTEX.COMPLETE(?, ?) AS RESULT', undefined, [m, prompt]);
    return String(rows[0]?.RESULT ?? '');
  });
}

export async function embed(ctx: CallCtx, texts: string[], model?: string): Promise<number[][]> {
  const m = pickModel(model, 'embedding');
  if (texts.length === 0) return [];
  const chars = texts.reduce((n, t) => n + t.length, 0);
  return tracked(ctx, m, chars, async () => {
    const selects = texts.map((_, i) => `SNOWFLAKE.CORTEX.EMBED_TEXT_768(?, ?)::ARRAY AS E${i}`).join(', ');
    const binds = texts.flatMap(t => [m, t]);
    const rows = await sfQuery(`SELECT ${selects}`, undefined, binds);
    return texts.map((_, i) => {
      const v = rows[0]?.[`E${i}`];
      return (typeof v === 'string' ? JSON.parse(v) : v) as number[];
    });
  });
}

/** Translate several values in one statement. Keys must already be validated identifiers. */
export async function translateMany(ctx: CallCtx, values: Record<string, string>, from: string, to: string): Promise<Record<string, string>> {
  const keys = Object.keys(values);
  if (keys.length === 0) return {};
  const chars = keys.reduce((n, k) => n + values[k].length, 0);
  return tracked(ctx, 'translate', chars, async () => {
    const selects = keys.map(k => `SNOWFLAKE.CORTEX.TRANSLATE(?, ?, ?) AS "${k.toUpperCase()}"`).join(', ');
    const binds = keys.flatMap(k => [values[k], from, to]);
    const rows = await sfQuery(`SELECT ${selects}`, undefined, binds);
    return Object.fromEntries(keys.map(k => [k, String(rows[0]?.[k.toUpperCase()] ?? '')]));
  });
}

/** First JSON object/array in an LLM response, or undefined. */
export function extractJson<T>(raw: string, kind: 'object' | 'array' = 'object'): T | undefined {
  const m = raw.match(kind === 'object' ? /\{[\s\S]*\}/ : /\[[\s\S]*\]/);
  if (!m) return undefined;
  try { return JSON.parse(m[0]) as T; } catch { return undefined; }
}
