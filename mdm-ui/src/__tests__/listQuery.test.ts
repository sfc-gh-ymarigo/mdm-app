import { describe, it, expect, vi } from 'vitest';

vi.mock('../i18n', () => ({ default: { language: 'en' }, tr: (k: string) => k, localized: (s: string) => s }));

import { filtersToQuery } from '../components/common/listParts';

describe('filtersToQuery', () => {
  it('maps list filters to API params and drops defaults', () => {
    expect(filtersToQuery({ search: '  acme ', stage: 'ACTIVE', dqMin: 0, dqMax: 100, fields: { country_code: 'FRA', segment: '' } }))
      .toEqual({ q: 'acme', lifecycle_stage: 'ACTIVE', dq_min: null, dq_max: null, country_code: 'FRA', segment: null });
  });
  it('keeps a narrowed DQ range', () => {
    const q = filtersToQuery({ search: '', stage: '', dqMin: 40, dqMax: 90, fields: {} });
    expect(q).toMatchObject({ q: null, dq_min: 40, dq_max: 90 });
  });
});
