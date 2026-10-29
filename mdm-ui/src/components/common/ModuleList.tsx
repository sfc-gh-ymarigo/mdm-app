import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Box, Typography, Card, CardContent, TextField, InputAdornment, Button, IconButton, Chip, Dialog, DialogTitle,
  DialogContent, DialogActions, Drawer, Tooltip, MenuItem, CircularProgress, Tabs, Tab, Alert, alpha, Grid2 as Grid,
} from '@mui/material';
import { DataGrid, type GridColDef, type GridRowSelectionModel } from '@mui/x-data-grid';
import SearchIcon from '@mui/icons-material/Search';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import VisibilityIcon from '@mui/icons-material/Visibility';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import ListIcon from '@mui/icons-material/ViewList';
import { useTranslation } from 'react-i18next';
import { entityApi, type EntityRecord, type Facets, type Paged } from '../../api/client';
import { useBrand } from '../../config/BrandContext';
import { useUser } from '../../context/UserContext';
import { localized } from '../../i18n';
import StageChip from '../StageChip';
import DqScoreBar from '../DqScoreBar';
import RecordDetail, { type GuardedClose, type RecordTab } from './RecordDetail';
import { useToast } from './Toast';
import { useConfirm } from './Confirm';
import { useUnsavedGuard } from './useUnsavedGuard';
import { modulePath } from './Links';
import { FieldDisplay, RecordForm, activeFields, fieldLabel, validateRecord, type FieldOptions, type Values } from './fields';
import { BulkStageBar, FilterPopover, exportColumns, exportCsv, filtersToQuery, useStages, useUrlFilters } from './listParts';
import { useDebounced, useServerList } from './useServerList';

import { statusColors } from '../../theme/brandColors';
export interface ListSummary { total: number; facets: Facets['facets'] }

export interface ModuleListProps {
  moduleId: string;
  /** Load one page of rows for the given API params (defaults to the generic entity API). */
  load?: (params: URLSearchParams) => Promise<Paged<EntityRecord>>;
  /** Tabs shown after "Records" (e.g. Hierarchy). */
  extraTabs?: { key: string; label: string; icon?: React.ReactElement; content: ReactNode }[];
  /** Replace the name column cell. */
  nameCell?: (row: EntityRecord) => ReactNode;
  subtitle?: (summary: ListSummary) => ReactNode;
  fieldOptions?: FieldOptions;
  /** Module-specific record actions (AI remediate, translate, duplicate…) */
  recordActions?: React.ComponentProps<typeof RecordDetail>['extraActions'];
  recordHeader?: React.ComponentProps<typeof RecordDetail>['header'];
  /** Extra buttons in the create dialog (e.g. AI suggest); receives values and a setter. */
  createActions?: (values: Values, set: (patch: Values) => void) => ReactNode;
  /** Fixed values added to every create (e.g. { translations: {} }). */
  createDefaults?: Values;
  /** Values to prefill the create dialog with (duplicate); consumed once. */
  prefill?: Values | null;
  onPrefillUsed?: () => void;
}

/**
 * Config-driven record list shared by every module: URL-backed search/filters, export, bulk stage changes,
 * create with validation and duplicate check, record drawer (?open=<id>) with a link to the full page.
 */
