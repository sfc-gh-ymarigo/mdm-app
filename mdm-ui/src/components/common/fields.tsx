import { useMemo } from 'react';
import {
  Box, TextField, MenuItem, FormControlLabel, Switch, Typography, Grid2 as Grid, Chip, alpha } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { ModuleConfig, ModuleField } from '../../config/BrandContext';
import { useRefData } from '../../hooks/useRefData';
import { useAllowedCountries } from '../../hooks/useAllowedCountries';
import { localized } from '../../i18n';
import { formatDate, formatMoney, formatNumber } from './format';

import { seriesColor } from '../../theme/brandColors';
export type Values = Record<string, unknown>;
/** Select options that override a field's own source, e.g. product categories for `category_id`. */
export type Option = { code: string; label: string; group?: string };
export type FieldOptions = Record<string, Option[]>;

/** Columns managed by the system: never shown as editable inputs. */
export const SYSTEM_FIELDS = new Set(['id', 'golden_id', 'lifecycle_stage', 'dq_score', 'completeness', 'last_dq_check',
  'created_by', 'created_at', 'updated_by', 'updated_at', 'is_deleted', 'hierarchy_path', 'hierarchy_level', 'extended_attrs']);

const REF_TABLE_DOMAIN: Record<string, string> = { 'mdm.ref_country': 'COUNTRY', 'mdm.ref_currency': 'CURRENCY' };
const isCountryField = (f: ModuleField) => f.name === 'country_code' || f.ref_table === 'mdm.ref_country';
const isMoneyField = (f: ModuleField) => /(price|amount|revenue|spend|value|cost)$/.test(f.name) && f.type === 'number';

/** PII fields the API masks for the current user (set from /api/auth/me). Shown read-only:
 *  the value is masked, and the API ignores PII in this user's writes anyway. */
let maskedFields = new Set<string>();
export function setMaskedFields(names: string[]) { maskedFields = new Set(names); }
export const isMasked = (name: string) => maskedFields.has(name);

export const fieldLabel = (f: ModuleField) => localized(f.label, f.labels);
export const activeFields = (mod: ModuleConfig) => mod.fields.filter(f => f.active !== false);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const E164_RE = /^\+?[\d\s\-().]{7,20}$/;

/** Validation from the field definition (required, max length, type) plus email/phone formats. */
export function validateField(f: ModuleField, v: unknown, t: (k: string, o?: Record<string, unknown>) => string): string | null {
  const empty = v === null || v === undefined || v === '';
  if (empty) return f.required ? t('fields.required', { field: fieldLabel(f) }) : null;
  const s = String(v);
  if (f.max_length && s.length > f.max_length) return t('fields.tooLong', { max: f.max_length });
  if (f.type === 'number' && isNaN(Number(s))) return t('fields.notNumber');
  if (f.type === 'date' && isNaN(new Date(s).getTime())) return t('fields.notDate');
  if (/email/.test(f.name) && !EMAIL_RE.test(s)) return t('fields.badEmail');
  if (/phone|fax|mobile/.test(f.name) && !E164_RE.test(s)) return t('fields.badPhone');
  return null;
}

export function validateRecord(mod: ModuleConfig, values: Values, t: (k: string, o?: Record<string, unknown>) => string, only?: string[]) {
  const errors: Record<string, string> = {};
  for (const f of activeFields(mod)) {
    if (SYSTEM_FIELDS.has(f.name) || isMasked(f.name) || (only && !only.includes(f.name))) continue;
    const e = validateField(f, values[f.name], t);
    if (e) errors[f.name] = e;
  }
  return errors;
}

/** E.164 example for the user's first allowed country, used as the phone placeholder. */
const PHONE_EXAMPLE: Record<string, string> = {
  FRA: '+33 1 23 45 67 89', DEU: '+49 30 123456', BEL: '+32 2 123 45 67', NLD: '+31 20 123 4567', GBR: '+44 20 7123 4567',
  ESP: '+34 912 345 678', ITA: '+39 06 1234 5678', USA: '+1 212 555 0100', CHE: '+41 44 123 45 67',
};

