import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Typography, Tabs, Tab, Button, CircularProgress, Chip, Alert, IconButton, Tooltip, TextField, Table, TableBody,
  TableCell, TableHead, TableRow, alpha,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import SaveIcon from '@mui/icons-material/Save';
import DeleteIcon from '@mui/icons-material/Delete';
import ArchiveIcon from '@mui/icons-material/Archive';
import CloseIcon from '@mui/icons-material/Close';
import OpenInFullIcon from '@mui/icons-material/OpenInFull';
import { useTranslation } from 'react-i18next';
import { entityApi, auditApi, workflowApi, type EntityRecord, type RecordContext } from '../../api/client';
import type { AuditEntry } from '../../types/models';
import { useBrand } from '../../config/BrandContext';
import { useUser } from '../../context/UserContext';
import StageChip from '../StageChip';
import { useToast } from './Toast';
import { useConfirm } from './Confirm';
import { useUnsavedGuard } from './useUnsavedGuard';
import { GoldenChip, RecordLink, UserLink, WorkflowLink, modulePath } from './Links';
import { RecordFields, RecordForm, editableValues, changedValues, validateRecord, type Values, type FieldOptions } from './fields';
import { formatDate } from './format';
import { localized } from '../../i18n';

import { statusColors } from '../../theme/brandColors';
export type RecordTab = 'details' | 'quality' | 'workflows' | 'audit' | 'comments';

/** Lets a container (drawer backdrop/Escape) close through the record's unsaved-changes guard. */
export type GuardedClose = { current: (() => void) | null };
const TABS: RecordTab[] = ['details', 'quality', 'workflows', 'audit', 'comments'];

function Gauge({ label, value, onClick }: { label: string; value: unknown; onClick?: () => void }) {
  const v = value == null || value === '' ? null : Number(value);
  const color = v == null ? statusColors().neutral : v >= 80 ? statusColors().success : v >= 50 ? statusColors().warning : statusColors().error;
  return (
    <Box onClick={onClick} sx={{ textAlign: 'center', cursor: onClick ? 'pointer' : 'default' }}>
      <Box sx={{ position: 'relative', display: 'inline-flex' }}>
        <CircularProgress variant="determinate" value={v ?? 0} size={56} thickness={5} sx={{ color }} />
        <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Typography variant="body2" sx={{ fontWeight: 700, fontSize: '0.8rem' }}>{v == null ? '—' : `${Math.round(v)}%`}</Typography>
        </Box>
      </Box>
      <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>{label}</Typography>
    </Box>
  );
}

/**
 * Shared record view for every module: header (stage, golden ID, scores), tabs for details/quality/workflows/audit/comments,
 * inline edit with validation and unsaved-changes guard. Used as a full page and inside list drawers.
 */
