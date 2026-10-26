import i18n from '../../i18n';

const locale = () => (i18n.language || 'en');

/** Money in the record's currency (falls back to `defaultCurrency`, then plain number). */
export function formatMoney(value: unknown, currency?: string | null, defaultCurrency?: string): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  if (isNaN(n)) return String(value);
  const cur = currency || defaultCurrency;
  try {
    return cur ? new Intl.NumberFormat(locale(), { style: 'currency', currency: cur }).format(n)
      : new Intl.NumberFormat(locale(), { maximumFractionDigits: 2 }).format(n);
  } catch { return `${n} ${cur ?? ''}`.trim(); }
}

/** Symbol for a currency code in the active locale, e.g. EUR → €, USD → $. */
export function currencySymbol(currency?: string | null): string {
  if (!currency) return '';
  try {
    return new Intl.NumberFormat(locale(), { style: 'currency', currency, currencyDisplay: 'narrowSymbol' })
      .formatToParts(0).find(p => p.type === 'currency')?.value ?? currency;
  } catch { return currency; }
}

export function formatDate(value: unknown, withTime = false): string {
  if (!value) return '—';
  const d = new Date(String(value));
  if (isNaN(d.getTime())) return String(value);
  return withTime ? d.toLocaleString(locale()) : d.toLocaleDateString(locale());
}

export function formatNumber(value: unknown, digits = 2): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  return isNaN(n) ? String(value) : new Intl.NumberFormat(locale(), { maximumFractionDigits: digits }).format(n);
}