export function FieldInput({ field, moduleId, value, onChange, error, highlight, disabled, options: override }: {
  field: ModuleField; moduleId: string; value: unknown; onChange: (v: unknown) => void;
  error?: string | null; highlight?: boolean; disabled?: boolean; options?: Option[];
}) {
  const { t } = useTranslation();
  const domain = field.type === 'ref' ? (field.ref_domain || REF_TABLE_DOMAIN[field.ref_table ?? ''] || '') : '';
  const refValues = useRefData(isCountryField(field) ? '' : domain);
  const countries = useAllowedCountries(moduleId);
  const label = fieldLabel(field);
  const sx = highlight ? { '& .MuiOutlinedInput-root': { bgcolor: alpha(seriesColor(1), 0.08) }, '& .MuiInputLabel-root': { color: seriesColor(1) } } : undefined;
  const masked = isMasked(field.name);
  const common = { size: 'small' as const, fullWidth: true, label, required: field.required && !masked, error: !!error,
    helperText: error || (masked ? t('fields.maskedPii') : undefined), disabled: disabled || masked || field.editable === false, sx };

  if (field.type === 'boolean') {
    return <FormControlLabel control={<Switch checked={value === true || value === 'true'} onChange={e => onChange(e.target.checked)} disabled={common.disabled} />} label={label} />;
  }
  if (override) {
    const v = value == null ? '' : String(value);
    return (
      <TextField select {...common} value={v} onChange={e => onChange(e.target.value === '' ? null : e.target.value)}>
        {!field.required && <MenuItem value=""><em>—</em></MenuItem>}
        {override.map(o => <MenuItem key={o.code} value={o.code}>{o.group ? `${o.group} › ` : ''}{o.label}</MenuItem>)}
      </TextField>
    );
  }
  if (field.type === 'ref') {
    const options = isCountryField(field) ? countries : refValues;
    const v = value == null ? '' : String(value);
    const list = v && !options.some(o => o.code === v) ? [{ code: v, label: t('fields.inactiveValue') }, ...options] : options;
    return (
      <TextField select {...common} value={v} onChange={e => onChange(e.target.value || null)}>
        {!field.required && <MenuItem value=""><em>—</em></MenuItem>}
        {list.map(o => <MenuItem key={o.code} value={o.code}>{o.code} — {o.label}</MenuItem>)}
      </TextField>
    );
  }
  const placeholder = /phone|mobile/.test(field.name) ? PHONE_EXAMPLE[countries[0]?.code ?? ''] ?? '+00 000 000 000' : undefined;
  return (
    <TextField {...common} placeholder={placeholder}
      type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
      slotProps={field.type === 'date' ? { inputLabel: { shrink: true } } : undefined}
      value={value == null ? '' : field.type === 'date' ? String(value).slice(0, 10) : String(value)}
      onChange={e => onChange(e.target.value === '' ? null : e.target.value)} />
  );
}

/** Read-only value: money/dates/numbers formatted for the locale, refs as code chips. */
export function FieldDisplay({ field, value, record, defaultCurrency, options }: { field: ModuleField; value: unknown; record?: Values; defaultCurrency?: string; options?: Option[] }) {
  const { t } = useTranslation();
  if (value === null || value === undefined || value === '') return <Typography variant="body2" color="text.disabled">—</Typography>;
  const opt = options?.find(o => o.code === String(value));
  if (opt) return <Typography variant="body2" sx={{ fontWeight: 500 }}>{opt.group ? `${opt.group} › ` : ''}{opt.label}</Typography>;
  let text: string;
  if (field.type === 'boolean') text = value === true || value === 'true' ? t('common.yes') : t('common.no');
  else if (field.type === 'date') text = formatDate(value);
  else if (isMoneyField(field)) text = formatMoney(value, (record?.currency_code as string) ?? (record?.revenue_currency as string), defaultCurrency);
  else if (field.type === 'number') text = formatNumber(value);
  else if (field.type === 'ref') return <Chip size="small" label={String(value)} variant="outlined" sx={{ height: 20, fontSize: '0.7rem' }} />;
  else text = String(value);
  return <Typography variant="body2" sx={{ fontWeight: 500, wordBreak: 'break-word' }}>{text}</Typography>;
}

