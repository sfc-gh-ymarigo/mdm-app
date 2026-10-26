import { useState } from 'react';
import { Button, CircularProgress } from '@mui/material';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { useTranslation } from 'react-i18next';
import type { EntityRecord } from '../../api/client';
import type { ModuleConfig } from '../../config/BrandContext';
import { useToast } from './Toast';
import { editableValues, type Values } from './fields';

import { statusColors, seriesColor } from '../../theme/brandColors';
async function postJson(url: string, body: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

/** "AI remediate": Cortex suggests corrections; the record opens in edit mode with the changed fields highlighted. */
export function RemediateButton({ mod, record, edit }: { mod: ModuleConfig; record: EntityRecord; edit: (values?: Values, highlight?: Set<string>) => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const data = await postJson('/api/ai/remediate', { entity_type: mod.id.toUpperCase(), entity_data: record });
      const values = editableValues(mod, record);
      const changed = new Set<string>();
      for (const [k, v] of Object.entries(data.suggestions ?? {})) {
        if (k in values && String(v ?? '') !== String(values[k] ?? '')) { values[k] = v; changed.add(k); }
      }
      if (changed.size) { edit(values, changed); toast(t('ai.remediateSuggested', { count: changed.size }), 'info'); }
      else toast(t('ai.noCorrections'));
    } catch (e) { toast(t('ai.error', { error: (e as Error).message }), 'error'); }
    finally { setBusy(false); }
  };
  return <Button size="small" startIcon={busy ? <CircularProgress size={14} /> : <AutoFixHighIcon />} disabled={busy} onClick={run} sx={{ color: seriesColor(1) }}>{t('ai.remediate')}</Button>;
}

/** "AI suggest" in the create dialog: fills empty fields from the name (prompt built server-side). */
export function AiSuggestButton({ mod, values, set }: { mod: ModuleConfig; values: Values; set: (patch: Values) => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const name = String(values[mod.name_field] ?? '').trim();
  const run = async () => {
    setBusy(true);
    try {
      const data = await postJson(`/api/ai/suggest/${mod.id}`, { fields: values });
      const patch: Values = {};
      for (const [k, v] of Object.entries(data.suggestions ?? {})) {
        if (v != null && v !== '' && (values[k] == null || values[k] === '') && mod.fields.some(f => f.name === k)) patch[k] = v;
      }
      set(patch);
      toast(t('ai.suggested', { count: Object.keys(patch).length }), 'info');
    } catch (e) { toast(t('ai.error', { error: (e as Error).message }), 'error'); }
    finally { setBusy(false); }
  };
  return <Button size="small" startIcon={busy ? <CircularProgress size={14} /> : <AutoFixHighIcon />} disabled={busy || !name} onClick={run} sx={{ color: seriesColor(1) }}>{t('ai.suggest')}</Button>;
}

export function DuplicateButton({ mod, record, onDuplicate }: { mod: ModuleConfig; record: EntityRecord; onDuplicate: (v: Values) => void }) {
  const { t } = useTranslation();
  return (
    <Button size="small" startIcon={<ContentCopyIcon />} sx={{ color: statusColors().warning }}
      onClick={() => onDuplicate({ ...editableValues(mod, record), source_system: record.source_system, source_id: record.source_id })}>
      {t('record.duplicate')}
    </Button>
  );
}
