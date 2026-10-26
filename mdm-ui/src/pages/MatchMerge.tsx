import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Box, Typography, Card, CardContent, Chip, alpha, Button, Grid2 as Grid, useTheme, Dialog, DialogTitle, DialogContent, DialogActions, TextField, CircularProgress,
  Tabs, Tab, InputAdornment, ToggleButtonGroup, ToggleButton, Tooltip, IconButton,
  Collapse, TablePagination, Select, MenuItem, FormControl, InputLabel

} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import SearchIcon from '@mui/icons-material/Search';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import SortIcon from '@mui/icons-material/Sort';
import VpnKeyIcon from '@mui/icons-material/VpnKey';
import TextFieldsIcon from '@mui/icons-material/TextFields';
import RecordVoiceOverIcon from '@mui/icons-material/RecordVoiceOver';
import TuneIcon from '@mui/icons-material/Tune';
import PlaceIcon from '@mui/icons-material/Place';
import HubIcon from '@mui/icons-material/Hub';
import PsychologyIcon from '@mui/icons-material/Psychology';
import StageChip from '../components/StageChip';
import DqScoreBar from '../components/DqScoreBar';
import MergeHistory from '../components/MergeHistory';
import { matchApi } from '../api/client';
import { useDebounced, useServerList } from '../components/common/useServerList';
import type { MatchCandidate, Customer, Product } from '../types/models';
import { useUser } from '../context/UserContext';
import { useBrand } from '../config/BrandContext';
import { useToast, type ToastSeverity } from '../components/common/Toast';
import { RecordLink } from '../components/common/Links';
import { FieldDisplay, SYSTEM_FIELDS, activeFields, fieldLabel } from '../components/common/fields';
import { localized, tr } from '../i18n';
import TabCount from '../components/common/TabCount';

import { matchMethodColor, matchScoreColor, statusColors, seriesColor } from '../theme/brandColors';
const methodColor = matchMethodColor;
function methodLabel(method: string): string {
  if (method.endsWith('+LLM')) {
    const base = method.replace('+LLM', '');
    const baseLabel = base.charAt(0) + base.slice(1).toLowerCase();
    return `${baseLabel} → LLM`;
  }
  return method;
}

/** Display name of a record: the module's configured name field (legal_name, name, company_name …). */
function entityName(nameField: string | undefined, entity: Customer | Product | null): string {
  if (!entity) return 'Unknown';
  const row = entity as unknown as Record<string, unknown>;
  return String(row[nameField || 'name'] ?? row.legal_name ?? row.name ?? row.id ?? '');
}

function EntityCard({ entityType, entity }: { entityType: string; entity: Customer | Product | null }) {
  const theme = useTheme();
  const brand = useBrand();
  if (!entity) return <Typography variant="body2">{tr('matchMerge.unknownEntity')}</Typography>;
  const mod = brand.modules.find(m => m.id.toUpperCase() === entityType);
  const row = entity as unknown as Record<string, unknown>;
  const name = String(row[mod?.name_field ?? 'id'] ?? '');
  // Card fields come from the module config: card_display, else the first list columns
  const fields = mod ? (activeFields(mod).filter(f => f.card_display).length ? activeFields(mod).filter(f => f.card_display) : activeFields(mod).filter(f => f.list_display && f.name !== mod.name_field)).slice(0, 4) : [];
  return (
    <Card sx={{ bgcolor: alpha(theme.palette.text.primary, 0.02) }}>
      <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}><StageChip stage={entity.lifecycle_stage} /><Chip label={entity.source_system} size="small" variant="outlined" sx={{ fontSize: '0.6rem' }} /></Box>
        <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>{name}</Typography>
        <Box>{fields.map(f => (
          <Box key={f.name} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 0.15 }}>
            <Typography variant="caption" sx={{ color: theme.palette.text.secondary, fontSize: '0.68rem' }}>{fieldLabel(f)}</Typography>
            <FieldDisplay field={f} value={row[f.name]} record={row} defaultCurrency={brand.defaultCurrency} />
          </Box>
        ))}</Box>
        <Box sx={{ mt: 0.5 }}><DqScoreBar value={entity.dq_score != null ? parseFloat(String(entity.dq_score)) : null} label="DQ" /></Box>
      </CardContent>
    </Card>
  );
}

