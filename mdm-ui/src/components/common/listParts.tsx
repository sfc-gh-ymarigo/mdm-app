import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Box, Button, Card, Chip, CircularProgress, MenuItem, Popover, Slider, TextField, Typography, alpha, useTheme,
} from '@mui/material';
import FilterListIcon from '@mui/icons-material/FilterList';
import SaveIcon from '@mui/icons-material/Save';
import { useTranslation } from 'react-i18next';
import type { ModuleConfig } from '../../config/BrandContext';
import { useRefData } from '../../hooks/useRefData';
import { goldenApi } from '../../api/client';
import { useToast } from './Toast';
import { fieldLabel } from './fields';

/** CSV of the given columns (values quoted when needed). */
export function exportCsv(rows: Record<string, unknown>[], columns: string[], filename: string) {
  const esc = (v: unknown) => {
    const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [columns.join(','), ...rows.map(r => columns.map(c => esc(r[c])).join(','))].join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url; a.download = `${filename}_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  URL.revokeObjectURL(url);
}

/** Columns worth exporting for a module: source + active list fields + scores. */
export function exportColumns(mod: ModuleConfig): string[] {
  const fields = mod.fields.filter(f => f.active !== false).map(f => f.name);
  return ['id', 'golden_id', 'source_system', 'source_id', 'lifecycle_stage', ...fields.filter(f => !['source_system', 'source_id'].includes(f)), 'dq_score', 'completeness'];
}

/** Lifecycle stage codes for an entity type (from reference data), with a fallback list. */
export function useStages(entityType: string): string[] {
  const all = useRefData('LIFECYCLE_STAGE');
  return useMemo(() => {
    const own = all.filter(s => !s.entity_type || s.entity_type === entityType).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    return own.length ? own.map(s => s.code) : ['DRAFT', 'REVIEW', 'VALIDATED', 'ACTIVE', 'SUSPENDED', 'ARCHIVED'];
  }, [all, entityType]);
}

/** "N selected — change stage to … Apply" bar. */
export function BulkStageBar({ entityType, ids, onDone, onClear }: { entityType: string; ids: string[]; onDone: () => void; onClear: () => void }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const toast = useToast();
  const stages = useStages(entityType);
  const [stage, setStage] = useState('');
  const [busy, setBusy] = useState(false);
  if (!ids.length) return null;
  const apply = async () => {
    setBusy(true);
    try {
      const r = await goldenApi.bulkStage(entityType, ids, stage);
      toast(t('list.bulkUpdated', { count: r.updated, stage }));
      setStage(''); onDone();
    } catch (e) { toast(t('list.bulkFailed', { error: (e as Error).message }), 'error'); }
    finally { setBusy(false); }
  };
  return (
    <Card sx={{ mb: 1, p: 1.5, display: 'flex', alignItems: 'center', gap: 2, bgcolor: alpha(theme.palette.primary.main, 0.06) }}>
      <Typography variant="body2" fontWeight={600}>{t('list.selected', { count: ids.length })}</Typography>
      <TextField select size="small" sx={{ minWidth: 180 }} label={t('list.changeStageTo')} value={stage} onChange={e => setStage(e.target.value)}>
        {stages.map(s => <MenuItem key={s} value={s}>{t(`stages.${s}`, { defaultValue: s })}</MenuItem>)}
      </TextField>
      <Button variant="contained" size="small" disabled={!stage || busy} startIcon={busy ? <CircularProgress size={14} /> : <SaveIcon />} onClick={apply}>{t('list.apply')}</Button>
      <Button size="small" onClick={onClear}>{t('list.clear')}</Button>
    </Card>
  );
}

export interface ListFilters { search: string; stage: string; dqMin: number; dqMax: number; fields: Record<string, string> }

/**
 * Filters kept in the URL query string (?q=&stage=&dq_min=&dq_max=&<field>=), so lists can be linked to and shared.
 * `fieldNames` are the module's configured filter fields.
 */
export function useUrlFilters(fieldNames: string[]) {
  const [params, setParams] = useSearchParams();
  const filters: ListFilters = {
    search: params.get('q') ?? '',
    stage: params.get('stage') ?? '',
    dqMin: Number(params.get('dq_min') ?? 0),
    dqMax: Number(params.get('dq_max') ?? 100),
    fields: Object.fromEntries(fieldNames.map(f => [f, params.get(f) ?? ''])),
  };
  const set = (patch: Record<string, string | number | null>) => setParams(prev => {
    const next = new URLSearchParams(prev);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '' || (k === 'dq_min' && v === 0) || (k === 'dq_max' && v === 100)) next.delete(k);
      else next.set(k, String(v));
    }
    return next;
  }, { replace: true });
  const reset = () => set({ dq_min: null, dq_max: null, ...Object.fromEntries(fieldNames.map(f => [f, null])) });
  return { filters, set, reset };
}

/** API query params for the list filters (server-side filtering). */
export function filtersToQuery(f: ListFilters): Record<string, string | number | null> {
  return {
    q: f.search.trim() || null,
    lifecycle_stage: f.stage || null,
    dq_min: f.dqMin > 0 ? f.dqMin : null,
    dq_max: f.dqMax < 100 ? f.dqMax : null,
    ...Object.fromEntries(Object.entries(f.fields).map(([k, v]) => [k, v || null])),
  };
}

/** "More filters" button + popover driven by the module's `filters` config; options come from server facets. */
export function FilterPopover({ mod, optionsFor, filters, set, reset }: {
  mod: ModuleConfig; optionsFor: (field: string) => string[]; filters: ListFilters;
  set: (patch: Record<string, string | number | null>) => void; reset: () => void;
}) {
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const active = Object.values(filters.fields).filter(Boolean).length + (filters.dqMin > 0 || filters.dqMax < 100 ? 1 : 0);
  const options = optionsFor;
  return (
    <>
      <Button startIcon={<FilterListIcon />} size="small" color="inherit" onClick={e => setAnchor(e.currentTarget)}>
        {t('list.moreFilters')} {active > 0 && <Chip label={active} size="small" color="primary" sx={{ ml: 0.5, height: 18, fontSize: '0.65rem' }} />}
      </Button>
      <Popover open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}>
        <Box sx={{ p: 2.5, width: 300, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Typography variant="subtitle2">{t('list.advancedFilters')}</Typography>
          {mod.filters.map(flt => {
            const field = mod.fields.find(f => f.name === flt.field);
            return (
              <TextField key={flt.field} select size="small" fullWidth label={field ? fieldLabel(field) : flt.label}
                value={filters.fields[flt.field] ?? ''} onChange={e => set({ [flt.field]: e.target.value })}>
                <MenuItem value="">{t('list.all')}</MenuItem>
                {options(flt.field).map(o => <MenuItem key={o} value={o}>{o}</MenuItem>)}
              </TextField>
            );
          })}
          <Box>
            <Typography variant="caption" color="text.secondary">{t('list.dqRange', { min: filters.dqMin, max: filters.dqMax })}</Typography>
            <Slider value={[filters.dqMin, filters.dqMax]} min={0} max={100} valueLabelDisplay="auto" sx={{ mt: 1 }}
              onChange={(_, v) => { const [a, b] = v as number[]; set({ dq_min: a, dq_max: b }); }} />
          </Box>
          <Button size="small" onClick={reset}>{t('list.reset')}</Button>
        </Box>
      </Popover>
    </>
  );
}
