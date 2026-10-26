import { useState, useEffect } from 'react';

export interface RefValue {
  code: string;
  label: string;
  description?: string;
  is_active?: boolean;
  region?: string;
  symbol?: string;
  entity_type?: string;
  sort_order?: number;
}

const cache: Record<string, { data: RefValue[]; ts: number }> = {};
const CACHE_TTL = 5 * 60 * 1000;

export function useRefData(domain: string): RefValue[] {
  const [values, setValues] = useState<RefValue[]>(() => cache[domain]?.data ?? []);

  useEffect(() => {
    if (!domain) return;
    const cached = cache[domain];
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      setValues(cached.data);
      return;
    }
    let cancelled = false;
    fetch(`/api/refdata/${domain}`)
      .then(r => r.json())
      .then((data: { values: RefValue[] }) => {
        if (cancelled) return;
        const active = (data.values || []).filter(v => v.is_active !== false);
        cache[domain] = { data: active, ts: Date.now() };
        setValues(active);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [domain]);

  return values;
}
