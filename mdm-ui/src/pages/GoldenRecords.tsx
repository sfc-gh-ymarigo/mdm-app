import { useNavigate, useParams } from 'react-router-dom';
import { useState, useEffect, useMemo } from 'react';
import {
  Box, Typography, Card, CardContent, Chip, TextField, InputAdornment, Tabs, Tab,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper,
  Dialog, DialogTitle, DialogContent, IconButton, CircularProgress, Tooltip, alpha,
  useTheme, TablePagination,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import JoinInnerIcon from '@mui/icons-material/JoinInner';
import LinkIcon from '@mui/icons-material/Link';
import HistoryIcon from '@mui/icons-material/History';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import CloseIcon from '@mui/icons-material/Close';
import StageChip from '../components/StageChip';
import DqScoreBar from '../components/DqScoreBar';
import { goldenApi } from '../api/client';
import type { GoldenRecord, GoldenRecordDetail } from '../types/models';
import { useBrand } from '../config/BrandContext';
import { useBreadcrumbLabel } from '../components/common/Breadcrumbs';
import { RecordLink, useRecordPath } from '../components/common/Links';
import { PAGE_SIZES, useDebounced, useServerList } from '../components/common/useServerList';
import { SYSTEM_FIELDS, activeFields, fieldLabel } from '../components/common/fields';
import { localized, tr } from '../i18n';
import TabCount from '../components/common/TabCount';
import i18n from '../i18n';

import { formatDate } from '../components/common/format';
export default function GoldenRecords() {
  const theme = useTheme();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [tab, setTab] = useState(0);
  const brand = useBrand();
  const modules = brand.modules.filter(m => m.enabled);
  const currentModule = modules[tab];
  const entityType = currentModule?.id.toUpperCase() ?? 'CUSTOMER';
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState<GoldenRecordDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);

  const debouncedSearch = useDebounced(search);
  const query = useMemo(() => ({ entity_type: entityType, q: debouncedSearch.trim() || null }), [entityType, debouncedSearch]);
  const list = useServerList<GoldenRecord>(goldenApi.page, query, { onError: e => console.error(e) });
  const { rows: filtered, loading } = list;
  // Tab badges: total per module (one 1-row page each)
  const moduleKey = modules.map(m => m.id).join(',');
  useEffect(() => {
    Promise.all(modules.map(async m => [m.id.toUpperCase(), (await goldenApi.page(new URLSearchParams({ entity_type: m.id.toUpperCase(), page: '0', size: '1' }))).total] as const))
      .then(r => setCounts(Object.fromEntries(r))).catch(() => {});
  }, [moduleKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // The open golden record lives in the URL: /golden/:goldenId
  const { goldenId: routeGoldenId } = useParams();
  const navigate = useNavigate();
  const openDetail = (goldenId: string) => navigate(`/golden/${encodeURIComponent(goldenId)}`);
  const closeDetail = () => navigate('/golden');
  const recordPath = useRecordPath();
  const survivor = detail?.survivor as unknown as Record<string, unknown> | undefined;
  const nameField = modules.find(m => m.id.toUpperCase() === detail?.entity_type)?.name_field;
  useBreadcrumbLabel(routeGoldenId ? String((nameField && survivor?.[nameField]) || routeGoldenId) : null);
  useEffect(() => {
    if (routeGoldenId) loadDetail(routeGoldenId); else { setDetailOpen(false); setDetail(null); }
  }, [routeGoldenId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadDetail(goldenId: string) {
    setDetailOpen(true);
    setDetailLoading(true);
    try { setDetail(await goldenApi.get(goldenId)); } catch (e) { console.error(e); }
    setDetailLoading(false);
  }

  const countByEntity = counts;

  return (
    <Box>
      <Typography variant="h5" fontWeight={700} gutterBottom>{tr('goldenRecords.goldenRecords')}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {tr('goldenRecords.unifiedMasterRecordsWithSource')}
      </Typography>

      <Tabs value={tab} onChange={(_, v) => { setTab(v); setSearch(''); }} sx={{ mb: 2 }}>
        {modules.map(m => (
          <Tab key={m.id} label={<TabCount label={localized(m.label, m.labels)} count={countByEntity[m.id.toUpperCase()] ?? 0} />} />
        ))}
      </Tabs>

      <TextField
        size="small" placeholder={tr('goldenRecords.searchGolden', { entity: (modules.find(m => m.id.toUpperCase() === entityType)?.singular_labels?.[i18n.language] ?? modules.find(m => m.id.toUpperCase() === entityType)?.singular ?? entityType).toLowerCase() })}
        value={search} onChange={e => setSearch(e.target.value)} sx={{ mb: 2, width: 400 }}
        InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
      />

      {loading && filtered.length === 0 ? <CircularProgress /> : filtered.length === 0 ? (
        <Card><CardContent><Typography color="text.secondary">
          {tr('goldenRecords.noGoldenRecordsFoundGolden')}
        </Typography></CardContent></Card>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{tr('goldenRecords.goldenId')}</TableCell>
                <TableCell>{tr('goldenRecords.name')}</TableCell>
                <TableCell>{tr('goldenRecords.stage')}</TableCell>
                <TableCell>{tr('goldenRecords.dqScore')}</TableCell>
                <TableCell align="center">{tr('goldenRecords.sources')}</TableCell>
                <TableCell align="center">{tr('goldenRecords.merged')}</TableCell>
                <TableCell>{tr('goldenRecords.sourceSystems')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.map(r => (
                <TableRow
                  key={r.golden_id} hover sx={{ cursor: 'pointer' }}
                  onClick={() => openDetail(r.golden_id)}
                >
                  <TableCell>
                    <Chip icon={<LinkIcon />} label={r.golden_id} size="small" variant="outlined"
                      sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }} />
                  </TableCell>
                  <TableCell><Typography variant="body2" fontWeight={600}>{r.golden_name}</Typography></TableCell>
                  <TableCell><StageChip stage={r.lifecycle_stage} /></TableCell>
                  <TableCell>{r.dq_score != null && <DqScoreBar value={r.dq_score} />}</TableCell>
                  <TableCell align="center">
                    <Chip label={r.active_count} size="small" color="success" variant="outlined" />
                  </TableCell>
                  <TableCell align="center">
                    <Chip label={r.merged_count} size="small" color="default" variant="outlined"
                      icon={<JoinInnerIcon />} />
                  </TableCell>
                  <TableCell>
                    {r.sources.map((s: { source_system: string }, i: number) => (
                      <Chip key={i} label={s.source_system} size="small" sx={{ mr: 0.5, mb: 0.5 }}
                        variant="outlined" />
                    ))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <TablePagination component="div" count={list.pager.total} page={list.pager.page} rowsPerPage={list.pager.size}
            rowsPerPageOptions={PAGE_SIZES} onPageChange={(_, p) => list.pager.setPage(p)}
            onRowsPerPageChange={e => list.pager.setSize(Number(e.target.value))} />
        </TableContainer>
      )}

      {/* Detail dialog */}
      <Dialog open={detailOpen} onClose={() => closeDetail()} maxWidth="lg" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <AccountTreeIcon />
          {tr('goldenRecords.dialogTitle', { id: detail?.golden_id ?? '' })}
          <Box flex={1} />
          <IconButton onClick={() => closeDetail()}><CloseIcon /></IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {detailLoading ? <Box textAlign="center" py={4}><CircularProgress /></Box> : detail ? (
            <Box>
              {/* Survivor card */}
              <Typography variant="subtitle1" fontWeight={700} gutterBottom>
                <CheckCircleIcon fontSize="small" color="success" sx={{ verticalAlign: 'middle', mr: 0.5 }} />
                {tr('goldenRecords.survivorRecord')}
              </Typography>
              <Card variant="outlined" sx={{ mb: 3, bgcolor: alpha(theme.palette.success.main, 0.04) }}>
                <CardContent>
                  <SurvivorFields entity={detail.survivor as unknown as Record<string, unknown>} entityType={detail.entity_type} />
                </CardContent>
              </Card>

              {/* Cross-reference table */}
              <Typography variant="subtitle1" fontWeight={700} gutterBottom>
                <LinkIcon fontSize="small" sx={{ verticalAlign: 'middle', mr: 0.5 }} />
                {tr('goldenRecords.crossReferences', { count: detail.xrefs.length })}
              </Typography>
              <TableContainer component={Paper} variant="outlined" sx={{ mb: 3 }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>{tr('goldenRecords.sourceSystem')}</TableCell>
                      <TableCell>{tr('goldenRecords.sourceId')}</TableCell>
                      <TableCell>{tr('goldenRecords.recordId')}</TableCell>
                      <TableCell>{tr('goldenRecords.status')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {detail.xrefs.map(x => (
                      <TableRow key={x.id}>
                        <TableCell><Chip label={x.source_system} size="small" variant="outlined" /></TableCell>
                        <TableCell sx={{ fontFamily: 'monospace' }}>{x.source_id}</TableCell>
                        <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }}><RecordLink type={detail.entity_type} id={x.id} /></TableCell>
                        <TableCell>
                          {x.is_survivor ? (
                            <Chip icon={<CheckCircleIcon />} label={tr('goldenRecords.survivor')} size="small" color="success" />
                          ) : (
                            <Chip icon={<CancelIcon />} label={tr('goldenRecords.merged')} size="small" color="default" />
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>

              {/* Merge history with survivorship */}
              {detail.merge_history.length > 0 && (<>
                <Typography variant="subtitle1" fontWeight={700} gutterBottom>
                  <JoinInnerIcon fontSize="small" sx={{ verticalAlign: 'middle', mr: 0.5 }} />
                  {tr('goldenRecords.mergeHistory')}
                </Typography>
                {detail.merge_history.map(mh => (
                  <Card key={mh.id} variant="outlined" sx={{ mb: 2 }}>
                    <CardContent>
                      <Box display="flex" alignItems="center" gap={1} mb={1}>
                        <Chip label={mh.survivor_name || mh.survivor_id} size="small" color="success" clickable onClick={() => { const to = recordPath(detail.entity_type, mh.survivor_id); if (to) navigate(to); }} />
                        <Typography variant="body2" color="text.secondary">&larr; merged with &rarr;</Typography>
                        <Chip label={mh.merged_name || mh.merged_id} size="small"
                          sx={{ textDecoration: 'line-through', opacity: 0.7 }} />
                        <Box flex={1} />
                        <Typography variant="caption" color="text.secondary">
                          {tr('goldenRecords.byMergedByOnV1', { merged_by: mh.merged_by, v1: formatDate(mh.merged_at, true) })}
                        </Typography>
                      </Box>
                      {mh.survivorship && (
                        <Box display="flex" flexWrap="wrap" gap={0.5}>
                          {Object.entries(mh.survivorship).map(([field, info]) => (
                            <Tooltip key={field} title={`Value: ${String(info.value ?? 'null')}`}>
                              <Chip label={`${field}: ${info.source}`} size="small" variant="outlined"
                                sx={{ fontSize: '0.7rem' }} />
                            </Tooltip>
                          ))}
                        </Box>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </>)}

              {/* Audit trail */}
              {detail.audit_trail.length > 0 && (<>
                <Typography variant="subtitle1" fontWeight={700} gutterBottom>
                  <HistoryIcon fontSize="small" sx={{ verticalAlign: 'middle', mr: 0.5 }} />
                  {tr('goldenRecords.auditTrail')}
                </Typography>
                <Box sx={{ maxHeight: 300, overflow: 'auto' }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>{tr('goldenRecords.when')}</TableCell>
                        <TableCell>{tr('goldenRecords.action')}</TableCell>
                        <TableCell>{tr('goldenRecords.by')}</TableCell>
                        <TableCell>{tr('goldenRecords.changes')}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {detail.audit_trail.map(a => (
                        <TableRow key={a.id}>
                          <TableCell sx={{ fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
                            {formatDate(a.performed_at, true)}
                          </TableCell>
                          <TableCell>
                            <Chip label={a.action} size="small" variant="outlined"
                              color={a.action === 'INSERT' ? 'success' : a.action === 'DELETE' ? 'error' : 'warning'} />
                          </TableCell>
                          <TableCell sx={{ fontSize: '0.75rem' }}>{a.performed_by}</TableCell>
                          <TableCell sx={{ fontSize: '0.7rem' }}>
                            {a.changed_fields ? Object.keys(a.changed_fields).join(', ') : '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              </>)}
            </Box>
          ) : null}
        </DialogContent>
      </Dialog>
    </Box>
  );
}

function SurvivorFields({ entity, entityType }: { entity: Record<string, unknown>; entityType: string }) {
  const brand = useBrand();
  const mod = brand.modules.find(m => m.id.toUpperCase() === entityType);
  const fields = [...(mod ? activeFields(mod).filter(f => !SYSTEM_FIELDS.has(f.name)).map(f => f.name) : []), 'source_system', 'source_id'];
  const labelOf = (name: string) => { const f = mod?.fields.find(x => x.name === name); return f ? fieldLabel(f) : tr(`list.${name === 'source_id' ? 'sourceId' : 'sourceSystem'}`); };

  return (
    <Box display="flex" flexWrap="wrap" gap={1}>
      {fields.map(f => {
        const val = entity[f];
        if (val == null || val === '') return null;
        return (
          <Chip key={f} label={`${labelOf(f)}: ${String(val)}`} size="small" variant="outlined"
            sx={{ fontSize: '0.75rem' }} />
        );
      })}
    </Box>
  );
}
