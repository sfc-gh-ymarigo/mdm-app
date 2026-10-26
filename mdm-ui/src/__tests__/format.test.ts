import { describe, it, expect, vi } from 'vitest';

const lang = vi.hoisted(() => ({ value: 'en' }));
vi.mock('../i18n', () => ({ default: { get language() { return lang.value; } } }));

import { formatMoney, currencySymbol, formatNumber } from '../components/common/format';

describe('format', () => {
  it('formats money in the record currency, then the default one', () => {
    lang.value = 'en';
    expect(formatMoney(1234.5, 'USD')).toBe('$1,234.50');
    expect(formatMoney(10, null, 'GBP')).toBe('£10.00');
    expect(formatMoney(10)).toBe('10');
    expect(formatMoney(null)).toBe('—');
  });

  it('follows the UI language', () => {
    lang.value = 'fr';
    expect(formatMoney(1234.5, 'EUR').replace(/\s/g, ' ')).toBe('1 234,50 €');
    expect(formatNumber(0.125, 2)).toBe('0,13');
  });

  it('returns narrow currency symbols', () => {
    lang.value = 'en';
    expect(currencySymbol('EUR')).toBe('€');
    expect(currencySymbol('')).toBe('');
  });
});
