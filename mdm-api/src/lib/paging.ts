// Server-side paging/sorting for list endpoints.
// Opt-in: responses switch to { rows, total, page, size } only when ?page is given,
// so existing callers (agent, export) keep receiving a plain array.
import type { Request } from 'express';

export interface Paging {
  paged: boolean;
  page: number;
  size: number;
  /** ORDER BY clause body, already validated against the allow-list. */
  orderBy: string;
  q?: string;
}

export const MAX_PAGE_SIZE = 500;

/**
 * @param allowed  sortable field -> SQL expression (only these can reach ORDER BY)
 * @param defaultOrder ORDER BY body used when no valid ?sort is given
 */
export function parsePaging(req: Request, allowed: Record<string, string>, defaultOrder: string): Paging {
  const paged = req.query.page !== undefined;
  const page = Math.max(0, parseInt(String(req.query.page ?? '0'), 10) || 0);
  const size = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(String(req.query.size ?? '25'), 10) || 25));
  let orderBy = defaultOrder;
  const sort = typeof req.query.sort === 'string' ? req.query.sort : '';
  if (sort) {
    const [field, dirRaw] = sort.split(':');
    const expr = allowed[field];
    if (expr) {
      const dir = dirRaw?.toLowerCase() === 'asc' ? 'ASC' : 'DESC';
      orderBy = `${expr} ${dir} NULLS LAST, ${defaultOrder}`;
    }
  }
  const qRaw = req.query.q ?? req.query.search;
  const q = typeof qRaw === 'string' && qRaw.trim() ? qRaw.trim() : undefined;
  return { paged, page, size, orderBy, q };
}

/** Appends ORDER BY + LIMIT/OFFSET (when paged) and a window total column. */
export function pagedSql(selectSql: string, p: Paging, params: unknown[]): string {
  // selectSql must start with "SELECT " — inject the window count right after it.
  const withTotal = p.paged ? selectSql.replace(/^\s*SELECT\s/i, 'SELECT COUNT(*) OVER() AS __total, ') : selectSql;
  let sql = `${withTotal} ORDER BY ${p.orderBy}`;
  if (p.paged) {
    params.push(p.size, p.page * p.size);
    sql += ` LIMIT $${params.length - 1} OFFSET $${params.length}`;
  }
  return sql;
}

/** Shapes the response: plain array when not paged, envelope otherwise. */
export function pagedResult<T extends Record<string, unknown>>(rows: T[], p: Paging) {
  if (!p.paged) return rows;
  const total = rows.length ? Number(rows[0].__total) : 0;
  for (const r of rows) delete r.__total;
  return { rows, total, page: p.page, size: p.size };
}

/** Wraps a full query (e.g. UNION) so paging can be applied on top. */
export function wrap(sql: string): string {
  return `SELECT * FROM (${sql}) __w`;
}

const STD_COLS = ['id', 'source_system', 'lifecycle_stage', 'golden_id', 'dq_score', 'completeness', 'created_at', 'updated_at', 'created_by', 'updated_by'];

/** Sort allow-list for a module table: standard columns + configured fields + extras. */
export function moduleSortMap(fields: string[], alias: string, extra: Record<string, string> = {}): Record<string, string> {
  const m: Record<string, string> = {};
  for (const c of [...STD_COLS, ...fields]) if (/^[a-z_][a-z0-9_]*$/.test(c)) m[c] = `${alias}.${c}`;
  return { ...m, ...extra };
}