export default function ModuleList({ moduleId, load, extraTabs = [], nameCell, subtitle, fieldOptions, recordActions, recordHeader, createActions, createDefaults, prefill, onPrefillUsed }: ModuleListProps) {
  const { t } = useTranslation();
  const brand = useBrand();
  const navigate = useNavigate();
  const { canEdit } = useUser();
  const toast = useToast();
  const confirm = useConfirm();
  const mod = brand.modules.find(m => m.id === moduleId);
  const entityType = moduleId.toUpperCase();
  const stages = useStages(entityType);
  const [params, setParams] = useSearchParams();
  const filterFields = useMemo(() => (mod?.filters ?? []).map(f => f.field).filter(f => f !== 'lifecycle_stage'), [mod]);
  const { filters, set, reset } = useUrlFilters(filterFields);

  const [facets, setFacets] = useState<Facets | null>(null);
  const [selected, setSelected] = useState<GridRowSelectionModel>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<Values>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const guardCreate = useUnsavedGuard(createOpen && Object.values(form).some(v => v !== null && v !== '' && v !== undefined) && !!form[mod?.name_field ?? '']);

  const drawerClose: GuardedClose = useRef<(() => void) | null>(null);
  const tab = params.get('view') ?? 'records';
  const openId = params.get('open');
  const singular = mod ? localized(mod.singular, mod.singular_labels) : moduleId;
  const plural = mod ? localized(mod.label, mod.labels) : moduleId;

  const fetchPage = useCallback((p: URLSearchParams) => (load ? load(p) : entityApi.page(moduleId, p)), [load, moduleId]);
  const query = useDebounced(useMemo(() => filtersToQuery(filters), [JSON.stringify(filters)])); // eslint-disable-line react-hooks/exhaustive-deps
  const onListError = useCallback((e: Error) => toast(t('list.loadFailed', { error: e.message }), 'error'), [toast, t]);
  const list = useServerList(fetchPage, query, { onError: onListError });
  const { total, loading } = list;
  const loadFacets = useCallback(() => { entityApi.facets(moduleId).then(setFacets).catch(() => setFacets(null)); }, [moduleId]);
  useEffect(() => { loadFacets(); }, [loadFacets]);
  const fetchRows = useCallback(() => { list.reload(); loadFacets(); }, [list.reload, loadFacets]);

  // Legacy ?highlight=<id>[&edit=1] links become ?open=<id>
  useEffect(() => {
    const h = params.get('highlight');
    if (!h) return;
    setParams(prev => { const n = new URLSearchParams(prev); n.delete('highlight'); n.set('open', h); n.delete('view'); return n; }, { replace: true });
  }, [params, setParams]);

  // Duplicate from a record: open the create dialog prefilled
  useEffect(() => {
    if (!prefill || !mod) return;
    setForm({ source_system: 'MANUAL', ...prefill, source_id: `${String(prefill.source_id ?? 'M')}-COPY` });
    setErrors({}); setCreateOpen(true); onPrefillUsed?.();
  }, [prefill]); // eslint-disable-line react-hooks/exhaustive-deps

  const setParam = (k: string, v: string | null, push = false) => setParams(prev => {
    const n = new URLSearchParams(prev); if (v === null) n.delete(k); else n.set(k, v); return n;
  }, { replace: !push });
  const openRecord = (id: string, edit = false) => setParams(prev => {
    const n = new URLSearchParams(prev); n.set('open', id); if (edit) n.set('edit', '1'); else n.delete('edit'); return n;
  });
  const closeRecord = () => setParams(prev => { const n = new URLSearchParams(prev); n.delete('open'); n.delete('edit'); n.delete('tab'); return n; });

  const nameField = mod?.name_field ?? 'id';

  // Possible duplicates while creating: server-side fuzzy search on the name
  const dupName = useDebounced(String(form[nameField] ?? ''), 400);
  const [duplicates, setDuplicates] = useState<{ id: string; name: string; source?: string; score: number }[]>([]);
  useEffect(() => {
    if (!createOpen || dupName.length < 3) { setDuplicates([]); return; }
    let cancelled = false;
    entityApi.search(moduleId, dupName).then(found => {
      if (cancelled) return;
      setDuplicates(found.filter(r => !r.is_deleted).map(r => ({
        id: r.id, name: String(r[nameField] ?? ''), source: r.source_system,
        score: Math.round((r.score != null ? Number(r.score) : 0.6) * 100),
      })).filter(d => d.score >= 60).sort((a, b) => b.score - a.score).slice(0, 5));
    }).catch(() => { if (!cancelled) setDuplicates([]); });
    return () => { cancelled = true; };
  }, [dupName, createOpen, moduleId, nameField]);

  if (!mod) return <Alert severity="warning">{t('record.unknownModule', { module: moduleId })}</Alert>;

  const facetValues = (field: string) => (facets?.facets[field] ?? []).map(f => f.value).sort();
  const sourceSystems = [...new Set(['MANUAL', ...facetValues('source_system')])].sort();
  const summary: ListSummary = { total: facets?.total ?? total, facets: facets?.facets ?? {} };
  // Configured order wins; otherwise the list_display fields, the first text one shown under the name
  const custom = mod.list_columns;
  const listFields = custom
    ? custom.map(n => activeFields(mod).find(f => f.name === n)).filter((f): f is NonNullable<typeof f> => !!f)
    : activeFields(mod).filter(f => f.list_display && f.name !== nameField).slice(0, 6);
  const secondary = custom ? undefined : listFields.find(f => f.type === 'text');

  const columns: GridColDef<EntityRecord>[] = [
    { field: nameField, headerName: fieldLabel(mod.fields.find(f => f.name === nameField) ?? { name: nameField, label: nameField, type: 'text', group: 'core' }), flex: 1.5, minWidth: 220,
      renderCell: p => nameCell ? nameCell(p.row) : (
        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
          <Typography variant="body2" sx={{ fontWeight: 500, fontSize: '0.85rem' }}>{String(p.row[nameField] ?? '')}</Typography>
          {secondary && p.row[secondary.name] ? <Typography variant="caption" color="text.secondary">{String(p.row[secondary.name])}</Typography> : null}
        </Box>) },
    { field: 'source_system', headerName: t('list.source'), width: 100, renderCell: p => <Chip label={p.value} size="small" variant="outlined" sx={{ fontSize: '0.7rem' }} /> },
    { field: 'lifecycle_stage', headerName: t('list.stage'), width: 130, renderCell: p => p.value ? <StageChip stage={p.value} /> : null },
    ...listFields.filter(f => f !== secondary).map<GridColDef<EntityRecord>>(f => ({
      field: f.name, headerName: fieldLabel(f), width: f.list_width ?? (f.type === 'ref' ? 110 : 140),
      renderCell: p => {
        const join = f.name.endsWith('_id') ? p.row[`${f.name.slice(0, -3)}_name`] : undefined;
        return join ? <Typography variant="body2" sx={{ fontSize: '0.8rem' }}>{String(join)}</Typography>
          : <FieldDisplay field={f} value={p.value} record={p.row} defaultCurrency={brand.defaultCurrency} options={fieldOptions?.[f.name]} />;
      },
    })),
    { field: 'dq_score', headerName: t('record.dqScore'), width: 150, renderCell: p => <DqScoreBar value={p.value == null ? null : Number(p.value)} /> },
    { field: 'completeness', headerName: t('record.completeness'), width: 150, renderCell: p => <DqScoreBar value={p.value == null ? null : Number(p.value)} /> },
    { field: 'actions', headerName: '', width: 110, sortable: false, renderCell: p => (
      <Box>
        <Tooltip title={t('list.view')}><IconButton size="small" onClick={e => { e.stopPropagation(); openRecord(p.row.id); }}><VisibilityIcon fontSize="small" /></IconButton></Tooltip>
        {canEdit && <Tooltip title={t('common.edit')}><IconButton size="small" onClick={e => { e.stopPropagation(); openRecord(p.row.id, true); }}><EditIcon fontSize="small" /></IconButton></Tooltip>}
        <Tooltip title={t('record.openFullPage')}><IconButton size="small" onClick={e => { e.stopPropagation(); navigate(`${modulePath(moduleId)}/${p.row.id}`); }}><OpenInNewIcon fontSize="small" /></IconButton></Tooltip>
      </Box>) },
  ];

  const startCreate = () => { setForm({ source_system: 'MANUAL', source_id: `M-${Date.now()}` }); setErrors({}); setCreateOpen(true); };
  const create = async () => {
    const errs = validateRecord(mod, form, t);
    if (!form.source_system) errs.source_system = t('fields.required', { field: t('list.sourceSystem') });
    if (!String(form.source_id ?? '').trim()) errs.source_id = t('fields.required', { field: t('list.sourceId') });
    setErrors(errs);
    if (Object.keys(errs).length) { toast(t('record.validationErrors', { count: Object.keys(errs).length }), 'error'); return; }
    if (duplicates[0]?.score >= 80 && !await confirm({ title: t('list.possibleDuplicate'), message: t('list.possibleDuplicateMessage', { name: duplicates[0].name, score: duplicates[0].score }), confirmLabel: t('list.createAnyway') })) return;
    setSaving(true);
    try {
      const body = Object.fromEntries(Object.entries({ ...createDefaults, ...form }).filter(([, v]) => v !== null && v !== ''));
      const created = await entityApi.create(moduleId, body);
      toast(t('list.created', { name: String(created[nameField] ?? '') }));
      setCreateOpen(false); setForm({});
      await fetchRows();
      openRecord(created.id);
    } catch (e) {
      const msg = (e as Error).message;
      toast(msg.includes('duplicate key') ? t('list.uniqueViolation') : t('list.createFailed', { error: msg }), 'error');
    } finally { setSaving(false); }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1, flexShrink: 0 }}>
        <Typography variant="h4">{plural}</Typography>
        {tab === 'records' && <Box sx={{ display: 'flex', gap: 1 }}>
          <Button variant="outlined" startIcon={<FileDownloadIcon />} size="small"
            onClick={async () => { const all = await list.fetchAll(); exportCsv(all, exportColumns(mod), moduleId); toast(t('list.exported', { count: all.length }), 'info'); }}>{t('common.export')}</Button>
          {canEdit && mod.allow_create !== false && <Button variant="contained" startIcon={<AddIcon />} onClick={startCreate}>{t('list.new', { entity: singular })}</Button>}
        </Box>}
      </Box>

      {extraTabs.length > 0 && (
        <Tabs value={tab} onChange={(_, v) => setParam('view', v === 'records' ? null : v, true)} sx={{ mb: 2 }}>
          <Tab value="records" label={t('list.records')} icon={<ListIcon />} iconPosition="start" sx={{ minHeight: 48, textTransform: 'none' }} />
          {extraTabs.map(x => <Tab key={x.key} value={x.key} label={x.label} icon={x.icon} iconPosition="start" sx={{ minHeight: 48, textTransform: 'none' }} />)}
        </Tabs>
      )}
      {extraTabs.find(x => x.key === tab)?.content}

      {tab === 'records' && <>
        <Typography variant="subtitle1" sx={{ mb: 2 }}>
          {subtitle ? subtitle(summary) : t('list.summary', { count: summary.total, sources: t('list.sourceCount', { count: facetValues('source_system').length }) })}
          {loading && <CircularProgress size={14} sx={{ ml: 1 }} />}
        </Typography>
        <Card sx={{ mb: 2, flexShrink: 0, overflow: 'visible' }}>
          <CardContent sx={{ py: 1.5, display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
            <TextField placeholder={t('list.searchPlaceholder', { entity: plural.toLowerCase() })} size="small" value={filters.search}
              onChange={e => set({ q: e.target.value })} sx={{ minWidth: 300 }}
              slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }} />
            <TextField select size="small" sx={{ minWidth: 160 }} label={t('list.stage')} value={filters.stage} onChange={e => set({ stage: e.target.value })}>
              <MenuItem value="">{t('list.allStages')}</MenuItem>
              {stages.map(s => <MenuItem key={s} value={s}>{t(`stages.${s}`, { defaultValue: s })}</MenuItem>)}
            </TextField>
            <FilterPopover mod={{ ...mod, filters: mod.filters.filter(f => f.field !== 'lifecycle_stage') }} optionsFor={facetValues} filters={filters} set={set} reset={reset} />
            <Typography variant="caption" sx={{ ml: 'auto', color: 'text.secondary' }}>{t('list.results', { count: total })}</Typography>
          </CardContent>
        </Card>

        {canEdit && <BulkStageBar entityType={entityType} ids={selected as string[]} onDone={() => { setSelected([]); fetchRows(); }} onClear={() => setSelected([])} />}

        <Card sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 400 }}>
          <DataGrid {...list.gridProps} columns={columns}
            disableRowSelectionOnClick checkboxSelection={canEdit} keepNonExistentRowsSelected
            rowSelectionModel={selected} onRowSelectionModelChange={setSelected}
            getRowHeight={() => 'auto'}
            getRowClassName={p => (['ARCHIVED', 'SUSPENDED', 'DISCONTINUED'].includes(String(p.row.lifecycle_stage)) ? 'row-deactivated' : '')}
            onRowClick={p => openRecord(String(p.row.id))}
            sx={{ flex: 1, border: 'none', '& .MuiDataGrid-row': { cursor: 'pointer', minHeight: '56px !important' }, '& .MuiDataGrid-cell': { py: 1.25, display: 'flex', alignItems: 'center' }, '& .row-deactivated': { opacity: 0.55 } }} />
        </Card>
      </>}

      <Drawer anchor="right" open={!!openId} onClose={() => (drawerClose.current ?? closeRecord)()} PaperProps={{ sx: { width: { xs: '100%', md: 560 } } }}>
        {openId && (
          <RecordDetail key={openId} moduleId={moduleId} id={openId} variant="drawer" initialEdit={params.get('edit') === '1'}
            initialTab={(params.get('tab') as RecordTab) || 'details'}
            onTabChange={tb => setParam('tab', tb === 'details' ? null : tb)}
            fieldOptions={fieldOptions} header={recordHeader} extraActions={recordActions}
            onClose={closeRecord} closeRef={drawerClose} onChanged={() => fetchRows()}
            onDeleted={() => { closeRecord(); fetchRows(); }} />
        )}
      </Drawer>

      <Dialog open={createOpen} onClose={() => guardCreate(() => setCreateOpen(false))} maxWidth="md" fullWidth>
        <DialogTitle>{t('list.createTitle', { entity: singular })}</DialogTitle>
        <DialogContent dividers>
          {duplicates.length > 0 && (
            <Alert severity="warning" icon={<WarningAmberIcon />} sx={{ mb: 2, bgcolor: alpha(statusColors().warning, 0.08) }}>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>{t('list.duplicatesDetected')}</Typography>
              {duplicates.map(d => <Typography key={d.id} variant="caption" display="block">{d.name} ({d.source}) — {d.score}%</Typography>)}
            </Alert>
          )}
          <Typography variant="overline" color="text.secondary">{t('list.source')}</Typography>
          <Grid container spacing={1.5} sx={{ mt: 0.5, mb: 2 }}>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField select fullWidth size="small" required label={t('list.sourceSystem')} value={String(form.source_system ?? '')}
                onChange={e => setForm(f => ({ ...f, source_system: e.target.value }))} error={!!errors.source_system} helperText={errors.source_system}>
                {sourceSystems.map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
              </TextField>
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField fullWidth size="small" required label={t('list.sourceId')} value={String(form.source_id ?? '')}
                onChange={e => setForm(f => ({ ...f, source_id: e.target.value }))} error={!!errors.source_id} helperText={errors.source_id || t('list.sourceIdHint')} />
            </Grid>
          </Grid>
          {createActions && <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>{createActions(form, patch => setForm(f => ({ ...f, ...patch })))}</Box>}
          <RecordForm mod={mod} values={form} errors={errors} fieldOptions={fieldOptions}
            onChange={(k, v) => { setForm(f => ({ ...f, [k]: v })); setErrors(e => { const n = { ...e }; delete n[k]; return n; }); }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => guardCreate(() => setCreateOpen(false))} disabled={saving}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={create} disabled={saving} startIcon={saving ? <CircularProgress size={16} /> : <AddIcon />}>{t('list.createButton', { entity: singular })}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
