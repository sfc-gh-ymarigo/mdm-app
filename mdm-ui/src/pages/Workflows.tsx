import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Box, Typography, Card, CardContent, Chip, alpha, Button, Avatar, Tooltip, useTheme, Dialog, DialogTitle, DialogContent, DialogActions, TextField, CircularProgress,
  Tabs, Tab, InputAdornment, Drawer, Divider, IconButton, Select, MenuItem, FormControl,
  InputLabel, Menu

} from '@mui/material';
import { DataGrid, type GridColDef } from '@mui/x-data-grid';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import SearchIcon from '@mui/icons-material/Search';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import EditNoteIcon from '@mui/icons-material/EditNote';
import JoinInnerIcon from '@mui/icons-material/JoinInner';
import ArchiveIcon from '@mui/icons-material/Archive';
import DeviceHubIcon from '@mui/icons-material/DeviceHub';
import CloseIcon from '@mui/icons-material/Close';
import BlockIcon from '@mui/icons-material/Block';
import PersonIcon from '@mui/icons-material/Person';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { workflowApi } from '../api/client';
import { STAGE_COLORS, getWorkflowStages } from '../types/models';
import type { WorkflowInstance } from '../types/models';
import { useUser } from '../context/UserContext';
import { useBrand } from '../config/BrandContext';
import { useToast, type ToastSeverity } from '../components/common/Toast';
import { useBreadcrumbLabel } from '../components/common/Breadcrumbs';
import { RecordLink, UserLink } from '../components/common/Links';
import { localized, tr } from '../i18n';
import TabCount from '../components/common/TabCount';
import { useDebounced, useServerList } from '../components/common/useServerList';

import { formatDate } from '../components/common/format';
import { liveColors, priorityColor as priorityOf, workflowTypeColor, statusColors } from '../theme/brandColors';
const priorityColor = liveColors(['HIGH', 'MEDIUM', 'LOW'], priorityOf);

const WORKFLOW_META: Record<string, { label: string; description: string; icon: React.ReactNode; color: string }> = {
  ONBOARDING:       { label: tr('workflows.onboarding'),        description: tr('workflows.newEntityCreationThroughApproval'),            icon: <AddCircleOutlineIcon />, get color() { return workflowTypeColor('ONBOARDING'); } },
  ENRICHMENT:       { label: tr('workflows.dataUpdate'),        description: tr('workflows.completeOrCorrectDataOn'),           icon: <EditNoteIcon />,         get color() { return workflowTypeColor('ENRICHMENT'); } },
  MERGE:            { label: tr('workflows.merge'),              description: tr('workflows.combineDuplicateRecordsIntoA'),  icon: <JoinInnerIcon />,            get color() { return workflowTypeColor('MERGE'); } },
  DEACTIVATION:     { label: tr('workflows.deactivation'),       description: tr('workflows.retireOrArchiveAnEntity'),   icon: <ArchiveIcon />,          get color() { return workflowTypeColor('DEACTIVATION'); } },
  HIERARCHY_CHANGE: { label: tr('workflows.hierarchyChange'),   description: tr('workflows.moveARecordToA'),icon: <DeviceHubIcon />,        get color() { return workflowTypeColor('HIERARCHY_CHANGE'); } },
};

const REJECT_LABEL: Record<string, string> = {
  HIERARCHY_CHANGE: tr('workflows.cancel'),
  DEACTIVATION: tr('workflows.reject'),
};