export default function RecordDetail({ moduleId, id, variant = 'page', initialTab = 'details', initialEdit = false, onClose, onChanged, onDeleted, extraActions, onTabChange, fieldOptions, header, closeRef }: {
  moduleId: string; id: string; variant?: 'page' | 'drawer'; initialTab?: RecordTab; initialEdit?: boolean;
  fieldOptions?: FieldOptions;
  /** Extra content above the fields on the details tab (e.g. product image, translations) */
  header?: (record: EntityRecord) => ReactNode;
  onClose?: () => void; onChanged?: (r: EntityRecord) => void; onDeleted?: (id: string) => void;
  /** Module-specific buttons (AI remediate, duplicate, …) shown in the footer when not editing */
  extraActions?: (record: EntityRecord, helpers: { edit: (values?: Values, highlight?: Set<string>) => void; reload: () => void }) => ReactNode;
  onTabChange?: (tab: RecordTab) => void;
  closeRef?: GuardedClose;
}) {
  const { t } = useTranslation();
  const brand = useBrand();
  const navigate = useNavigate();
  const { canEdit, isAdmin } = useUser();
  const toast = useToast();
  const confirm = useConfirm();
  const mod = brand.modules.find(m => m.id === moduleId);
  const entityType = moduleId.toUpperCase();

  const [record, setRecord] = useState<EntityRecord | null>(null);
  const [ctx, setCtx] = useState<RecordContext | null>(null);
  const [audit, setAudit] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTabState] = useState<RecordTab>(initialTab);
  const [edit, setEdit] = useState<Values | null>(null);
  const [aiFields, setAiFields] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState('');

  const original = useMemo(() => (record && mod ? editableValues(mod, record) : {}), [record, mod]);
  const dirty = !!edit && Object.keys(changedValues(original, edit)).length > 0;
  const guard = useUnsavedGuard(dirty);
  const setTab = (v: RecordTab) => { setTabState(v); onTabChange?.(v); };
  useEffect(() => { if (closeRef) closeRef.current = onClose ? () => guard(onClose) : null; }, [closeRef, onClose, guard]);
  useEffect(() => { setTabState(initialTab); }, [initialTab]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [r, c] = await Promise.all([entityApi.get(moduleId, id), entityApi.context(moduleId, id)]);
      setRecord(r); setCtx(c); setAudit(null);
    } catch (e) { setError((e as Error).message); }
  }, [moduleId, id]);
  useEffect(() => { setRecord(null); setEdit(null); load(); }, [load]);
  // Open straight in edit mode when asked (e.g. ?edit=1 links)
  useEffect(() => { if (initialEdit && record && mod && !edit) setEdit(editableValues(mod, record)); }, [initialEdit, record]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (tab === 'audit' && audit === null) auditApi.list(entityType, id).then(setAudit).catch(() => setAudit([]));
  }, [tab, audit, entityType, id]);

  if (!mod) return <Alert severity="warning">{t('record.unknownModule', { module: moduleId })}</Alert>;
  if (error) return <Alert severity="error" action={<Button onClick={load}>{t('common.retry')}</Button>}>{error === 'Not found' ? t('record.notFound') : error}</Alert>;
  if (!record || !ctx) return <Box sx={{ p: 4, textAlign: 'center' }}><CircularProgress size={28} /></Box>;

  const name = String(record[mod.name_field] ?? record.id);
  const singular = localized(mod.singular, mod.singular_labels);

  const startEdit = (values?: Values, highlight?: Set<string>) => { setEdit(values ?? editableValues(mod, record)); setAiFields(highlight ?? new Set()); setErrors({}); setTab('details'); };
  const save = async () => {
    if (!edit) return;
    const changes = changedValues(original, edit);
    const errs = validateRecord(mod, edit, t, Object.keys(changes));
    setErrors(errs);
    if (Object.keys(errs).length) { toast(t('record.validationErrors', { count: Object.keys(errs).length }), 'error'); return; }
    if (!Object.keys(changes).length) { setEdit(null); return; }
    setBusy(true);
    try {
      const updated = await entityApi.update(moduleId, id, changes);
      if (updated._hierarchy_workflow) toast(t('record.hierarchyWorkflow', { id: updated._hierarchy_workflow.id }), 'info');
      else toast(t('record.saved', { name }));
      if (updated.ignored_fields?.length) toast(t('record.ignoredFields', { fields: updated.ignored_fields.join(', ') }), 'warning');
      setEdit(null); setAiFields(new Set());
      await load();
      onChanged?.(updated);
    } catch (e) { toast(t('record.saveFailed', { error: (e as Error).message }), 'error'); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!await confirm({ title: t('record.deleteTitle', { name }), message: t('record.deleteMessage'), danger: true, confirmLabel: t('common.delete'), typeToConfirm: name })) return;
    setBusy(true);
    try { await entityApi.delete(moduleId, id); toast(t('record.deleted', { name }), 'warning'); onDeleted?.(id); }
    catch (e) { toast(t('record.deleteFailed', { error: (e as Error).message }), 'error'); }
    finally { setBusy(false); }
  };
  const deactivate = async () => {
    if (!await confirm({ title: t('record.deactivateTitle', { name }), message: t('record.deactivateMessage'), confirmLabel: t('record.deactivate') })) return;
    setBusy(true);
    try {
      const wf = await workflowApi.create({ entity_type: entityType, entity_id: id, workflow_type: 'DEACTIVATION', priority: 'MEDIUM' });
      toast(t('record.deactivationCreated', { name })); await load();
      if (wf?.id) navigate(`/workflows/${wf.id}`);
    } catch (e) { toast(t('record.deactivationFailed', { error: (e as Error).message }), 'error'); }
    finally { setBusy(false); }
  };

  const openWorkflows = ctx.workflows.filter(w => !w.completed_at);
  const parentField = mod.hierarchy?.enabled && mod.hierarchy.type === 'self' ? mod.hierarchy.parent_field : null;
  const parentId = parentField ? record[parentField] as string | null : null;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: variant === 'drawer' ? '100%' : 'auto' }}>
      {/* Header */}
      <Box sx={{ p: variant === 'drawer' ? 2.5 : 0, pb: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1 }}>
          {record.lifecycle_stage && <StageChip stage={record.lifecycle_stage} />}
          <Chip size="small" variant="outlined" label={singular} />
          {record.is_deleted && <Chip size="small" color="default" label={t('record.mergedOrDeleted')} />}
          {edit && <Chip size="small" color="warning" label={t('record.editing')} />}
          {openWorkflows.map(w => (
            <Chip key={w.id} size="small" color="info" variant="outlined" clickable onClick={() => navigate(`/workflows/${w.id}`)}
              label={`${t(`workflowTypes.${w.workflow_type}`, { defaultValue: w.workflow_type })} · ${t(`stages.${w.current_stage}`, { defaultValue: w.current_stage })}`} />
          ))}
          <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <GoldenChip goldenId={record.golden_id} />
            {variant === 'drawer' && (
              <Tooltip title={t('record.openFullPage')}><IconButton size="small" onClick={() => navigate(`${modulePath(moduleId)}/${id}${tab !== 'details' ? `?tab=${tab}` : ''}`)}><OpenInFullIcon fontSize="small" /></IconButton></Tooltip>
            )}
            {onClose && <IconButton size="small" onClick={() => guard(onClose)}><CloseIcon fontSize="small" /></IconButton>}
          </Box>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant={variant === 'page' ? 'h4' : 'h5'} sx={{ fontWeight: 700, wordBreak: 'break-word' }}>{name}</Typography>
            <Typography variant="caption" color="text.secondary">
              {record.source_system} / {record.source_id}
              {parentId && <> · {t('record.parent')}: <RecordLink type={entityType} id={parentId}>{t('record.viewParent')}</RecordLink></>}
            </Typography>
          </Box>
          <Gauge label={t('record.dqScore')} value={record.dq_score} onClick={() => setTab('quality')} />
          <Gauge label={t('record.completeness')} value={record.completeness} />
        </Box>
      </Box>

      <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" sx={{ px: variant === 'drawer' ? 1 : 0, borderBottom: 1, borderColor: 'divider' }}>
        {TABS.map(k => (
          <Tab key={k} value={k} sx={{ textTransform: 'none', minHeight: 44 }} label={
            k === 'quality' ? `${t('record.tabs.quality')}${ctx.dq.failed ? ` (${ctx.dq.failed})` : ''}`
              : k === 'workflows' ? `${t('record.tabs.workflows')}${openWorkflows.length ? ` (${openWorkflows.length})` : ''}`
                : k === 'comments' ? `${t('record.tabs.comments')}${ctx.comments.length ? ` (${ctx.comments.length})` : ''}`
                  : t(`record.tabs.${k}`)} />
        ))}
      </Tabs>

      <Box sx={{ flex: 1, overflow: 'auto', p: variant === 'drawer' ? 2.5 : 0, pt: 2 }}>
        {tab === 'details' && (edit
          ? <RecordForm mod={mod} values={edit} errors={errors} highlight={aiFields} columns={variant === 'drawer' ? 1 : 2} fieldOptions={fieldOptions}
              onChange={(k, v) => { setEdit(prev => ({ ...prev!, [k]: v })); setErrors(prev => { const n = { ...prev }; delete n[k]; return n; }); }} />
          : <>
              {header?.(record)}
              <RecordFields mod={mod} record={record} defaultCurrency={brand.defaultCurrency} fieldOptions={fieldOptions} />
              {record.extended_attrs && typeof record.extended_attrs === 'object' && Object.keys(record.extended_attrs as object).length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Typography variant="overline" color="text.secondary">{t('record.extendedAttributes')}</Typography>
                  {Object.entries(record.extended_attrs as Record<string, unknown>).map(([k, v]) => (
                    <Box key={k} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.5, borderBottom: 1, borderColor: 'divider' }}>
                      <Typography variant="body2" color="text.secondary">{k.replace(/_/g, ' ')}</Typography><Typography variant="body2">{String(v)}</Typography>
                    </Box>
                  ))}
                </Box>
              )}
              <Typography variant="caption" color="text.secondary">
                {t('record.created')} {formatDate(record.created_at, true)} · {t('record.updated')} {formatDate(record.updated_at, true)}
              </Typography>
            </>)}

        {tab === 'quality' && (ctx.dq.total === 0
          ? <Typography color="text.secondary">{t('record.noDqResults')}</Typography>
          : <Table size="small">
              <TableHead><TableRow><TableCell>{t('record.rule')}</TableCell><TableCell>{t('record.severity')}</TableCell><TableCell>{t('record.result')}</TableCell></TableRow></TableHead>
              <TableBody>
                {ctx.dq.results.map(r => (
                  <TableRow key={r.rule_id} hover sx={{ cursor: 'pointer', bgcolor: r.passed ? undefined : alpha(statusColors().error, 0.04) }} onClick={() => navigate(`/data-quality/rules/${r.rule_id}`)}>
                    <TableCell><Typography variant="body2">{r.rule_name}</Typography><Typography variant="caption" color="text.secondary">{r.rule_code}</Typography></TableCell>
                    <TableCell><Chip size="small" label={r.severity} color={r.severity === 'ERROR' ? 'error' : r.severity === 'WARNING' ? 'warning' : 'default'} variant="outlined" /></TableCell>
                    <TableCell><Chip size="small" label={r.passed ? t('record.passed') : t('record.failed')} color={r.passed ? 'success' : 'error'} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>)}

        {tab === 'workflows' && (ctx.workflows.length === 0
          ? <Typography color="text.secondary">{t('record.noWorkflows')}</Typography>
          : <Table size="small">
              <TableHead><TableRow><TableCell>#</TableCell><TableCell>{t('record.type')}</TableCell><TableCell>{t('record.stage')}</TableCell><TableCell>{t('record.assignee')}</TableCell><TableCell>{t('record.created')}</TableCell></TableRow></TableHead>
              <TableBody>
                {ctx.workflows.map(w => (
                  <TableRow key={w.id} hover sx={{ opacity: w.completed_at ? 0.6 : 1 }}>
                    <TableCell><WorkflowLink id={w.id} /></TableCell>
                    <TableCell>{t(`workflowTypes.${w.workflow_type}`, { defaultValue: w.workflow_type })}</TableCell>
                    <TableCell><StageChip stage={w.current_stage} /></TableCell>
                    <TableCell><UserLink email={w.assigned_to} /></TableCell>
                    <TableCell>{formatDate(w.created_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>)}

        {tab === 'audit' && (audit === null ? <CircularProgress size={20} />
          : audit.length === 0 ? <Typography color="text.secondary">{t('record.noAudit')}</Typography>
            : <>
                {audit.map(a => (
                  <Box key={a.id} sx={{ py: 1, borderBottom: 1, borderColor: 'divider' }}>
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                      <Chip size="small" label={a.action} variant="outlined" sx={{ height: 20, fontSize: '0.65rem' }} />
                      <UserLink email={a.performed_by} />
                      <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>{formatDate(a.performed_at, true)}</Typography>
                    </Box>
                    {a.changed_fields && Object.entries(a.changed_fields).slice(0, 8).map(([f, c]) => (
                      <Typography key={f} variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
                        {f}: <s>{String(c?.old ?? '—')}</s> → {String(c?.new ?? '—')}
                      </Typography>
                    ))}
                  </Box>
                ))}
                <Button size="small" sx={{ mt: 1 }} onClick={() => navigate(`/audit?entity_type=${entityType}&entity_id=${id}`)}>{t('record.fullAudit')}</Button>
              </>)}

        {tab === 'comments' && (
          <Box>
            {canEdit && (
              <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
                <TextField size="small" fullWidth multiline maxRows={4} placeholder={t('record.addComment')} value={comment} onChange={e => setComment(e.target.value)} />
                <Button variant="contained" disabled={!comment.trim() || busy} onClick={async () => {
                  try { await entityApi.addComment(moduleId, id, comment.trim()); setComment(''); await load(); }
                  catch (e) { toast((e as Error).message, 'error'); }
                }}>{t('record.post')}</Button>
              </Box>
            )}
            {ctx.comments.length === 0 && <Typography color="text.secondary">{t('record.noComments')}</Typography>}
            {ctx.comments.map(c => (
              <Box key={c.id} sx={{ py: 1, borderBottom: 1, borderColor: 'divider' }}>
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{c.comment_text}</Typography>
                <Typography variant="caption" color="text.secondary"><UserLink email={c.created_by} /> · {formatDate(c.created_at, true)}</Typography>
              </Box>
            ))}
          </Box>
        )}
      </Box>

      {/* Footer actions */}
      {canEdit && !record.is_deleted && (
        <Box sx={{ p: 2, borderTop: 1, borderColor: 'divider', display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {edit ? (<>
            <Button onClick={() => guard(() => { setEdit(null); setAiFields(new Set()); setErrors({}); })} disabled={busy}>{t('common.cancel')}</Button>
            <Button variant="contained" color="success" sx={{ ml: 'auto' }} disabled={busy} startIcon={busy ? <CircularProgress size={16} /> : <SaveIcon />} onClick={save}>{t('common.save')}</Button>
          </>) : (<>
            <Button color="warning" size="small" startIcon={<ArchiveIcon />} onClick={deactivate} disabled={busy}>{t('record.deactivate')}</Button>
            {isAdmin && <Button color="error" size="small" startIcon={<DeleteIcon />} onClick={remove} disabled={busy}>{t('common.delete')}</Button>}
            {extraActions?.(record, { edit: startEdit, reload: load })}
            <Button variant="contained" size="small" startIcon={<EditIcon />} sx={{ ml: 'auto' }} onClick={() => startEdit()}>{t('common.edit')}</Button>
          </>)}
        </Box>
      )}
    </Box>
  );
}