export default function MatchMerge() {
  const theme = useTheme();
  const { canEdit } = useUser();
  const [entities, setEntities] = useState<Record<string, Customer | Product>>({});
  const toast = useToast();
  const setSnack = (s: { msg: string; severity: ToastSeverity } | null) => { if (s) toast(s.msg, s.severity); };
  const [rejectDialog, setRejectDialog] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [mergeDialog, setMergeDialog] = useState<MatchCandidate | null>(null);
  const [mergeSurvivor, setMergeSurvivor] = useState<'A' | 'B'>('A');
  const [fieldPicks, setFieldPicks] = useState<Record<string, 'A' | 'B'>>({});
  const [saving, setSaving] = useState(false);
  const [runningMethod, setRunningMethod] = useState<string | null>(null);
  const [enrichingId, setEnrichingId] = useState<number | null>(null);
  const [hasScanned, setHasScanned] = useState(false);
  const [pipelineOpen, setPipelineOpen] = useState(true);
  const [lastRunCounts, setLastRunCounts] = useState<Record<string, number>>({});
  const [tab, setTab] = useState(0);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [sortBy, setSortBy] = useState<'score_desc' | 'score_asc' | 'method'>('score_desc');
  const brand = useBrand();
  const modules = brand.modules.filter(m => m.enabled);
  const currentModule = modules[tab];
  const currentEntityType = currentModule?.id.toUpperCase() ?? 'CUSTOMER';
  const [searchByTab, setSearchByTab] = useState<Record<number, string>>({});

  const notify = useCallback((msg: string, severity: 'success' | 'error' | 'warning') => setSnack({ msg, severity }), []);

  const [counts, setCounts] = useState<Record<string, number>>({});
  const currentSearch = searchByTab[tab] ?? '';
  const setCurrentSearch = (v: string) => setSearchByTab(prev => ({ ...prev, [tab]: v }));
  const debouncedSearch = useDebounced(currentSearch);
  const SORTS = { score_desc: 'match_score:desc', score_asc: 'match_score:asc', method: 'match_method:asc' } as const;
  const query = useMemo(() => ({ entity_type: currentEntityType, q: debouncedSearch.trim() || null, sort: SORTS[sortBy] }), [currentEntityType, debouncedSearch, sortBy]); // eslint-disable-line react-hooks/exhaustive-deps
  // Each page carries the records of its pairs; keep them for the cards and merge dialog
  const fetchPage = useCallback(async (p: URLSearchParams) => {
    const r = await matchApi.page(p);
    setEntities(prev => ({ ...prev, ...r.records }));
    return r;
  }, []);
  const onListError = useCallback((e: Error) => setSnack({ msg: tr('matchMerge.failedToLoadV0', { v0: e.message }), severity: 'error' }), []);
  const list = useServerList(fetchPage, query, { onError: onListError });
  const { rows: pagedList, loading } = list;
  const matchTotal = list.total;
  const loadCounts = useCallback(() => { matchApi.counts().then(setCounts).catch(() => {}); }, []);
  useEffect(() => { loadCounts(); }, [loadCounts]);
  const fetchData = useCallback(async () => { list.reload(); loadCounts(); }, [list.reload, loadCounts]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleExpand = (id: number) => setExpandedIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });


  const openMergeDialog = (match: MatchCandidate) => {
    const eA = entities[match.entity_id_a];
    const eB = entities[match.entity_id_b];
    const aScore = parseFloat(String(eA?.dq_score)) || 0;
    const bScore = parseFloat(String(eB?.dq_score)) || 0;
    const defaultSurvivor: 'A' | 'B' = aScore >= bScore ? 'A' : 'B';
    setMergeSurvivor(defaultSurvivor);
    setFieldPicks({});
    setMergeDialog(match);
  };

  const confirmMerge = async () => {
    if (!mergeDialog) return;
    try {
      setSaving(true);
      const survivorId = mergeSurvivor === 'A' ? mergeDialog.entity_id_a : mergeDialog.entity_id_b;
      const result = await matchApi.resolve(mergeDialog.id, 'CONFIRMED', {
        survivor_id: survivorId,
        field_overrides: Object.keys(fieldPicks).length > 0 ? fieldPicks : undefined,
      }) as unknown as { survivor_name?: string; loser_name?: string; golden_id?: string; fields_enriched?: number };
      fetchData();
      const msg = result.survivor_name
        ? tr('matchMerge.mergedInto', { survivor: result.survivor_name, golden: result.golden_id, loser: result.loser_name, fields: result.fields_enriched })
        : 'Merge completed';
      setSnack({ msg, severity: 'success' });
      setMergeDialog(null);
    } catch (e) { setSnack({ msg: tr('matchMerge.mergeFailedV0', { v0: (e as Error).message }), severity: 'error' }); }
    finally { setSaving(false); }
  };

  const confirmReject = async () => {
    if (rejectDialog == null) return;
    try {
      setSaving(true);
      await matchApi.resolve(rejectDialog, 'REJECTED');
      fetchData();
      setSnack({ msg: tr('matchMerge.matchRejected'), severity: 'warning' });
      setRejectDialog(null); setRejectReason('');
    } catch (e) { setSnack({ msg: tr('matchMerge.rejectFailedV0', { v0: (e as Error).message }), severity: 'error' }); }
    finally { setSaving(false); }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Box>
          <Typography variant="h4" gutterBottom>{tr('matchMerge.matchMerge')}</Typography>
          <Typography variant="subtitle1">{tr('matchMerge.pendingPairs', { count: Object.values(counts).reduce((a, b) => a + b, 0) })} {loading && <CircularProgress size={14} sx={{ ml: 1 }} />}</Typography>
        </Box>
      </Box>

      {/* The pipeline runs per module; the merge-history tab has no module to run it against */}
      {canEdit && currentModule && (() => {
        // Exact-match keys from every enabled module's matching config
        const exactKeys = [...new Set(modules.flatMap(m => m.matching?.methods?.exact_keys?.enabled ? m.matching.methods.exact_keys.keys : []))].join(', ');
        const PIPELINE_METHODS = [
          { key: 'exact_keys', label: tr('matchMerge.exactKeys'), desc: tr('matchMerge.exactKeysDesc', { keys: exactKeys || tr('matchMerge.configuredKeys') }), color: statusColors().success, icon: VpnKeyIcon, endpoint: 'scan' as const },
          { key: 'fuzzy', label: tr('matchMerge.fuzzyTrigram'), desc: tr('matchMerge.pgTrgmNameSimilarity'), color: statusColors().success, icon: TextFieldsIcon, endpoint: 'scan' as const },
          { key: 'phonetic', label: tr('matchMerge.phonetic'), desc: tr('matchMerge.doubleMetaphoneSoundMatching'), color: seriesColor(5), icon: RecordVoiceOverIcon, endpoint: 'scan' as const },
          { key: 'composite', label: tr('matchMerge.compositeRules'), desc: tr('matchMerge.weightedMultiFieldScoring'), color: statusColors().warning, icon: TuneIcon, endpoint: 'scan' as const },
          { key: 'address', label: tr('matchMerge.addressLlm'), desc: tr('matchMerge.cortexNormalizedAddressComparison'), color: statusColors().info, icon: PlaceIcon, endpoint: 'scan' as const },
          { key: 'embedding', label: tr('matchMerge.embedding'), desc: tr('matchMerge.cortexEmbedText768Cosine'), color: statusColors().info, icon: HubIcon, endpoint: 'enrich' as const },
          { key: 'llm_judge', label: tr('matchMerge.llmJudge'), desc: tr('matchMerge.cortexCompleteReasoningVerdict'), color: seriesColor(1), icon: PsychologyIcon, endpoint: 'enrich' as const },
        ];

        const modCfg = currentModule?.matching;
        const cfgMethods = modCfg?.methods ?? {};

        const isMethodEnabled = (key: string) => {
          const m = (cfgMethods as Record<string, { enabled?: boolean }>)[key];
          if (!m) return false;
          return m.enabled !== false;
        };

        const runMethod = async (key: string, endpoint: 'scan' | 'enrich') => {
          setRunningMethod(key);
          try {
            if (endpoint === 'scan') {
              const result = await matchApi.scan(undefined, [key]);
              const count = result.results.reduce((s: number, r: Record<string, number>) => s + (r[key] || 0), 0);
              setLastRunCounts(prev => ({ ...prev, [key]: count }));
              await fetchData();
              setSnack({ msg: count > 0 ? tr('matchMerge.candidatesFound', { method: PIPELINE_METHODS.find(m => m.key === key)?.label, count }) : tr('matchMerge.noNewCandidates', { method: PIPELINE_METHODS.find(m => m.key === key)?.label }), severity: count > 0 ? 'success' : 'info' });
            } else {
              const result = await matchApi.enrich([key]);
              const count = result.results.reduce((s, r) => s + (key === 'embedding' ? r.embedding : r.llm), 0);
              setLastRunCounts(prev => ({ ...prev, [key]: count }));
              await fetchData();
              setSnack({ msg: count > 0 ? tr('matchMerge.updatesCount', { method: PIPELINE_METHODS.find(m => m.key === key)?.label, count }) : tr('matchMerge.noUpdates', { method: PIPELINE_METHODS.find(m => m.key === key)?.label }), severity: count > 0 ? 'success' : 'info' });
            }
          } catch (e) { setSnack({ msg: tr('matchMerge.keyFailedV1', { key, v1: (e as Error).message }), severity: 'error' }); }
          finally { setRunningMethod(null); setHasScanned(true); }
        };

        const runAll = async () => {
          setRunningMethod('__all__');
          try {
            const scanResult = await matchApi.scan();
            const scanTotal = scanResult.results.reduce((s: number, r: Record<string, number>) => s + (r.exact_keys || 0) + (r.fuzzy || 0) + (r.phonetic || 0) + (r.composite || 0) + (r.address || 0), 0);
            const newCounts: Record<string, number> = {};
            for (const k of ['exact_keys', 'fuzzy', 'phonetic', 'composite', 'address']) {
              newCounts[k] = scanResult.results.reduce((s: number, r: Record<string, number>) => s + (r[k] || 0), 0);
            }
            const enrichResult = await matchApi.enrich();
            newCounts.embedding = enrichResult.results.reduce((s, r) => s + r.embedding, 0);
            newCounts.llm_judge = enrichResult.results.reduce((s, r) => s + r.llm, 0);
            setLastRunCounts(newCounts);
            await fetchData();
            const total = scanTotal + newCounts.embedding + newCounts.llm_judge;
            setSnack({ msg: tr('matchMerge.fullPipeline', { count: total }), severity: 'success' });
          } catch (e) { setSnack({ msg: tr('matchMerge.pipelineFailedV0', { v0: (e as Error).message }), severity: 'error' }); }
          finally { setRunningMethod(null); setHasScanned(true); }
        };

        return (
          <Card sx={{ mb: 2, border: `1px solid ${alpha(theme.palette.divider, 0.15)}` }}>
            <Box
              onClick={() => setPipelineOpen(p => !p)}
              sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', px: 2, py: 1, cursor: 'pointer', '&:hover': { bgcolor: alpha(theme.palette.text.primary, 0.02) } }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <SearchIcon fontSize="small" sx={{ color: theme.palette.text.secondary }} />
                <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>{tr('matchMerge.matchingPipeline')}</Typography>
                <Chip label={tr('matchMerge.enabledOf', { enabled: PIPELINE_METHODS.filter(m => isMethodEnabled(m.key)).length, total: PIPELINE_METHODS.length })} size="small" variant="outlined" sx={{ fontSize: '0.65rem', height: 20 }} />
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Button
                  size="small" variant="contained" startIcon={runningMethod === '__all__' ? <CircularProgress size={14} /> : <PlayArrowIcon />}
                  disabled={!!runningMethod}
                  onClick={(e) => { e.stopPropagation(); runAll(); }}
                  sx={{ textTransform: 'none', fontSize: '0.75rem', py: 0.3 }}
                >{tr('matchMerge.runAll')}</Button>
                {pipelineOpen ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
              </Box>
            </Box>
            {pipelineOpen && (
              <Box sx={{ px: 2, pb: 1.5, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                {PIPELINE_METHODS.map(m => {
                  const enabled = isMethodEnabled(m.key);
                  const isRunning = runningMethod === m.key || runningMethod === '__all__';
                  const lastCount = lastRunCounts[m.key];
                  return (
                    <Box
                      key={m.key}
                      sx={{
                        display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 0.8,
                        borderRadius: 1, border: `1px solid ${alpha(enabled ? m.color : theme.palette.text.disabled, 0.25)}`,
                        bgcolor: alpha(enabled ? m.color : theme.palette.text.disabled, 0.04),
                        opacity: enabled ? 1 : 0.45, minWidth: 0, flex: '0 0 auto',
                      }}
                    >
                      <m.icon sx={{ fontSize: '1.1rem', color: enabled ? m.color : theme.palette.text.disabled }} />
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="caption" sx={{ fontWeight: 600, fontSize: '0.7rem', display: 'block', color: enabled ? m.color : theme.palette.text.disabled, lineHeight: 1.2 }}>{m.label}</Typography>
                        <Typography variant="caption" sx={{ fontSize: '0.58rem', color: theme.palette.text.secondary, lineHeight: 1.2, display: 'block' }}>{m.desc}</Typography>
                      </Box>
                      {lastCount != null && lastCount > 0 && (
                        <Chip label={lastCount} size="small" sx={{ fontSize: '0.65rem', height: 18, minWidth: 24, bgcolor: alpha(m.color, 0.15), color: m.color, fontWeight: 700 }} />
                      )}
                      {lastCount === 0 && (
                        <Chip label="0" size="small" variant="outlined" sx={{ fontSize: '0.65rem', height: 18, minWidth: 24, opacity: 0.5 }} />
                      )}
                      {enabled && (
                        <IconButton
                          size="small"
                          disabled={!!runningMethod}
                          onClick={() => runMethod(m.key, m.endpoint)}
                          sx={{ p: 0.3, bgcolor: alpha(m.color, 0.1), '&:hover': { bgcolor: alpha(m.color, 0.2) } }}
                        >
                          {isRunning ? <CircularProgress size={14} sx={{ color: m.color }} /> : <PlayArrowIcon sx={{ fontSize: 16, color: m.color }} />}
                        </IconButton>
                      )}
                    </Box>
                  );
                })}
              </Box>
            )}
          </Card>
        );
      })()}

      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)}>
          {modules.map(m => (
            <Tab key={m.id} label={<TabCount label={localized(m.label, m.labels)} count={counts[m.id.toUpperCase()] ?? 0} />} />
          ))}
          <Tab label={tr('matchMerge.mergeHistory')} />
        </Tabs>
      </Box>

      {tab === modules.length ? (
        <MergeHistory onChanged={fetchData} notify={notify} />
      ) : (<>
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', mb: 2 }}>
        <TextField
          size="small"
          placeholder={tr('matchMerge.searchMatches', { entity: currentModule ? localized(currentModule.singular, currentModule.singular_labels).toLowerCase() : '' })}
          value={currentSearch}
          onChange={(e) => setCurrentSearch(e.target.value)}
          sx={{ width: 300 }}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
        />
        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel><SortIcon sx={{ fontSize: 14, mr: 0.5, verticalAlign: 'middle' }} />{tr('matchMerge.sortBy')}</InputLabel>
          <Select value={sortBy} label={tr('matchMerge.sortBy')} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}>
            <MenuItem value="score_desc">{tr('matchMerge.scoreHighFirst')}</MenuItem>
            <MenuItem value="score_asc">{tr('matchMerge.scoreLowFirst')}</MenuItem>
            <MenuItem value="method">{tr('matchMerge.method')}</MenuItem>
          </Select>
        </FormControl>
        <Typography variant="caption" sx={{ color: theme.palette.text.secondary }}>{tr('matchMerge.matchesCount', { count: matchTotal })}</Typography>
      </Box>

      {!loading && !runningMethod && matchTotal === 0 && (
        <Card sx={{ p: 4, textAlign: 'center' }}>
          {hasScanned
            ? <Typography variant="h6" sx={{ color: theme.palette.text.secondary }}>
                {currentSearch ? tr('matchMerge.noMatchesFoundForThis') : `No duplicate ${currentModule?.singular?.toLowerCase() ?? 'entity'} candidates`}
              </Typography>
            : <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                <Typography variant="h6" sx={{ color: theme.palette.text.secondary }}>{tr('matchMerge.runTheMatchingPipelineAbove')}</Typography>
              </Box>}
        </Card>
      )}

      {matchTotal > 0 && (
        <Card sx={{ border: `1px solid ${alpha(theme.palette.divider, 0.15)}` }}>
          {/* Header row */}
          <Box sx={{ display: 'flex', alignItems: 'center', px: 2, py: 1, borderBottom: `1px solid ${theme.palette.divider}`, bgcolor: alpha(theme.palette.text.primary, 0.02) }}>
            <Box sx={{ width: 32 }} />
            <Typography variant="caption" sx={{ width: 100, fontWeight: 600, color: theme.palette.text.secondary }}>{tr('matchMerge.method')}</Typography>
            <Typography variant="caption" sx={{ width: 70, fontWeight: 600, color: theme.palette.text.secondary, textAlign: 'right' }}>{tr('matchMerge.score')}</Typography>
            <Typography variant="caption" sx={{ flex: 1, fontWeight: 600, color: theme.palette.text.secondary, pl: 3 }}>{tr('matchMerge.recordA')}</Typography>
            <Typography variant="caption" sx={{ flex: 1, fontWeight: 600, color: theme.palette.text.secondary }}>{tr('matchMerge.recordB')}</Typography>
            <Box sx={{ width: 200 }} />
          </Box>

          {pagedList.map((match) => {
            const isExpanded = expandedIds.has(match.id);
            const eA = entities[match.entity_id_a];
            const eB = entities[match.entity_id_b];
            const nameField = brand.modules.find(m => m.id.toUpperCase() === match.entity_type)?.name_field;
            const nameA = entityName(nameField, eA || null);
            const nameB = entityName(nameField, eB || null);
            const mColor = methodColor(match.match_method);
            const scoreColor = matchScoreColor(match.match_score, theme.palette.text.secondary);

            return (
              <Box key={match.id} sx={{ borderBottom: `1px solid ${alpha(theme.palette.divider, 0.08)}` }}>
                {/* Summary row */}
                <Box
                  onClick={() => toggleExpand(match.id)}
                  sx={{
                    display: 'flex', alignItems: 'center', px: 2, py: 1, cursor: 'pointer',
                    '&:hover': { bgcolor: alpha(theme.palette.text.primary, 0.02) },
                    bgcolor: isExpanded ? alpha(mColor, 0.03) : 'transparent',
                  }}
                >
                  <Box sx={{ width: 32, display: 'flex', alignItems: 'center' }}>
                    {isExpanded ? <KeyboardArrowDownIcon fontSize="small" sx={{ color: theme.palette.text.secondary }} /> : <KeyboardArrowRightIcon fontSize="small" sx={{ color: theme.palette.text.secondary }} />}
                  </Box>
                  <Box sx={{ width: 100 }}>
                    <Chip label={methodLabel(match.match_method)} size="small" sx={{ fontSize: '0.62rem', height: 20, bgcolor: alpha(mColor, 0.12), color: mColor, fontWeight: 600 }} />
                  </Box>
                  <Typography variant="body2" sx={{ width: 70, fontWeight: 700, color: scoreColor, textAlign: 'right', fontFamily: 'monospace', fontSize: '0.85rem' }}>
                    {match.match_score}%
                  </Typography>
                  <Box sx={{ flex: 1, pl: 3, display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 500, fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><RecordLink type={match.entity_type} id={match.entity_id_a} newTab>{nameA}</RecordLink></Typography>
                    {eA && <StageChip stage={eA.lifecycle_stage} />}
                  </Box>
                  <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 500, fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><RecordLink type={match.entity_type} id={match.entity_id_b} newTab>{nameB}</RecordLink></Typography>
                    {eB && <StageChip stage={eB.lifecycle_stage} />}
                  </Box>
                  <Box sx={{ width: 200, display: 'flex', gap: 0.5, justifyContent: 'flex-end' }} onClick={(e) => e.stopPropagation()}>
                    {canEdit && !String(match.match_method).includes('LLM') && (
                      <Tooltip title={tr('matchMerge.aiDedup')}><IconButton size="small" disabled={enrichingId != null} onClick={async () => {
                        setEnrichingId(match.id);
                        try {
                          const result = await matchApi.aiDedup(match.id);
                          if (result.status === 'already_enriched') { setSnack({ msg: tr('matchMerge.alreadyEnrichedByAi'), severity: 'info' }); }
                          else { setSnack({ msg: tr('matchMerge.aiDedupMatchMethodMatch', { match_method: result.candidate.match_method, match_score: result.candidate.match_score }), severity: 'success' }); }
                          await fetchData();
                        } catch (e) { setSnack({ msg: tr('matchMerge.aiDedupFailedV0', { v0: (e as Error).message }), severity: 'error' }); }
                        finally { setEnrichingId(null); }
                      }} sx={{ color: seriesColor(1) }}>{enrichingId === match.id ? <CircularProgress size={16} /> : <AutoFixHighIcon fontSize="small" />}</IconButton></Tooltip>
                    )}
                    {canEdit && <Tooltip title={tr('matchMerge.merge')}><IconButton size="small" onClick={() => openMergeDialog(match)} sx={{ color: statusColors().success }}><CheckCircleIcon fontSize="small" /></IconButton></Tooltip>}
                    {canEdit && <Tooltip title={tr('matchMerge.reject')}><IconButton size="small" onClick={() => { setRejectDialog(match.id); setRejectReason(''); }} sx={{ color: statusColors().error }}><CancelIcon fontSize="small" /></IconButton></Tooltip>}
                  </Box>
                </Box>

                {/* Expanded detail */}
                <Collapse in={isExpanded}>
                  <Box sx={{ px: 2, pb: 2, pt: 1, bgcolor: alpha(theme.palette.text.primary, 0.01) }}>
                    {/* Match fields row */}
                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1.5, alignItems: 'center' }}>
                      <Typography variant="caption" sx={{ color: theme.palette.text.secondary, mr: 1, fontWeight: 600 }}>{tr('matchMerge.matchFields')}</Typography>
                      {Object.entries(match.match_fields ?? {}).filter(([f]) => !f.startsWith('llm_') && !f.startsWith('original_')).flatMap(([f, s]) => {
                        if (s && typeof s === 'object' && !Array.isArray(s)) {
                          return Object.entries(s as Record<string, unknown>).map(([k, v]) => (
                            <Chip key={`${f}.${k}`} label={`${k}: ${String(v)}`} size="small" sx={{ fontSize: '0.62rem', height: 20, bgcolor: alpha(seriesColor(5), 0.15), color: seriesColor(5) }} />
                          ));
                        }
                        const n = typeof s === 'number' ? s : parseFloat(String(s)); const isHigh = !isNaN(n) && n >= 0.9;
                        return [<Chip key={f} label={`${f}: ${!isNaN(n) ? (n * 100).toFixed(0) + '%' : String(s)}`} size="small" sx={{ fontSize: '0.62rem', height: 20, bgcolor: alpha(isHigh ? statusColors().success : statusColors().warning, 0.15), color: isHigh ? statusColors().success : statusColors().warning }} />];
                      })}
                    </Box>

                    {/* AI Reasoning (compact) */}
                    {!!match.match_fields?.llm_reasoning && (
                      <Box sx={{ mb: 1.5, p: 1, bgcolor: alpha(seriesColor(1), 0.05), borderRadius: 1, border: `1px solid ${alpha(seriesColor(1), 0.15)}` }}>
                        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
                          <Typography variant="caption" sx={{ color: seriesColor(1), fontWeight: 600, whiteSpace: 'nowrap' }}>{tr('matchMerge.aiReasoning')}</Typography>
                          {!!match.match_fields.original_method && <Typography variant="caption" sx={{ color: statusColors().warning, fontSize: '0.62rem' }}>{tr('matchMerge.originallyV0AtV1', { v0: String(match.match_fields.original_method), v1: String(match.match_fields.original_score) })}</Typography>}
                        </Box>
                        <Typography variant="caption" sx={{ color: theme.palette.text.secondary, fontSize: '0.7rem', lineHeight: 1.3 }}>{String(match.match_fields.llm_reasoning)}</Typography>
                      </Box>
                    )}

                    {/* Entity detail cards side by side */}
                    <Grid container spacing={2}>
                      <Grid size={{ xs: 12, md: 6 }}><EntityCard entityType={match.entity_type} entity={eA || null} /></Grid>
                      <Grid size={{ xs: 12, md: 6 }}><EntityCard entityType={match.entity_type} entity={eB || null} /></Grid>
                    </Grid>
                  </Box>
                </Collapse>
              </Box>
            );
          })}

          {/* Pagination */}
          {matchTotal > 10 && (
            <TablePagination
              component="div"
              count={matchTotal}
              page={list.pager.page}
              onPageChange={(_, p) => list.pager.setPage(p)}
              rowsPerPage={list.pager.size}
              onRowsPerPageChange={(e) => list.pager.setSize(parseInt(e.target.value, 10))}
              rowsPerPageOptions={[10, 25, 50, 100]}
              sx={{ borderTop: `1px solid ${theme.palette.divider}` }}
            />
          )}
        </Card>
      )}
      </>)}

      <Dialog open={!!mergeDialog} onClose={() => setMergeDialog(null)} maxWidth="md" fullWidth>
        <DialogTitle>{tr('matchMerge.mergeSurvivorshipRules')}</DialogTitle>
        <DialogContent>
          {mergeDialog && (() => {
            const eA = entities[mergeDialog.entity_id_a];
            const eB = entities[mergeDialog.entity_id_b];
            if (!eA || !eB) return <Typography>{tr('matchMerge.loadingEntities')}</Typography>;
            const nameCol = modules.find(m => m.id.toUpperCase() === mergeDialog.entity_type)?.name_field ?? 'id';
            const nameA = String((eA as unknown as Record<string, unknown>)[nameCol] || '');
            const nameB = String((eB as unknown as Record<string, unknown>)[nameCol] || '');
            const aScore = parseFloat(String(eA.dq_score)) || 0;
            const bScore = parseFloat(String(eB.dq_score)) || 0;

            // Every active, user-editable field of the module, in config order
            const mergeMod = modules.find(m => m.id.toUpperCase() === mergeDialog.entity_type);
            const compareFields = mergeMod ? [...activeFields(mergeMod).filter(f => !SYSTEM_FIELDS.has(f.name)).map(f => f.name), 'lifecycle_stage'] : [];

            const survivorSide = mergeSurvivor;
            const survivorEntity = survivorSide === 'A' ? eA : eB;
            const loserEntity = survivorSide === 'A' ? eB : eA;

            const getEffectivePick = (field: string): 'A' | 'B' => {
              if (fieldPicks[field]) return fieldPicks[field];
              const sVal = (survivorEntity as unknown as Record<string, unknown>)[field];
              const lVal = (loserEntity as unknown as Record<string, unknown>)[field];
              if ((sVal === null || sVal === '' || sVal === undefined) && lVal != null && lVal !== '') {
                return survivorSide === 'A' ? 'B' : 'A';
              }
              return survivorSide;
            };

            const handleSurvivorChange = (_: unknown, val: 'A' | 'B' | null) => {
              if (val) { setMergeSurvivor(val); setFieldPicks({}); }
            };

            const toggleField = (field: string) => {
              const current = fieldPicks[field] || survivorSide;
              const next = current === 'A' ? 'B' : 'A';
              if (next === survivorSide && !fieldPicks[field]) return;
              const newPicks = { ...fieldPicks };
              if (next === survivorSide) { delete newPicks[field]; } else { newPicks[field] = next; }
              setFieldPicks(newPicks);
            };

            const overrideCount = Object.keys(fieldPicks).length;

            return (
              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ mb: 2, display: 'block' }}>
                  Pick which record survives, then override individual fields if needed. The other record will be soft-deleted.
                </Typography>

                <Box sx={{ display: 'flex', gap: 2, mb: 2, alignItems: 'stretch' }}>
                  <Box
                    onClick={() => handleSurvivorChange(null, 'A')}
                    sx={{
                      flex: 1, p: 1.5, borderRadius: 1, cursor: 'pointer', transition: 'all 0.15s',
                      border: `2px solid ${survivorSide === 'A' ? statusColors().success : alpha(theme.palette.divider, 0.3)}`,
                      bgcolor: survivorSide === 'A' ? alpha(statusColors().success, 0.06) : 'transparent',
                      '&:hover': { borderColor: survivorSide === 'A' ? statusColors().success : alpha(theme.palette.divider, 0.6) },
                    }}
                  >
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                      <Chip label="A" size="small" sx={{ fontWeight: 700, bgcolor: survivorSide === 'A' ? statusColors().success : alpha(theme.palette.text.primary, 0.08), color: survivorSide === 'A' ? '#fff' : 'inherit', minWidth: 28 }} />
                      {survivorSide === 'A' && <Chip label="SURVIVOR" size="small" color="success" variant="outlined" sx={{ fontSize: '0.6rem', height: 18 }} />}
                      {survivorSide !== 'A' && <Chip label={tr('matchMerge.willBeDeleted')} size="small" sx={{ fontSize: '0.6rem', height: 18, opacity: 0.5, textDecoration: 'line-through' }} />}
                    </Box>
                    <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>{nameA}</Typography>
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                      <StageChip stage={eA.lifecycle_stage} />
                      <Typography variant="caption" color="text.secondary">{tr('matchMerge.dqAscore', { aScore })}</Typography>
                    </Box>
                  </Box>

                  <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <Tooltip title={tr('matchMerge.swapSurvivor')}>
                      <IconButton size="small" onClick={() => handleSurvivorChange(null, survivorSide === 'A' ? 'B' : 'A')}>
                        <SwapHorizIcon />
                      </IconButton>
                    </Tooltip>
                  </Box>

                  <Box
                    onClick={() => handleSurvivorChange(null, 'B')}
                    sx={{
                      flex: 1, p: 1.5, borderRadius: 1, cursor: 'pointer', transition: 'all 0.15s',
                      border: `2px solid ${survivorSide === 'B' ? statusColors().success : alpha(theme.palette.divider, 0.3)}`,
                      bgcolor: survivorSide === 'B' ? alpha(statusColors().success, 0.06) : 'transparent',
                      '&:hover': { borderColor: survivorSide === 'B' ? statusColors().success : alpha(theme.palette.divider, 0.6) },
                    }}
                  >
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                      <Chip label="B" size="small" sx={{ fontWeight: 700, bgcolor: survivorSide === 'B' ? statusColors().success : alpha(theme.palette.text.primary, 0.08), color: survivorSide === 'B' ? '#fff' : 'inherit', minWidth: 28 }} />
                      {survivorSide === 'B' && <Chip label="SURVIVOR" size="small" color="success" variant="outlined" sx={{ fontSize: '0.6rem', height: 18 }} />}
                      {survivorSide !== 'B' && <Chip label={tr('matchMerge.willBeDeleted')} size="small" sx={{ fontSize: '0.6rem', height: 18, opacity: 0.5, textDecoration: 'line-through' }} />}
                    </Box>
                    <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>{nameB}</Typography>
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                      <StageChip stage={eB.lifecycle_stage} />
                      <Typography variant="caption" color="text.secondary">{tr('matchMerge.dqBscore', { bScore })}</Typography>
                    </Box>
                  </Box>
                </Box>

                {overrideCount > 0 && (
                  <Box sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Chip label={tr('matchMerge.fieldOverrides', { count: overrideCount })} size="small" color="warning" variant="outlined" sx={{ fontSize: '0.7rem' }} />
                    <Button size="small" variant="text" sx={{ fontSize: '0.7rem', textTransform: 'none' }} onClick={() => setFieldPicks({})}>{tr('matchMerge.resetAll')}</Button>
                  </Box>
                )}

                <Box sx={{ maxHeight: 380, overflow: 'auto', border: `1px solid ${theme.palette.divider}`, borderRadius: 1 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid #ddd', position: 'sticky', top: 0, background: theme.palette.background.paper, zIndex: 1 }}>
                        <th style={{ textAlign: 'left', padding: '8px', width: '18%' }}>{tr('matchMerge.field')}</th>
                        <th style={{ textAlign: 'left', padding: '8px', width: '34%' }}>{tr('matchMerge.recordA')}</th>
                        <th style={{ textAlign: 'left', padding: '8px', width: '34%' }}>{tr('matchMerge.recordB')}</th>
                        <th style={{ textAlign: 'center', padding: '8px', width: '14%' }}>{tr('matchMerge.pick')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {compareFields.map(field => {
                        const valA = (eA as unknown as Record<string, unknown>)[field];
                        const valB = (eB as unknown as Record<string, unknown>)[field];
                        const strA = valA != null && valA !== '' ? String(valA) : '';
                        const strB = valB != null && valB !== '' ? String(valB) : '';
                        const pick = getEffectivePick(field);
                        const isOverride = !!fieldPicks[field];
                        const bothEmpty = !strA && !strB;
                        const identical = strA === strB;

                        return (
                          <tr key={field} style={{ borderBottom: '1px solid #eee', background: isOverride ? alpha(statusColors().warning, 0.06) : 'transparent' }}>
                            <td style={{ padding: '6px 8px', fontFamily: 'monospace', fontSize: '0.72rem', color: theme.palette.text.secondary }}>{field}</td>
                            <td
                              onClick={() => { if (strA) { const newPicks = { ...fieldPicks }; if (survivorSide === 'A') { delete newPicks[field]; } else { newPicks[field] = 'A'; } setFieldPicks(newPicks); } }}
                              style={{
                                padding: '6px 8px',
                                cursor: strA ? 'pointer' : 'default',
                                fontWeight: pick === 'A' ? 600 : 400,
                                color: pick === 'A' ? theme.palette.text.primary : alpha(theme.palette.text.primary, 0.4),
                                background: pick === 'A' && !identical ? alpha(statusColors().success, 0.08) : 'transparent',
                                borderLeft: pick === 'A' && !identical ? '3px solid ${statusColors().success}' : '3px solid transparent',
                              }}
                            >
                              {strA || <span style={{ color: '#ccc' }}>—</span>}
                            </td>
                            <td
                              onClick={() => { if (strB) { const newPicks = { ...fieldPicks }; if (survivorSide === 'B') { delete newPicks[field]; } else { newPicks[field] = 'B'; } setFieldPicks(newPicks); } }}
                              style={{
                                padding: '6px 8px',
                                cursor: strB ? 'pointer' : 'default',
                                fontWeight: pick === 'B' ? 600 : 400,
                                color: pick === 'B' ? theme.palette.text.primary : alpha(theme.palette.text.primary, 0.4),
                                background: pick === 'B' && !identical ? alpha(statusColors().success, 0.08) : 'transparent',
                                borderLeft: pick === 'B' && !identical ? '3px solid ${statusColors().success}' : '3px solid transparent',
                              }}
                            >
                              {strB || <span style={{ color: '#ccc' }}>—</span>}
                            </td>
                            <td style={{ padding: '4px', textAlign: 'center' }}>
                              {bothEmpty ? (
                                <Typography variant="caption" sx={{ color: '#ccc' }}>—</Typography>
                              ) : identical ? (
                                <Chip label="same" size="small" variant="outlined" sx={{ fontSize: '0.6rem', height: 18, opacity: 0.5 }} />
                              ) : (
                                <ToggleButtonGroup size="small" exclusive value={pick} onChange={(_, v) => { if (v) toggleField(field); }} sx={{ height: 24 }}>
                                  <ToggleButton value="A" sx={{ fontSize: '0.65rem', px: 1, py: 0, fontWeight: pick === 'A' ? 700 : 400, color: pick === 'A' ? statusColors().success : undefined }}>A</ToggleButton>
                                  <ToggleButton value="B" sx={{ fontSize: '0.65rem', px: 1, py: 0, fontWeight: pick === 'B' ? 700 : 400, color: pick === 'B' ? statusColors().success : undefined }}>B</ToggleButton>
                                </ToggleButtonGroup>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </Box>
              </Box>
            );
          })()}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMergeDialog(null)} disabled={saving}>{tr('matchMerge.cancel')}</Button>
          <Button variant="contained" color="success" onClick={confirmMerge} startIcon={saving ? <CircularProgress size={16} /> : <CheckCircleIcon />} disabled={saving}>
            {tr('matchMerge.confirmMerge')}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={rejectDialog != null} onClose={() => setRejectDialog(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{tr('matchMerge.rejectMatch')}</DialogTitle>
        <DialogContent><Typography variant="body2" sx={{ mb: 2 }}>{tr('matchMerge.markAsFalsePositive')}</Typography><TextField fullWidth multiline rows={2} label={tr('matchMerge.reasonOptional')} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} /></DialogContent>
        <DialogActions><Button onClick={() => setRejectDialog(null)} disabled={saving}>{tr('matchMerge.cancel')}</Button><Button variant="contained" color="error" onClick={confirmReject} startIcon={saving ? <CircularProgress size={16} /> : <CancelIcon />} disabled={saving}>{tr('matchMerge.reject')}</Button></DialogActions>
      </Dialog>
    </Box>
  );
}