export default function Workflows() {
  const { canEdit, users, currentUser } = useUser();
  // Same rule as the API: a step needs its required workflow role (or MDM_ADMIN)
  const myRoles = currentUser?.mdm_roles ?? [];
  const canTake = (role: string | null) => !role || myRoles.includes('MDM_ADMIN') || myRoles.includes(role);
  const allowedSteps = (wf: WorkflowInstance) => (wf.available_transitions ?? []).filter(t => canTake(t.required_role));
  /** Why approve/reject is unavailable, or null when the user may act. */
  const blockedReason = (wf: WorkflowInstance): string | null => {
    const steps = wf.available_transitions ?? [];
    if (!steps.length) return tr('workflows.lastStage');
    if (allowedSteps(wf).length) return null;
    const needed = [...new Set(steps.map(t => t.required_role).filter(Boolean))].join(' or ');
    return tr('workflows.requiresRole', { roles: needed }) + (myRoles.length ? tr('workflows.youHave', { roles: myRoles.join(', ') }) : '');
  };
  const theme = useTheme();
  const [counts, setCounts] = useState<{ entity_type: string; workflow_type: string; count: number }[]>([]);
  const toast = useToast();
  const setSnack = (s: { msg: string; severity: ToastSeverity } | null) => { if (s) toast(s.msg, s.severity); };
  const [rejectDialog, setRejectDialog] = useState<WorkflowInstance | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState(0);
  const [detailWf, setDetailWf] = useState<WorkflowInstance | null>(null);
  // The open workflow lives in the URL (/workflows/:workflowId), so it can be linked and survives reloads
  const { workflowId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const openDetail = (id: number) => navigate(`/workflows/${id}${location.search}`);
  const closeDetail = () => { if (workflowId) navigate(`/workflows${location.search}`); else setDetailWf(null); };
  useBreadcrumbLabel(workflowId && detailWf ? `#${detailWf.id} ${detailWf.entity_name ?? ''}`.trim() : null);
  const [reassignWf, setReassignWf] = useState<WorkflowInstance | null>(null);
  const [reassignTo, setReassignTo] = useState('');
  const [cancelWf, setCancelWf] = useState<WorkflowInstance | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [approveMenu, setApproveMenu] = useState<{ anchor: HTMLElement; wf: WorkflowInstance } | null>(null);

  const brand = useBrand();
  const modules = brand.modules.filter(m => m.enabled);
  const currentModule = modules[tab];
  const currentEntityType = currentModule?.id.toUpperCase() ?? 'CUSTOMER';

  const [searchByTab, setSearchByTab] = useState<Record<number, string>>({});

  const currentSearch = searchByTab[tab] ?? '';
  const setCurrentSearch = (v: string) => setSearchByTab(prev => ({ ...prev, [tab]: v }));
  const debouncedSearch = useDebounced(currentSearch);
  const query = useMemo(() => ({ entity_type: currentEntityType, q: debouncedSearch.trim() || null }), [currentEntityType, debouncedSearch]);
  const onListError = useCallback((e: Error) => setSnack({ msg: tr('workflows.failedToLoadV0', { v0: e.message }), severity: 'error' }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const list = useServerList(workflowApi.page, query, { defaultSize: 10, onError: onListError });
  const { rows: currentList, loading } = list;

  const fetchWorkflows = useCallback(async () => {
    list.reload();
    try { setCounts(await workflowApi.counts()); } catch { /* badges only */ }
  }, [list.reload]); // eslint-disable-line react-hooks/exhaustive-deps
  // Open the workflow named in the URL: from the loaded page, else fetched (e.g. completed ones)
  useEffect(() => {
    if (!workflowId) { setDetailWf(null); return; }
    const inList = currentList.find(w => String(w.id) === workflowId);
    if (inList) { setDetailWf(inList); return; }
    workflowApi.get(workflowId).then(w => setDetailWf(w)).catch(() => { setSnack({ msg: tr('workflows.workflowWorkflowidNotFound', { workflowId }), severity: 'warning' }); navigate('/workflows', { replace: true }); });
  }, [workflowId, currentList]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { workflowApi.counts().then(setCounts).catch(() => {}); }, []);

  const countFor = (entityType: string, type?: string) =>
    counts.filter(c => c.entity_type === entityType && (!type || c.workflow_type === type)).reduce((s, c) => s + c.count, 0);
  const totalOpen = counts.reduce((s, c) => s + c.count, 0);

  // Several possible next stages: let the user pick one from a menu
  const startApprove = (wf: WorkflowInstance, anchor: HTMLElement) => {
    const steps = allowedSteps(wf);
    if (steps.length > 1) setApproveMenu({ anchor, wf });
    else handleApprove(wf, steps[0]?.to_stage);
  };

  const handleApprove = async (wf: WorkflowInstance, toStage?: string) => {
    try {
      setSaving(true);
      const result = await workflowApi.advance(wf.id, 'APPROVE', 'Approved via UI', toStage);
      setSnack({ msg: `${wf.entity_name}: ${wf.current_stage} → ${result.new_stage}${result.terminal ? ' (completed)' : ''}`, severity: 'success' });
      await fetchWorkflows();
    } catch (e) { setSnack({ msg: `${(e as Error).message}`, severity: 'error' }); }
    finally { setSaving(false); }
  };

  const confirmReject = async () => {
    if (!rejectDialog) return;
    const isHierarchy = rejectDialog.workflow_type === 'HIERARCHY_CHANGE';
    try {
      setSaving(true);
      const result = await workflowApi.advance(rejectDialog.id, 'REJECT', rejectReason);
      setSnack({ msg: isHierarchy ? tr('workflows.hierarchyCancelled', { name: rejectDialog.entity_name }) : result.entity_stage ? tr('workflows.rejectedTo', { name: rejectDialog.entity_name, stage: result.entity_stage }) : tr('workflows.rejected', { name: rejectDialog.entity_name }), severity: 'warning' });
      setRejectDialog(null); setRejectReason('');
      await fetchWorkflows();
    } catch (e) { setSnack({ msg: `${(e as Error).message}`, severity: 'error' }); }
    finally { setSaving(false); }
  };

  const confirmCancel = async () => {
    if (!cancelWf) return;
    try {
      setSaving(true);
      await workflowApi.cancel(cancelWf.id, cancelReason || tr('workflows.cancelledByUser'));
      setSnack({ msg: tr('workflows.workflowForEntityNameCancelled', { entity_name: cancelWf.entity_name }), severity: 'info' });
      setCancelWf(null); setCancelReason('');
      await fetchWorkflows();
    } catch (e) { setSnack({ msg: `${(e as Error).message}`, severity: 'error' }); }
    finally { setSaving(false); }
  };

  const confirmReassign = async () => {
    if (!reassignWf || !reassignTo) return;
    try {
      setSaving(true);
      await workflowApi.reassign(reassignWf.id, reassignTo);
      setSnack({ msg: tr('workflows.workflowReassignedToV0', { v0: reassignTo.split('@')[0]?.replace('.', ' ') }), severity: 'success' });
      setReassignWf(null); setReassignTo('');
      await fetchWorkflows();
    } catch (e) { setSnack({ msg: `${(e as Error).message}`, severity: 'error' }); }
    finally { setSaving(false); }
  };

  // Format payload for display
  const formatPayload = (wf: WorkflowInstance) => {
    if (!wf.payload) return null;
    const p = wf.payload;
    if (wf.workflow_type === 'HIERARCHY_CHANGE') {
      return `Move ${p.field || 'parent'}: ${p.old_value ? String(p.old_value).substring(0, 8) + '…' : '(none)'} → ${p.new_value ? String(p.new_value).substring(0, 8) + '…' : '(none)'}`;
    }
    return JSON.stringify(p, null, 2);
  };

  const columns: GridColDef<WorkflowInstance>[] = [
    { field: 'entity_name', headerName: tr('workflows.entity'), flex: 1.2, minWidth: 180, renderCell: (p) => (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Typography variant="body2" sx={{ fontWeight: 500, color: theme.palette.text.primary, fontSize: '0.85rem' }}><RecordLink type={p.row.entity_type} id={p.row.entity_id}>{p.value}</RecordLink></Typography>
        {p.row.payload && (
          <Tooltip title={tr('workflows.hasDetailsClickRowTo')}><InfoOutlinedIcon sx={{ fontSize: 14, color: theme.palette.text.disabled }} /></Tooltip>
        )}
      </Box>
    )},
    { field: 'workflow_type', headerName: tr('workflows.type'), width: 150, renderCell: (p) => {
      const meta = WORKFLOW_META[p.value] || { label: p.value, color: statusColors().neutral, icon: null };
      return (
        <Chip
          icon={<Box sx={{ display: 'flex', color: meta.color, '& svg': { fontSize: '0.9rem' } }}>{meta.icon}</Box>}
          label={meta.label}
          size="small"
          sx={{ fontSize: '0.7rem', bgcolor: alpha(meta.color, 0.12), color: meta.color, fontWeight: 600 }}
        />
      );
    }},
    { field: 'current_stage', headerName: tr('workflows.progress'), flex: 2, minWidth: 320, renderCell: (p) => {
      const stages = getWorkflowStages(p.row.entity_type, p.row.workflow_type);
      const currentIdx = stages.indexOf(p.row.current_stage);
      const wfColor = WORKFLOW_META[p.row.workflow_type]?.color || statusColors().neutral;
      return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.2, py: 0.5, width: '100%' }}>
          {stages.map((s, i) => {
            const isCurrent = s === p.row.current_stage;
            const isPast = i < currentIdx;
            const isLast = i === stages.length - 1;
            const stepColor = STAGE_COLORS[s] || statusColors().neutral;
            return (
              <Box key={s} sx={{ display: 'flex', alignItems: 'center', gap: 0.2 }}>
                <Tooltip title={`${s}${isLast ? ' (goal)' : ''}${isCurrent ? ' — current' : ''}`}>
                  <Box sx={{
                    display: 'flex', alignItems: 'center', gap: 0.5,
                    px: 1, py: 0.3, borderRadius: 1,
                    bgcolor: isCurrent ? alpha(stepColor, 0.2) : isPast ? alpha(stepColor, 0.08) : alpha(theme.palette.text.disabled, 0.04),
                    border: isCurrent ? `1.5px solid ${stepColor}` : isPast ? `1px solid ${alpha(stepColor, 0.2)}` : `1px solid ${alpha(theme.palette.text.disabled, 0.08)}`,
                  }}>
                    {isPast && <CheckCircleIcon sx={{ fontSize: 11, color: alpha(stepColor, 0.6) }} />}
                    <Typography variant="caption" sx={{
                      fontSize: '0.62rem', fontWeight: isCurrent ? 700 : 400, lineHeight: 1,
                      color: isCurrent ? stepColor : isPast ? alpha(stepColor, 0.7) : theme.palette.text.disabled,
                    }}>{s}</Typography>
                  </Box>
                </Tooltip>
                {i < stages.length - 1 && (
                  <Box sx={{
                    width: 12, height: 2, borderRadius: 1,
                    bgcolor: isPast ? alpha(wfColor, 0.4) : alpha(theme.palette.divider, 0.5),
                  }} />
                )}
              </Box>
            );
          })}
        </Box>
      );
    }},
    { field: 'priority', headerName: tr('workflows.priority'), width: 100, renderCell: (p) => (
      <Chip label={p.value} size="small" sx={{ fontSize: '0.7rem', bgcolor: alpha(priorityColor[p.value] || statusColors().neutral, 0.15), color: priorityColor[p.value] || statusColors().neutral }} />
    )},
    { field: 'assigned_to', headerName: tr('workflows.assignedTo'), width: 180, renderCell: (p) => (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Avatar sx={{ width: 24, height: 24, fontSize: '0.65rem', bgcolor: theme.palette.info.main }}>
          {p.value?.split('@')[0]?.split('.').map((n: string) => n[0]?.toUpperCase()).join('') ?? '?'}
        </Avatar>
        <Typography variant="caption"><UserLink email={p.value}>{p.value?.split('@')[0]?.replace('.', ' ') ?? p.value}</UserLink></Typography>
      </Box>
    )},
    { field: 'created_at', headerName: tr('workflows.created'), width: 110, renderCell: (p) => formatDate(p.value) },
    { field: 'actions', headerName: tr('workflows.actions'), width: 280, sortable: false, renderCell: (p) => {
      const wf = p.row;
      const rejectLabel = REJECT_LABEL[wf.workflow_type] || tr('workflows.reject');
      return (
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          {canEdit && <Tooltip title={blockedReason(wf) ?? tr('workflows.approveAdvanceStage')}>
            <span><Button size="small" color="success" startIcon={<CheckCircleIcon />} sx={{ fontSize: '0.7rem', minWidth: 0 }}
              onClick={(e) => { e.stopPropagation(); startApprove(wf, e.currentTarget); }} disabled={saving || !!blockedReason(wf)}>{tr('workflows.approve')}</Button></span>
          </Tooltip>}
          {canEdit && <Tooltip title={blockedReason(wf) ?? (wf.workflow_type === 'HIERARCHY_CHANGE' ? tr('workflows.cancelThisHierarchyChange') : 'Reject (record returns to its starting stage)')}>
            <span><Button size="small" color="error" startIcon={<CancelIcon />} sx={{ fontSize: '0.7rem', minWidth: 0 }}
              onClick={(e) => { e.stopPropagation(); setRejectDialog(wf); setRejectReason(''); }} disabled={saving || (!!blockedReason(wf) && !!wf.available_transitions?.length)}>{rejectLabel}</Button></span>
          </Tooltip>}
          {canEdit && <Tooltip title={tr('workflows.cancelWorkflow')}>
            <IconButton size="small" onClick={(e) => { e.stopPropagation(); setCancelWf(wf); setCancelReason(''); }} disabled={saving}>
              <BlockIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>}
          <Tooltip title={tr('workflows.reassign')}>
            <IconButton size="small" onClick={(e) => { e.stopPropagation(); setReassignWf(wf); setReassignTo(wf.assigned_to || ''); }} disabled={saving}>
              <SwapHorizIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        </Box>
      );
    }},
  ];

  const isDark = theme.palette.mode === 'dark';
  const dividerColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Box><Typography variant="h4" gutterBottom>{tr('workflows.workflowQueue')}</Typography><Typography variant="subtitle1">{totalOpen} active workflows {loading && <CircularProgress size={14} sx={{ ml: 1 }} />}</Typography></Box>
      </Box>

      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)}>
          {modules.map(m => (
            <Tab key={m.id} label={<TabCount label={localized(m.label, m.labels)} count={countFor(m.id.toUpperCase())} />} />
          ))}
        </Tabs>
      </Box>

      <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
        {(currentModule?.workflow?.types ?? ['ONBOARDING', 'ENRICHMENT', 'MERGE', 'DEACTIVATION', 'HIERARCHY_CHANGE']).map(type => {
          const meta = WORKFLOW_META[type] ?? { label: type, description: '', icon: <AddCircleOutlineIcon />, color: statusColors().neutral };
          const count = countFor(currentEntityType, type);
          return (
            <Card key={type} sx={{ flex: 1, borderLeft: `3px solid ${meta.color}` }}>
              <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                  <Box sx={{ color: meta.color, display: 'flex', '& svg': { fontSize: '1.1rem' } }}>{meta.icon}</Box>
                  <Typography variant="h5" sx={{ fontWeight: 700 }}>{count}</Typography>
                </Box>
                <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.8rem', mb: 0.25 }}>{meta.label}</Typography>
                <Typography variant="caption" sx={{ color: theme.palette.text.secondary, fontSize: '0.65rem', lineHeight: 1.3, display: 'block' }}>{meta.description}</Typography>
              </CardContent>
            </Card>
          );
        })}
      </Box>

      <TextField
        size="small"
        placeholder={tr('workflows.searchWorkflows', { entity: currentModule ? localized(currentModule.singular, currentModule.singular_labels).toLowerCase() : '' })}
        value={currentSearch}
        onChange={(e) => setCurrentSearch(e.target.value)}
        sx={{ mb: 2, width: 360 }}
        slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
      />

      <Card><DataGrid {...list.gridProps} columns={columns} pageSizeOptions={[10, 25, 50]} disableRowSelectionOnClick onRowClick={(params) => openDetail(params.row.id)} getRowHeight={() => 'auto'} sx={{ border: 'none', '& .MuiDataGrid-cell': { display: 'flex', alignItems: 'center', py: 1.5, minHeight: 60 }, cursor: 'pointer' }} /></Card>

      {/* Detail Drawer */}
      <Drawer anchor="right" open={!!detailWf} onClose={closeDetail} PaperProps={{ sx: { width: 380 } }}>
        {detailWf && (
          <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <Box sx={{ p: 2.5, borderBottom: `1px solid ${dividerColor}`, display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Box sx={{ color: WORKFLOW_META[detailWf.workflow_type]?.color || statusColors().neutral, display: 'flex' }}>
                {WORKFLOW_META[detailWf.workflow_type]?.icon}
              </Box>
              <Box sx={{ flex: 1 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 700, fontSize: '0.95rem' }}><RecordLink type={detailWf.entity_type} id={detailWf.entity_id}>{detailWf.entity_name}</RecordLink></Typography>
                <Typography variant="caption" color="text.secondary">{WORKFLOW_META[detailWf.workflow_type]?.label} #{detailWf.id}</Typography>
              </Box>
              <IconButton size="small" onClick={() => closeDetail()}><CloseIcon fontSize="small" /></IconButton>
            </Box>

            <Box sx={{ flex: 1, p: 2.5, overflow: 'auto' }}>
              {/* Status */}
              <Box sx={{ mb: 2.5 }}>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '0.65rem', mb: 1, display: 'block' }}>{tr('workflows.status')}</Typography>
                <Chip label={detailWf.current_stage} size="small" sx={{ bgcolor: alpha(STAGE_COLORS[detailWf.current_stage] || statusColors().neutral, 0.15), color: STAGE_COLORS[detailWf.current_stage] || statusColors().neutral, fontWeight: 600 }} />
              </Box>

              <Divider sx={{ mb: 2 }} />

              {/* Assignment */}
              <Box sx={{ mb: 2.5 }}>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '0.65rem', mb: 1, display: 'block' }}>{tr('workflows.assignment')}</Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                  <PersonIcon sx={{ fontSize: 16, color: theme.palette.text.secondary }} />
                  <Typography variant="body2">{detailWf.assigned_to ? <UserLink email={detailWf.assigned_to}>{detailWf.assigned_to.split('@')[0].replace('.', ' ')}</UserLink> : 'Unassigned'}</Typography>
                </Box>
                {detailWf.assigned_role && (
                  <Typography variant="caption" color="text.secondary">{tr('workflows.roleAssignedRole', { assigned_role: detailWf.assigned_role })}</Typography>
                )}
              </Box>

              {/* Priority */}
              <Box sx={{ mb: 2.5 }}>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '0.65rem', mb: 1, display: 'block' }}>{tr('workflows.priority')}</Typography>
                {canEdit && !detailWf.completed_at ? (
                  <Select
                    size="small"
                    value={detailWf.priority}
                    onChange={async (e) => {
                      const newPriority = e.target.value as string;
                      try {
                        await workflowApi.updatePriority(detailWf.id, newPriority);
                        setDetailWf({ ...detailWf, priority: newPriority });
                        list.reload();
                        setSnack({ msg: tr('workflows.priorityUpdatedToNewpriority', { newPriority }), severity: 'success' });
                      } catch { setSnack({ msg: tr('workflows.failedToUpdatePriority'), severity: 'error' }); }
                    }}
                    sx={{ minWidth: 100, '& .MuiSelect-select': { py: 0.5, fontSize: '0.8rem', color: priorityColor[detailWf.priority] || statusColors().neutral, fontWeight: 600 } }}
                  >
                    {['HIGH', 'MEDIUM', 'LOW'].map(p => (
                      <MenuItem key={p} value={p} sx={{ fontSize: '0.8rem', color: priorityColor[p], fontWeight: 600 }}>{p}</MenuItem>
                    ))}
                  </Select>
                ) : (
                  <Chip label={detailWf.priority} size="small" sx={{ bgcolor: alpha(priorityColor[detailWf.priority] || statusColors().neutral, 0.15), color: priorityColor[detailWf.priority] || statusColors().neutral }} />
                )}
              </Box>

              {/* Payload / Notes */}
              {(detailWf.payload || detailWf.notes) && (
                <>
                  <Divider sx={{ mb: 2 }} />
                  <Box sx={{ mb: 2.5 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '0.65rem', mb: 1, display: 'block' }}>{tr('workflows.details')}</Typography>
                    {detailWf.notes && (
                      <Typography variant="body2" sx={{ mb: 1 }}>{detailWf.notes}</Typography>
                    )}
                    {detailWf.payload && (
                      <Box sx={{ bgcolor: alpha(theme.palette.primary.main, 0.05), borderRadius: 1, p: 1.5, border: `1px solid ${alpha(theme.palette.primary.main, 0.1)}` }}>
                        <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: '0.75rem', whiteSpace: 'pre-wrap' }}>
                          {formatPayload(detailWf)}
                        </Typography>
                      </Box>
                    )}
                  </Box>
                </>
              )}

              <Divider sx={{ mb: 2 }} />

              {/* Metadata */}
              <Box sx={{ mb: 2 }}>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '0.65rem', mb: 1, display: 'block' }}>{tr('workflows.metadata')}</Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                  <Typography variant="caption">{tr('workflows.createdByV0', { v0: detailWf.created_by?.split('@')[0]?.replace('.', ' ') || '—' })}</Typography>
                  <Typography variant="caption">{tr('workflows.createdV0', { v0: formatDate(detailWf.created_at, true) })}</Typography>
                  <Typography variant="caption">{tr('workflows.entityId')} <code style={{ fontSize: '0.65rem' }}>{detailWf.entity_id.substring(0, 8)}…</code></Typography>
                </Box>
              </Box>
            </Box>

            {/* Actions footer */}
            {canEdit && !detailWf.completed_at && (
              <Box sx={{ p: 2, borderTop: `1px solid ${dividerColor}`, display: 'flex', gap: 1 }}>
                <Tooltip title={blockedReason(detailWf) ?? ''}><span style={{ flex: 1, display: 'flex' }}><Button size="small" variant="contained" color="success" startIcon={<CheckCircleIcon />} onClick={(e) => { const wf = detailWf; startApprove(wf, e.currentTarget); if (allowedSteps(wf).length <= 1) closeDetail(); }} disabled={saving || !!blockedReason(detailWf)} sx={{ flex: 1, textTransform: 'none' }}>{tr('workflows.approve')}</Button></span></Tooltip>
                <Tooltip title={blockedReason(detailWf) && detailWf.available_transitions?.length ? blockedReason(detailWf)! : ''}><span style={{ flex: 1, display: 'flex' }}><Button size="small" variant="outlined" color="error" startIcon={<CancelIcon />} onClick={() => { setRejectDialog(detailWf); closeDetail(); }} disabled={saving || (!!blockedReason(detailWf) && !!detailWf.available_transitions?.length)} sx={{ flex: 1, textTransform: 'none' }}>{REJECT_LABEL[detailWf.workflow_type] || tr('workflows.reject')}</Button></span></Tooltip>
                <Tooltip title={tr('workflows.cancelWorkflow')}><IconButton size="small" onClick={() => { setCancelWf(detailWf); closeDetail(); }}><BlockIcon fontSize="small" /></IconButton></Tooltip>
                <Tooltip title={tr('workflows.reassign')}><IconButton size="small" onClick={() => { setReassignWf(detailWf); setReassignTo(detailWf.assigned_to || ''); closeDetail(); }}><SwapHorizIcon fontSize="small" /></IconButton></Tooltip>
              </Box>
            )}
          </Box>
        )}
      </Drawer>

      {/* Next-stage choice when several transitions are possible */}
      <Menu anchorEl={approveMenu?.anchor} open={!!approveMenu} onClose={() => setApproveMenu(null)}>
        {approveMenu && allowedSteps(approveMenu.wf).map(t => (
          <MenuItem key={t.to_stage} onClick={() => { const wf = approveMenu.wf; setApproveMenu(null); closeDetail(); handleApprove(wf, t.to_stage); }}>
            → {t.to_stage}{t.required_role ? <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>({t.required_role})</Typography> : null}
          </MenuItem>
        ))}
      </Menu>

      {/* Reject dialog */}
      <Dialog open={!!rejectDialog} onClose={() => setRejectDialog(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{rejectDialog?.workflow_type === 'HIERARCHY_CHANGE' ? tr('workflows.cancelHierarchyChange') : 'Reject Workflow'}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>
            {rejectDialog?.workflow_type === 'HIERARCHY_CHANGE'
              ? <>{tr('workflows.cancellingHierarchyChangeFor')} <strong>{rejectDialog?.entity_name}</strong>. The proposed move will be discarded.</>
              : <>{tr('workflows.rejecting')} <strong>{rejectDialog?.entity_name}</strong> {tr('workflows.closesThisWorkflowTheRecord')}</>
            }
          </Typography>
          <TextField fullWidth multiline rows={2} label={tr('workflows.reason')} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} required />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejectDialog(null)} disabled={saving}>{tr('workflows.cancel')}</Button>
          <Button variant="contained" color="error" onClick={confirmReject} disabled={!rejectReason.trim() || saving}
            startIcon={saving ? <CircularProgress size={16} /> : <CancelIcon />}>
            {rejectDialog?.workflow_type === 'HIERARCHY_CHANGE' ? tr('workflows.discardChange') : 'Reject'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Cancel dialog */}
      <Dialog open={!!cancelWf} onClose={() => setCancelWf(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{tr('workflows.cancelWorkflow2')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>{tr('workflows.cancelTheV0WorkflowFor', { v0: WORKFLOW_META[cancelWf?.workflow_type || '']?.label || cancelWf?.workflow_type })} <strong>{cancelWf?.entity_name}</strong>{tr('workflows.thisWillCloseTheWorkflow')}</Typography>
          <TextField fullWidth multiline rows={2} label={tr('workflows.reasonOptional')} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCancelWf(null)} disabled={saving}>{tr('workflows.back')}</Button>
          <Button variant="contained" color="warning" onClick={confirmCancel} disabled={saving}
            startIcon={saving ? <CircularProgress size={16} /> : <BlockIcon />}>{tr('workflows.cancelWorkflow2')}</Button>
        </DialogActions>
      </Dialog>

      {/* Reassign dialog */}
      <Dialog open={!!reassignWf} onClose={() => setReassignWf(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{tr('workflows.reassignWorkflow')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>{tr('workflows.reassignTheV0WorkflowFor', { v0: WORKFLOW_META[reassignWf?.workflow_type || '']?.label })} <strong>{reassignWf?.entity_name}</strong>.</Typography>
          <FormControl size="small" fullWidth>
            <InputLabel>{tr('workflows.assignTo')}</InputLabel>
            <Select value={reassignTo} label={tr('workflows.assignTo')} onChange={(e) => setReassignTo(e.target.value)}>
              {users.filter(u => u.is_active && u.role !== 'VIEWER').map(u => (
                <MenuItem key={u.email} value={u.email}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="body2">{u.display_name}</Typography>
                    <Chip label={u.role} size="small" sx={{ fontSize: '0.6rem', height: 18 }} />
                    {u.mdm_roles?.length > 0 && <Typography variant="caption" color="text.secondary">{u.mdm_roles.join(', ')}</Typography>}
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReassignWf(null)} disabled={saving}>{tr('workflows.cancel')}</Button>
          <Button variant="contained" onClick={confirmReassign} disabled={!reassignTo || saving}
            startIcon={saving ? <CircularProgress size={16} /> : <SwapHorizIcon />}>{tr('workflows.reassign')}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
