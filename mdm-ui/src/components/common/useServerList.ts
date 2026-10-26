import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { GridPaginationModel, GridSortModel } from '@mui/x-data-grid';
import type { Paged } from '../../api/client';

export const PAGE_SIZES = [10, 25, 50, 100];

/** Debounced copy of a value (search box → query). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => { const h = setTimeout(() => setV(value), ms); return () => clearTimeout(h); }, [value, ms]);
  return v;
}

/**
 * Server-side list state for a DataGrid, kept in the URL (?page=&size=&sort=field:dir).
 * `query` holds the API filter params (search, filters); changing it returns to page 0.
 * Pass the hook's grid props to DataGrid (paginationMode/sortingMode="server").
 */
export function useServerList<T>(fetchPage: (params: URLSearchParams) => Promise<Paged<T>>, query: Record<string, string | number | null | undefined>, opts: { prefix?: string; defaultSize?: number; onError?: (e: Error) => void } = {}) {
  const [params, setParams] = useSearchParams();
  const pre = opts.prefix ?? '';
  const page = Math.max(0, Number(params.get(`${pre}page`) ?? 0) || 0);
  const size = Number(params.get(`${pre}size`)) || opts.defaultSize || 25;
  const sort = params.get(`${pre}sort`) ?? '';
  const [rows, setRows] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const onError = useRef(opts.onError); onError.current = opts.onError;

  const queryKey = JSON.stringify(Object.entries(query).filter(([, v]) => v !== null && v !== undefined && v !== '').sort());
  const firstQuery = useRef(queryKey);

  const setUrl = useCallback((patch: Record<string, string | null>) => setParams(prev => {
    const n = new URLSearchParams(prev);
    for (const [k, v] of Object.entries(patch)) { if (v === null) n.delete(`${pre}${k}`); else n.set(`${pre}${k}`, v); }
    return n;
  }, { replace: true }), [setParams, pre]);

  // New filters → back to the first page (not on mount, so shared links keep their page)
  useEffect(() => {
    if (firstQuery.current === queryKey) return;
    firstQuery.current = queryKey;
    if (page !== 0) setUrl({ page: null });
  }, [queryKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    const p = new URLSearchParams(JSON.parse(queryKey) as [string, string][]);
    p.set('page', String(page)); p.set('size', String(size));
    if (sort) p.set('sort', sort);
    setLoading(true);
    fetchPage(p)
      .then(r => {
        if (cancelled) return;
        // A page past the end (stale link, rows deleted) has no window total: go back to the first page
        if (!r.rows.length && page > 0) { setUrl({ page: null }); return; }
        setRows(r.rows); setTotal(r.total);
      })
      .catch(e => { if (!cancelled) onError.current?.(e as Error); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [fetchPage, queryKey, page, size, sort, tick, setUrl]);

  const sortModel: GridSortModel = useMemo(() => {
    const [field, dir] = sort.split(':');
    return field ? [{ field, sort: dir === 'asc' ? 'asc' : 'desc' }] : [];
  }, [sort]);

  const gridProps = {
    rows, rowCount: total, loading,
    paginationMode: 'server' as const, sortingMode: 'server' as const, filterMode: 'server' as const,
    paginationModel: { page, pageSize: size } as GridPaginationModel,
    onPaginationModelChange: (m: GridPaginationModel) => setUrl({ page: m.page ? String(m.page) : null, size: m.pageSize === (opts.defaultSize || 25) ? null : String(m.pageSize) }),
    sortModel,
    onSortModelChange: (m: GridSortModel) => setUrl({ sort: m[0] ? `${m[0].field}:${m[0].sort ?? 'desc'}` : null, page: null }),
    pageSizeOptions: PAGE_SIZES,
  };

  /** All rows matching the current query (for export), fetched in pages of 500 up to `max`. */
  const fetchAll = useCallback(async (max = 50_000) => {
    const out: T[] = [];
    for (let pg = 0; out.length < max; pg++) {
      const p = new URLSearchParams(JSON.parse(queryKey) as [string, string][]);
      p.set('page', String(pg)); p.set('size', '500'); if (sort) p.set('sort', sort);
      const r = await fetchPage(p);
      out.push(...r.rows);
      if (r.rows.length < 500 || out.length >= r.total) break;
    }
    return out.slice(0, max);
  }, [fetchPage, queryKey, sort]);

  const reload = useCallback(() => setTick(x => x + 1), []);
  /** For non-DataGrid tables (e.g. MUI TablePagination). */
  const pager = {
    page, size, total,
    setPage: (pg: number) => setUrl({ page: pg ? String(pg) : null }),
    setSize: (s: number) => setUrl({ size: s === (opts.defaultSize || 25) ? null : String(s), page: null }),
  };
  return { rows, total, loading, reload, gridProps, fetchAll, pager };
}