/** Group fields in config order: core, identifiers, address, … */
export function useFieldGroups(mod: ModuleConfig | undefined, opts: { includeSystem?: boolean } = {}) {
  return useMemo(() => {
    const groups: { group: string; fields: ModuleField[] }[] = [];
    if (!mod) return groups;
    for (const f of activeFields(mod)) {
      if (!opts.includeSystem && SYSTEM_FIELDS.has(f.name)) continue;
      let g = groups.find(x => x.group === f.group);
      if (!g) { g = { group: f.group, fields: [] }; groups.push(g); }
      g.fields.push(f);
    }
    return groups;
  }, [mod, opts.includeSystem]);
}

export const groupLabel = (t: (k: string, o?: Record<string, unknown>) => string, group: string) =>
  t(`fieldGroups.${group}`, { defaultValue: group.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase()) });

/** Editable form for a module, grouped by field group. */
export function RecordForm({ mod, values, onChange, errors = {}, highlight, exclude = [], columns = 2, fieldOptions }: {
  mod: ModuleConfig; values: Values; onChange: (name: string, v: unknown) => void;
  errors?: Record<string, string>; highlight?: Set<string>; exclude?: string[]; columns?: 1 | 2 | 3; fieldOptions?: FieldOptions;
}) {
  const { t } = useTranslation();
  const groups = useFieldGroups(mod);
  const span = 12 / columns;
  return (
    <Box>
      {groups.map(({ group, fields }) => {
        const shown = fields.filter(f => !exclude.includes(f.name));
        if (!shown.length) return null;
        return (
          <Box key={group} sx={{ mb: 2 }}>
            <Typography variant="overline" color="text.secondary">{groupLabel(t, group)}</Typography>
            <Grid container spacing={1.5} sx={{ mt: 0.5 }}>
              {shown.map(f => (
                <Grid key={f.name} size={{ xs: 12, md: f.name === mod.name_field ? 12 : span }}>
                  <FieldInput field={f} moduleId={mod.id} value={values[f.name]} onChange={v => onChange(f.name, v)}
                    error={errors[f.name]} highlight={highlight?.has(f.name)} options={fieldOptions?.[f.name]} />
                </Grid>
              ))}
            </Grid>
          </Box>
        );
      })}
    </Box>
  );
}

/** Read-only grouped view of a record. */
export function RecordFields({ mod, record, defaultCurrency, exclude = [], fieldOptions }: { mod: ModuleConfig; record: Values; defaultCurrency?: string; exclude?: string[]; fieldOptions?: FieldOptions }) {
  const { t } = useTranslation();
  const groups = useFieldGroups(mod);
  return (
    <Box>
      {groups.map(({ group, fields }) => {
        const shown = fields.filter(f => !exclude.includes(f.name) && record[f.name] !== null && record[f.name] !== undefined && record[f.name] !== '');
        if (!shown.length) return null;
        return (
          <Box key={group} sx={{ mb: 2 }}>
            <Typography variant="overline" color="text.secondary">{groupLabel(t, group)}</Typography>
            {shown.map(f => (
              <Box key={f.name} sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, py: 0.75, borderBottom: 1, borderColor: 'divider' }}>
                <Typography variant="body2" color="text.secondary">{fieldLabel(f)}</Typography>
                <FieldDisplay field={f} value={record[f.name]} record={record} defaultCurrency={defaultCurrency} options={fieldOptions?.[f.name]} />
              </Box>
            ))}
          </Box>
        );
      })}
    </Box>
  );
}

/** Values for editing: active non-system fields of the record. */
export function editableValues(mod: ModuleConfig, record: Values): Values {
  const out: Values = {};
  for (const f of activeFields(mod)) if (!SYSTEM_FIELDS.has(f.name)) out[f.name] = record[f.name] ?? null;
  // Masked PII stays out of edits so the masked value is never sent back
  for (const k of Object.keys(out)) if (isMasked(k)) delete out[k];
  return out;
}

/** Only fields that differ from the original (what to send on save). */
export function changedValues(original: Values, edited: Values): Values {
  const out: Values = {};
  for (const [k, v] of Object.entries(edited)) if ((original[k] ?? null) !== (v ?? null) && String(original[k] ?? '') !== String(v ?? '')) out[k] = v;
  return out;
}
