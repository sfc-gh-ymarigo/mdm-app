import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Box, Typography, Card, CardContent, alpha, Chip, LinearProgress, Grid2 as Grid,
  CircularProgress, Button, ButtonGroup, useTheme, IconButton, Tooltip,
  TextField, Tabs, Tab, InputAdornment, Checkbox, Drawer, Menu, MenuItem,
  ToggleButtonGroup, ToggleButton, Table, TableBody, TableCell, TableHead, TableRow

} from '@mui/material';

import { LineChart, Line } from 'recharts';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import CodeIcon from '@mui/icons-material/Code';
import SearchIcon from '@mui/icons-material/Search';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import VisibilityIcon from '@mui/icons-material/Visibility';
import CloseIcon from '@mui/icons-material/Close';
import FilterListIcon from '@mui/icons-material/FilterList';
import SettingsIcon from '@mui/icons-material/Settings';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import { dqApi } from '../api/client';
import type { DqRunHistory } from '../api/client';
import type { DqRuleResult, DqRule, DqFailure } from '../types/models';
import { useUser } from '../context/UserContext';
import { useBrand } from '../config/BrandContext';
import { useNavigate, useParams } from 'react-router-dom';
import { useToast, type ToastSeverity } from '../components/common/Toast';
import { useBreadcrumbLabel } from '../components/common/Breadcrumbs';
import { RecordLink, useRecordPath } from '../components/common/Links';
import { localized, tr } from '../i18n';
import TabCount from '../components/common/TabCount';

import { statusColors } from '../theme/brandColors';
const severityColor = (s: string) => s === 'ERROR' ? statusColors().error : s === 'WARNING' ? statusColors().warning : statusColors().info;
const rateColor = (r: number) => r >= 90 ? statusColors().success : r >= 70 ? statusColors().warning : statusColors().error;

type StatusFilter = 'all' | 'failing' | 'passing';
type SeverityFilter = 'ALL' | 'ERROR' | 'WARNING' | 'INFO';
type SortField = 'severity' | 'type' | 'rule' | 'score' | 'progress' | null;
type SortDir = 'asc' | 'desc';

export default function DataQuality() {
  const theme = useTheme();
  const fgMuted = theme.palette.text.secondary;
  const dividerColor = theme.palette.divider;
  const navigate = useNavigate();
  const [summaryRules, setSummaryRules] = useState<DqRuleResult[]>([]);
  const [fullRules, setFullRules] = useState<DqRule[]>([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();
  const setSnack = (s: { msg: string; severity: ToastSeverity } | null) => { if (s) toast(s.msg, s.severity); };
  const { canEdit } = useUser();
  const brand = useBrand();
  const modules = brand.modules.filter(m => m.enabled);
  const [tab, setTab] = useState(0);
  const [searchByTab, setSearchByTab] = useState<Record<number, string>>({});

  // Filters
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('ALL');

  // Selection for batch run
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Sorting
  const [sortField, setSortField] = useState<SortField>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  // SQL viewer
  const [sqlViewRule, setSqlViewRule] = useState<DqRule | null>(null);
  const [history, setHistory] = useState<DqRunHistory[]>([]);

  // Failure drawer
  const [drawerRule, setDrawerRule] = useState<DqRule | null>(null);
  const [drawerFailures, setDrawerFailures] = useState<DqFailure[]>([]);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerTotal, setDrawerTotal] = useState(0);
  const FAILURE_PAGE = 100;

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [summary, rules, hist] = await Promise.all([dqApi.summary(), dqApi.listRules(), dqApi.history()]);
      setSummaryRules(summary);
      setFullRules(rules);
      setHistory(hist);
    } catch (e) { setSnack({ msg: tr('dataQuality.failedToLoadV0', { v0: (e as Error).message }), severity: 'error' }); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const [runningEntity, setRunningEntity] = useState<string | null>(null);
  const [runMenuAnchor, setRunMenuAnchor] = useState<HTMLElement | null>(null);

  const runDq = async (entityType: string, ruleIds?: number[]) => {
    try {
      setRunningEntity(entityType);
      const label = ruleIds ? tr('dataQuality.selectedRules', { count: ruleIds.length }) : tr('dataQuality.entityRules', { entity: entityType });
      setSnack({ msg: tr('dataQuality.evaluatingLabel', { label }), severity: 'info' });
      const result = await dqApi.run(entityType, ruleIds);
      await fetchData();
      setSelected(new Set());
      setSnack({ msg: tr('dataQuality.rulesEvaluatedRulesEvaluatedAcross', { rules_evaluated: result.rules_evaluated, entities_checked: result.entities_checked }), severity: 'success' });
    } catch (e) { setSnack({ msg: tr('dataQuality.dqRunFailedV0', { v0: (e as Error).message }), severity: 'error' }); }
    finally { setRunningEntity(null); }
  };

  // The open rule lives in the URL: /data-quality/rules/:ruleId
  const { ruleId } = useParams();
  const openDrawer = (rule: DqRule) => navigate(`/data-quality/rules/${rule.id}`);
  const closeDrawer = () => navigate('/data-quality');
  const recordPath = useRecordPath();
  useBreadcrumbLabel(ruleId && drawerRule ? drawerRule.rule_name : null);
  useEffect(() => {
    setDrawerFailures([]); setDrawerTotal(0);
    if (ruleId) loadDrawer(Number(ruleId)); else setDrawerRule(null);
  }, [ruleId]); // eslint-disable-line react-hooks/exhaustive-deps
  // Rules load after the drawer when opened from a link: swap in the full rule (severity, counts)
  useEffect(() => {
    if (ruleId && drawerRule && !('severity' in drawerRule)) { const full = fullRules.find(r => r.id === Number(ruleId)); if (full) setDrawerRule(full); }
  }, [fullRules]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadDrawer = async (id: number, page = 0) => {
    setDrawerLoading(true);
    try {
      const resp = await dqApi.failures(id, { page, size: FAILURE_PAGE });
      setDrawerRule(fullRules.find(r => r.id === id) ?? ({ ...(resp.rule as object), is_active: true } as unknown as DqRule));
      setDrawerFailures(prev => (page === 0 ? resp.failures : [...prev, ...resp.failures]));
      setDrawerTotal(resp.total ?? resp.failures.length);
    } catch (e) { setSnack({ msg: tr('dataQuality.failedToLoadFailuresV0', { v0: (e as Error).message }), severity: 'error' }); setDrawerFailures([]); }
    finally { setDrawerLoading(false); }
  };

  const currentModule = modules[tab];
  const currentEntityType = currentModule?.id.toUpperCase() ?? 'CUSTOMER';
  const currentEntityLabel = currentModule ? localized(currentModule.singular, currentModule.singular_labels) : currentEntityType;
  const currentSearch = searchByTab[tab] ?? '';
  const setCurrentSearch = (v: string) => setSearchByTab(prev => ({ ...prev, [tab]: v }));
  const isRunning = runningEntity === currentEntityType || runningEntity === 'ALL';
  const anyRunning = runningEntity != null;

  const tabRules = useMemo(() => fullRules.filter(r => r.entity_type === currentEntityType), [fullRules, currentEntityType]);
  const tabSummary = useMemo(() => summaryRules.filter(r => {
    const rule = fullRules.find(fr => fr.rule_code === r.rule_code);
    return rule?.entity_type === currentEntityType;
  }), [summaryRules, fullRules, currentEntityType]);

  // Enrich rules with summary data
  const enrichedRules = useMemo(() => tabRules.map(r => {
    const s = tabSummary.find(sr => sr.rule_code === r.rule_code);
    const passRate = r.total > 0 ? (r.passed / r.total) * 100 : -1;
    return { ...r, passRate, summaryTotal: s?.total ?? 0, summaryFailed: s?.failed ?? 0 };
  }), [tabRules, tabSummary]);

  const filteredRules = useMemo(() => {
    let list = enrichedRules;
    if (currentSearch.trim()) {
      const q = currentSearch.toLowerCase();
      list = list.filter(r =>
        r.rule_name.toLowerCase().includes(q)
        || r.rule_code.toLowerCase().includes(q)
        || r.rule_type.toLowerCase().includes(q)
      );
    }
    if (severityFilter !== 'ALL') list = list.filter(r => r.severity === severityFilter);
    if (statusFilter === 'failing') list = list.filter(r => r.passRate >= 0 && r.passRate < 100);
    if (statusFilter === 'passing') list = list.filter(r => r.passRate === 100);
    if (sortField) {
      const dir = sortDir === 'asc' ? 1 : -1;
      const sevOrder: Record<string, number> = { ERROR: 0, WARNING: 1, INFO: 2 };
      list = [...list].sort((a, b) => {
        switch (sortField) {
          case 'severity': return dir * ((sevOrder[a.severity] ?? 3) - (sevOrder[b.severity] ?? 3));
          case 'type': return dir * a.rule_type.localeCompare(b.rule_type);
          case 'rule': return dir * a.rule_name.localeCompare(b.rule_name);
          case 'score':
          case 'progress': return dir * (a.passRate - b.passRate);
          default: return 0;
        }
      });
    }
    return list;
  }, [enrichedRules, currentSearch, severityFilter, statusFilter, sortField, sortDir]);

  const ruleCountByEntity = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const m of modules) counts[m.id.toUpperCase()] = fullRules.filter(r => r.entity_type === m.id.toUpperCase()).length;
    return counts;
  }, [fullRules, modules]);

  const tabPass = tabSummary.reduce((a, r) => a + r.passed, 0);
  const tabTotal = tabSummary.reduce((a, r) => a + r.total, 0);
  const tabRate = tabTotal > 0 ? (tabPass / tabTotal) * 100 : 0;
  const tabChart = useMemo(() => {
    const tabHist = history.filter(h => h.entity_type === currentEntityType);
    return tabSummary.map(r => {
      const h = tabHist.find(th => th.rule_code === r.rule_code);
      const runs = h?.runs || [];
      const prevRate = runs.length >= 2 ? runs[runs.length - 2].pass_rate : null;
      const delta = prevRate != null ? Math.round((r.pass_rate - prevRate) * 100) / 100 : null;
      return { name: r.rule_name, code: r.rule_code, pass_rate: r.pass_rate, fill: rateColor(r.pass_rate), delta, runs };
    }).sort((a, b) => a.pass_rate - b.pass_rate);
  }, [tabSummary, history, currentEntityType]);
  const hasResults = tabTotal > 0;

  const failingCount = enrichedRules.filter(r => r.passRate >= 0 && r.passRate < 100).length;
  const passingCount = enrichedRules.filter(r => r.passRate === 100).length;
  const errorCount = enrichedRules.filter(r => r.severity === 'ERROR' && r.is_active).length;
  const warningCount = enrichedRules.filter(r => r.severity === 'WARNING' && r.is_active).length;

  // Aggregated pass rates by severity & type
  const ratesBySeverity = useMemo(() => {
    const groups: Record<string, { pass: number; total: number }> = {};
    for (const r of enrichedRules) {
      if (r.total <= 0) continue;
      const g = groups[r.severity] ??= { pass: 0, total: 0 };
      g.pass += r.passed; g.total += r.total;
    }
    return Object.entries(groups).map(([sev, g]) => ({ label: sev, rate: g.total > 0 ? (g.pass / g.total) * 100 : 0 }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [enrichedRules]);

  const ratesByType = useMemo(() => {
    const groups: Record<string, { pass: number; total: number }> = {};
    for (const r of enrichedRules) {
      if (r.total <= 0) continue;
      const g = groups[r.rule_type] ??= { pass: 0, total: 0 };
      g.pass += r.passed; g.total += r.total;
    }
    return Object.entries(groups).map(([typ, g]) => ({ label: typ, rate: g.total > 0 ? (g.pass / g.total) * 100 : 0 }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [enrichedRules]);

  // Smart run helpers: rules that are failing or never evaluated
  const failingRuleIds = useMemo(() => enrichedRules.filter(r => r.is_active && r.passRate >= 0 && r.passRate < 100).map(r => r.id), [enrichedRules]);
  const neverRunRuleIds = useMemo(() => enrichedRules.filter(r => r.is_active && r.passRate < 0).map(r => r.id), [enrichedRules]);
  const smartRunIds = useMemo(() => [...new Set([...failingRuleIds, ...neverRunRuleIds])], [failingRuleIds, neverRunRuleIds]);
  const activeRuleIds = useMemo(() => enrichedRules.filter(r => r.is_active).map(r => r.id), [enrichedRules]);

  const allFilteredSelected = filteredRules.length > 0 && filteredRules.every(r => selected.has(r.id));
  const someSelected = selected.size > 0;

  const toggleSelect = (id: number) => setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleSelectAll = () => {
    if (allFilteredSelected) setSelected(prev => { const n = new Set(prev); filteredRules.forEach(r => n.delete(r.id)); return n; });
    else setSelected(prev => { const n = new Set(prev); filteredRules.forEach(r => n.add(r.id)); return n; });
  };

  useEffect(() => { setSelected(new Set()); }, [tab]);

  if (loading && summaryRules.length === 0) return <Box sx={{ display: 'flex', justifyContent: 'center', mt: 10 }}><CircularProgress /></Box>;

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Box>
          <Typography variant="h4" gutterBottom>{tr('dataQuality.dataQuality')}</Typography>
          <Typography variant="subtitle2" sx={{ color: fgMuted }}>
            {fullRules.filter(r => r.is_active).length} active rules across {modules.length} entities
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          {canEdit && (
            <Tooltip title={tr('dataQuality.manageRulesInConfiguration')}>
              <Button size="small" startIcon={<SettingsIcon />} onClick={() => navigate(`/configuration/modules/${currentEntityType.toLowerCase()}?tab=data-quality`)} sx={{ mr: 1 }}>
                {tr('dataQuality.rules')}
              </Button>
            </Tooltip>
          )}
          {canEdit && (
            <ButtonGroup variant="contained" size="small" disabled={anyRunning}>
              <Button
                startIcon={isRunning ? <CircularProgress size={14} /> : <PlayArrowIcon />}
                onClick={() => smartRunIds.length > 0 ? runDq(currentEntityType, smartRunIds) : runDq(currentEntityType)}
              >
                {smartRunIds.length > 0 ? `Run ${smartRunIds.length} failing` : `Run ${currentEntityLabel}`}
              </Button>
              <Button size="small" onClick={e => setRunMenuAnchor(e.currentTarget)} sx={{ px: 0.5, minWidth: 28 }}>
                <ArrowDropDownIcon />
              </Button>
            </ButtonGroup>
          )}
          <Menu anchorEl={runMenuAnchor} open={!!runMenuAnchor} onClose={() => setRunMenuAnchor(null)}>
            <MenuItem disabled={smartRunIds.length === 0} onClick={() => { setRunMenuAnchor(null); runDq(currentEntityType, smartRunIds); }}>
              {tr('dataQuality.runFailingUnevaluatedLength', { length: smartRunIds.length })}
            </MenuItem>
            <MenuItem onClick={() => { setRunMenuAnchor(null); runDq(currentEntityType); }}>
              {tr('dataQuality.runAllLengthRules', { length: activeRuleIds.length })}
            </MenuItem>
            {someSelected && (
              <MenuItem onClick={() => { setRunMenuAnchor(null); runDq(currentEntityType, [...selected]); }}>
                {tr('dataQuality.runSizeSelected', { size: selected.size })}
              </MenuItem>
            )}
          </Menu>
        </Box>
      </Box>

      {/* Entity tabs */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)}>
          {modules.map(m => (
            <Tab key={m.id} label={<TabCount label={localized(m.label, m.labels)} count={ruleCountByEntity[m.id.toUpperCase()] ?? 0} />} />
          ))}
        </Tabs>
      </Box>

      {/* Empty state */}
      {!hasResults && (
        <Card sx={{ p: 4, mb: 3, textAlign: 'center', border: `1px dashed ${alpha(statusColors().warning, 0.3)}` }}>
          <Typography variant="h6" sx={{ color: statusColors().warning, mb: 1 }}>{tr('dataQuality.noV0DqResultsYet', { v0: currentEntityType.toLowerCase() })}</Typography>
          {canEdit ? (<>
            <Typography variant="body2" sx={{ color: fgMuted, mb: 2 }}>
              {tr('dataQuality.clickRunCurrententitylabelToEvaluate', { currentEntityLabel, v1: tabRules.filter(r => r.is_active).length })}
            </Typography>
            <Button variant="contained" startIcon={<PlayArrowIcon />} onClick={() => runDq(currentEntityType)} disabled={anyRunning}>
              {isRunning ? tr('dataQuality.evaluating') : `Run ${currentEntityLabel} DQ`}
            </Button>
          </>) : (
            <Typography variant="body2" sx={{ color: fgMuted }}>
              {tr('dataQuality.dqEvaluationHasNotBeen')}
            </Typography>
          )}
        </Card>
      )}

      {/* Summary cards */}
      <Grid container spacing={2} sx={{ mb: 2.5 }}>
        {/* Pass Rate — large card with breakdowns */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ cursor: 'pointer', border: statusFilter === 'all' ? `2px solid ${theme.palette.primary.main}` : undefined, height: '100%' }} onClick={() => setStatusFilter('all')}>
            <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2.5 }}>
                {/* Main rate */}
                <Box sx={{ textAlign: 'center', minWidth: 90 }}>
                  <Typography variant="caption" sx={{ color: fgMuted }}>{tr('dataQuality.passRate')}</Typography>
                  <Typography variant="h4" sx={{ color: hasResults ? rateColor(tabRate) : alpha('#fff', 0.3), fontWeight: 700 }}>{hasResults ? `${tabRate.toFixed(1)}%` : '—'}</Typography>
                  <Typography variant="caption" sx={{ color: fgMuted }}>{tabPass}/{tabTotal}</Typography>
                </Box>
                {/* Divider */}
                <Box sx={{ width: '1px', alignSelf: 'stretch', bgcolor: alpha('#fff', 0.08) }} />
                {/* Breakdowns stacked */}
                <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {/* By severity */}
                  <Box>
                    <Typography variant="caption" sx={{ color: fgMuted, fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: 1 }}>{tr('dataQuality.bySeverity')}</Typography>
                    <Box sx={{ display: 'flex', gap: 2, mt: 0.3 }}>
                      {ratesBySeverity.map(s => (
                        <Box key={s.label} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <Chip label={s.label} size="small" sx={{ fontSize: '0.55rem', height: 18, color: severityColor(s.label), borderColor: alpha(severityColor(s.label), 0.4) }} variant="outlined" />
                          <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.8rem', color: rateColor(s.rate) }}>{s.rate.toFixed(1)}%</Typography>
                        </Box>
                      ))}
                    </Box>
                  </Box>
                  {/* By type */}
                  <Box>
                    <Typography variant="caption" sx={{ color: fgMuted, fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: 1 }}>{tr('dataQuality.byType')}</Typography>
                    <Box sx={{ display: 'flex', gap: 2, mt: 0.3, flexWrap: 'wrap' }}>
                      {ratesByType.map(t => (
                        <Box key={t.label} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <Chip label={t.label} size="small" variant="outlined" sx={{ fontSize: '0.55rem', height: 18 }} />
                          <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.8rem', color: rateColor(t.rate) }}>{t.rate.toFixed(1)}%</Typography>
                        </Box>
                      ))}
                    </Box>
                  </Box>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>
        {/* Active Rules */}
        <Grid size={{ xs: 4, md: 2 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent sx={{ textAlign: 'center', py: 1.5, '&:last-child': { pb: 1.5 } }}>
              <Typography variant="caption" sx={{ color: fgMuted }}>{tr('dataQuality.activeRules')}</Typography>
              <Typography variant="h4" sx={{ fontWeight: 700 }}>{tabRules.filter(r => r.is_active).length}</Typography>
              <Typography variant="caption" sx={{ color: fgMuted }}>{tr('dataQuality.errorcountErrorsWarningcountWarnings', { errorCount, warningCount })}</Typography>
            </CardContent>
          </Card>
        </Grid>
        {/* Failing */}
        <Grid size={{ xs: 4, md: 2 }}>
          <Card sx={{ cursor: 'pointer', height: '100%', border: statusFilter === 'failing' ? `2px solid ${statusColors().error}` : undefined }} onClick={() => setStatusFilter(statusFilter === 'failing' ? 'all' : 'failing')}>
            <CardContent sx={{ textAlign: 'center', py: 1.5, '&:last-child': { pb: 1.5 } }}>
              <Typography variant="caption" sx={{ color: fgMuted }}>{tr('dataQuality.failing')}</Typography>
              <Typography variant="h4" sx={{ color: statusColors().error, fontWeight: 700 }}>{hasResults ? failingCount : '—'}</Typography>
              <Typography variant="caption" sx={{ color: fgMuted }}>{tr('dataQuality.clickToFilter')}</Typography>
            </CardContent>
          </Card>
        </Grid>
        {/* Passing */}
        <Grid size={{ xs: 4, md: 2 }}>
          <Card sx={{ cursor: 'pointer', height: '100%', border: statusFilter === 'passing' ? `2px solid ${statusColors().success}` : undefined }} onClick={() => setStatusFilter(statusFilter === 'passing' ? 'all' : 'passing')}>
            <CardContent sx={{ textAlign: 'center', py: 1.5, '&:last-child': { pb: 1.5 } }}>
              <Typography variant="caption" sx={{ color: fgMuted }}>{tr('dataQuality.passing')}</Typography>
              <Typography variant="h4" sx={{ color: statusColors().success, fontWeight: 700 }}>{hasResults ? passingCount : '—'}</Typography>
              <Typography variant="caption" sx={{ color: fgMuted }}>{tr('dataQuality.clickToFilter')}</Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Toolbar: search + filters + batch actions */}
      <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', mb: 1.5, flexWrap: 'wrap' }}>
        <TextField
          size="small"
          placeholder={tr('dataQuality.searchRules', { entity: currentEntityLabel.toLowerCase() })}
          value={currentSearch}
          onChange={(e) => setCurrentSearch(e.target.value)}
          sx={{ width: 260 }}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
        />
        <ToggleButtonGroup size="small" value={severityFilter} exclusive onChange={(_, v) => v && setSeverityFilter(v)}>
          <ToggleButton value="ALL" sx={{ textTransform: 'none', fontSize: '0.7rem', px: 1.5 }}>
            <FilterListIcon sx={{ fontSize: 14, mr: 0.5 }} />All
          </ToggleButton>
          <ToggleButton value="ERROR" sx={{ textTransform: 'none', fontSize: '0.7rem', px: 1.5, color: severityFilter === 'ERROR' ? statusColors().error : undefined }}>
            <ErrorOutlineIcon sx={{ fontSize: 14, mr: 0.5 }} />Error
          </ToggleButton>
          <ToggleButton value="WARNING" sx={{ textTransform: 'none', fontSize: '0.7rem', px: 1.5, color: severityFilter === 'WARNING' ? statusColors().warning : undefined }}>
            <WarningAmberIcon sx={{ fontSize: 14, mr: 0.5 }} />Warning
          </ToggleButton>
        </ToggleButtonGroup>

        <Box sx={{ flex: 1 }} />

        {someSelected && canEdit && (
          <Chip
            label={tr('dataQuality.runSelected', { count: selected.size })}
            icon={<PlayArrowIcon />}
            color="primary"
            onClick={() => { runDq(currentEntityType, [...selected]); }}
            sx={{ fontWeight: 600 }}
          />
        )}
        <Typography variant="caption" sx={{ color: fgMuted }}>
          {tr('dataQuality.rulesCount', { count: filteredRules.length })}
          {filteredRules.length !== enrichedRules.length && ` of ${enrichedRules.length}`}
        </Typography>
      </Box>

      {/* Rules table */}
      <Card sx={{ overflow: 'hidden' }}>
        {/* Table header */}
        <Box sx={{
          display: 'flex', alignItems: 'center', gap: 1, px: 2, minHeight: 56,
          borderBottom: `1px solid ${dividerColor}`,
          fontSize: '0.875rem', color: theme.typography.body2?.color, fontWeight: 700, whiteSpace: 'nowrap',
          '& > .dq-col': { position: 'relative' },
          '& > .dq-col::before': {
            content: '""', position: 'absolute', left: -4, top: '50%', transform: 'translateY(-50%)',
            height: 24, width: '1px', bgcolor: theme.palette.divider,
          },
        }}>
          {(() => {
            const toggle = (f: SortField) => {
              if (sortField === f) { if (sortDir === 'desc') { setSortField(null); setSortDir('asc'); } else setSortDir('desc'); }
              else { setSortField(f); setSortDir('asc'); }
            };
            const arrow = (f: SortField) => sortField === f
              ? (sortDir === 'asc' ? <ArrowUpwardIcon sx={{ fontSize: 12, ml: 0.3 }} /> : <ArrowDownwardIcon sx={{ fontSize: 12, ml: 0.3 }} />)
              : null;
            const hdr = (f: SortField, label: string, sx: Record<string, unknown>) => (
              <Box className="dq-col" sx={{ ...sx, cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', '&:hover': { color: theme.palette.text.primary } }} onClick={() => toggle(f)}>
                {label}{arrow(f)}
              </Box>
            );
            return (<>
              <Checkbox size="small" checked={allFilteredSelected} indeterminate={someSelected && !allFilteredSelected} onChange={toggleSelectAll} sx={{ p: 0.5 }} />
              {hdr('severity', 'Severity', { width: 70 })}
              {hdr('type', 'Type', { width: 100 })}
              {hdr('rule', 'Rule Name', { flex: 1 })}
              {hdr('score', 'Score', { width: 60, justifyContent: 'flex-end' })}
              {hdr('progress', 'Progress', { width: 180 })}
              <Box className="dq-col" sx={{ width: 80, textAlign: 'center' }}>{tr('dataQuality.trend')}</Box>
              <Box className="dq-col" sx={{ width: 100, textAlign: 'center' }}>{tr('dataQuality.actions')}</Box>
            </>);
          })()}
        </Box>

        {/* Rules rows */}
        {filteredRules.map(r => {
          const isSelected = selected.has(r.id);
          const rate = r.passRate;
          const hasData = rate >= 0;
          const isFailing = hasData && rate < 100;

          return (
            <Box key={r.id}>
              <Box
                sx={{
                  display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 0.75,
                  borderBottom: `1px solid ${dividerColor}`,
                  opacity: r.is_active ? 1 : 0.45,
                  '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.02) },
                  transition: 'background-color 0.15s',
                }}
              >
                <Checkbox size="small" checked={isSelected} onChange={() => toggleSelect(r.id)} sx={{ p: 0.5 }} />
                <Box sx={{ width: 70 }}>
                  <Chip label={r.severity} size="small" sx={{
                    fontSize: '0.6rem', height: 20,
                    bgcolor: alpha(severityColor(r.severity), 0.12),
                    color: severityColor(r.severity),
                    fontWeight: 600,
                  }} />
                </Box>
                <Box sx={{ width: 100 }}>
                  <Chip label={r.rule_type} size="small" variant="outlined" sx={{ fontSize: '0.6rem', height: 20 }} />
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontSize: '0.8rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.rule_name}
                  </Typography>
                </Box>
                <Box sx={{ width: 60, textAlign: 'right' }}>
                  <Typography variant="body2" sx={{
                    fontWeight: 700, fontSize: '0.85rem', fontFamily: 'monospace',
                    color: hasData ? rateColor(rate) : fgMuted,
                  }}>
                    {hasData ? `${rate.toFixed(0)}%` : '—'}
                  </Typography>
                </Box>
                <Box sx={{ width: 180, display: 'flex', alignItems: 'center', gap: 1 }}>
                  {hasData ? (<>
                    <LinearProgress variant="determinate" value={rate} sx={{
                      flex: 1, height: 6, borderRadius: 3,
                      bgcolor: alpha(rateColor(rate), 0.12),
                      '& .MuiLinearProgress-bar': { bgcolor: rateColor(rate), borderRadius: 3 },
                    }} />
                    <Typography variant="caption" sx={{ color: fgMuted, fontSize: '0.65rem', minWidth: 36 }}>
                      {r.passed}/{r.total}
                    </Typography>
                  </>) : (
                    <Typography variant="caption" sx={{ color: fgMuted, fontStyle: 'italic' }}>{tr('dataQuality.notEvaluated')}</Typography>
                  )}
                </Box>
                {/* Trend sparkline */}
                <Box sx={{ width: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.3 }}>
                  {(() => {
                    const tc = tabChart.find(c => c.code === r.rule_code);
                    if (!tc || tc.runs.length < 2) return <Typography variant="caption" sx={{ color: fgMuted, fontSize: '0.6rem' }}>—</Typography>;
                    return (<>
                      <LineChart width={48} height={20} data={tc.runs}>
                        <Line type="monotone" dataKey="pass_rate" stroke={tc.fill} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                      </LineChart>
                      {tc.delta != null && (
                        <Typography variant="caption" sx={{ fontWeight: 700, fontSize: '0.6rem', color: tc.delta > 0 ? statusColors().success : tc.delta < 0 ? statusColors().error : fgMuted }}>
                          {tc.delta > 0 ? '+' : ''}{tc.delta}%
                        </Typography>
                      )}
                    </>);
                  })()}
                </Box>
                <Box sx={{ width: 100, display: 'flex', justifyContent: 'center', gap: 0.25 }}>
                  {isFailing && (
                    <Tooltip title={tr('dataQuality.viewFailingRecords')}>
                      <IconButton size="small" onClick={() => openDrawer(r)} sx={{ color: statusColors().error }}>
                        <VisibilityIcon sx={{ fontSize: '1rem' }} />
                      </IconButton>
                    </Tooltip>
                  )}
                  <Tooltip title={tr('dataQuality.viewSql')}>
                    <IconButton size="small" onClick={() => setSqlViewRule(sqlViewRule?.id === r.id ? null : r)}>
                      <CodeIcon sx={{ fontSize: '1rem' }} />
                    </IconButton>
                  </Tooltip>
                </Box>
              </Box>

              {/* Inline SQL view */}
              {sqlViewRule?.id === r.id && (
                <Box sx={{ px: 3, py: 1.5, bgcolor: alpha('#000', 0.03), borderBottom: `1px solid ${dividerColor}` }}>
                  <Typography variant="caption" sx={{ color: fgMuted, display: 'block', mb: 0.5 }}>{tr('dataQuality.sqlExpressionRuleCode', { rule_code: r.rule_code })}</Typography>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.75rem', whiteSpace: 'pre-wrap' }}>{r.sql_expression}</Typography>
                </Box>
              )}
            </Box>
          );
        })}

        {filteredRules.length === 0 && !loading && (
          <Box sx={{ p: 3, textAlign: 'center' }}>
            <Typography variant="body2" sx={{ color: fgMuted }}>
              {currentSearch || severityFilter !== 'ALL' || statusFilter !== 'all' ? tr('dataQuality.noRulesMatchTheseFilters') : tr('dataQuality.noRulesDefined', { entity: currentEntityLabel.toLowerCase() })}
            </Typography>
          </Box>
        )}
      </Card>

      {/* Failures side drawer */}
      <Drawer anchor="right" open={!!drawerRule} onClose={() => closeDrawer()} PaperProps={{ sx: { width: 480 } }}>
        {drawerRule && (
          <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <Box sx={{ p: 2, borderBottom: `1px solid ${dividerColor}`, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{tr('dataQuality.failingRecords')}</Typography>
                <Typography variant="body2" sx={{ color: fgMuted, mt: 0.5 }}>{drawerRule.rule_name}</Typography>
                <Box sx={{ display: 'flex', gap: 0.5, mt: 1 }}>
                  <Chip label={drawerRule.severity} size="small" sx={{ fontSize: '0.6rem', height: 20, bgcolor: alpha(severityColor(drawerRule.severity), 0.12), color: severityColor(drawerRule.severity) }} />
                  <Chip label={drawerRule.rule_type} size="small" variant="outlined" sx={{ fontSize: '0.6rem', height: 20 }} />
                  <Chip label={tr('dataQuality.failingCount', { count: drawerRule.failed ?? drawerFailures.length })} size="small" sx={{ fontSize: '0.6rem', height: 20, bgcolor: alpha(statusColors().error, 0.12), color: statusColors().error }} />
                </Box>
              </Box>
              <IconButton size="small" onClick={() => closeDrawer()}><CloseIcon /></IconButton>
            </Box>

            <Box sx={{ flex: 1, overflow: 'auto' }}>
              {drawerLoading && drawerFailures.length === 0 ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}><CircularProgress /></Box>
              ) : drawerFailures.length === 0 ? (
                <Box sx={{ p: 3, textAlign: 'center' }}>
                  <CheckCircleIcon sx={{ fontSize: 40, color: statusColors().success, mb: 1 }} />
                  <Typography variant="body2" sx={{ color: fgMuted }}>{tr('dataQuality.noFailingRecordsFound')}</Typography>
                </Box>
              ) : (<>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 600, fontSize: '0.7rem' }}>{tr('dataQuality.name')}</TableCell>
                      <TableCell sx={{ fontWeight: 600, fontSize: '0.7rem' }}>{tr('dataQuality.country')}</TableCell>
                      <TableCell sx={{ fontWeight: 600, fontSize: '0.7rem' }}>{tr('dataQuality.stage')}</TableCell>
                      <TableCell sx={{ fontWeight: 600, fontSize: '0.7rem', width: 40 }}></TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {drawerFailures.map(f => (
                      <TableRow key={f.entity_id} hover>
                        <TableCell sx={{ fontSize: '0.75rem' }}>
                          <Typography variant="body2" sx={{ fontSize: '0.78rem', fontWeight: 500 }}><RecordLink type={drawerRule.entity_type} id={f.entity_id}>{f.name || f.entity_id}</RecordLink></Typography>
                        </TableCell>
                        <TableCell sx={{ fontSize: '0.75rem' }}>{((f as Record<string, unknown>).country_code as string) ?? '—'}</TableCell>
                        <TableCell>
                          {f.lifecycle_stage && (
                            <Chip label={f.lifecycle_stage} size="small" sx={{ fontSize: '0.58rem', height: 18 }} />
                          )}
                        </TableCell>
                        <TableCell>
                          <Tooltip title={tr('dataQuality.openRecord')}>
                            <IconButton size="small" disabled={!recordPath(drawerRule.entity_type, f.entity_id)} onClick={() => navigate(`${recordPath(drawerRule.entity_type, f.entity_id)}?tab=quality`)}>
                              <OpenInNewIcon sx={{ fontSize: '0.9rem' }} />
                            </IconButton>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {drawerFailures.length < drawerTotal && (
                  <Box sx={{ textAlign: 'center', py: 1 }}>
                    <Button size="small" variant="outlined" disabled={drawerLoading}
                      onClick={() => loadDrawer(drawerRule.id, Math.ceil(drawerFailures.length / FAILURE_PAGE))}>
                      {tr('common.loadMore', { count: drawerTotal - drawerFailures.length })}
                    </Button>
                  </Box>
                )}
              </>)}
            </Box>

            {/* SQL expression at bottom of drawer */}
            <Box sx={{ p: 2, borderTop: `1px solid ${dividerColor}`, bgcolor: alpha('#000', 0.02) }}>
              <Typography variant="caption" sx={{ color: fgMuted, display: 'block', mb: 0.5 }}>{tr('dataQuality.sqlExpression')}</Typography>
              <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.7rem', whiteSpace: 'pre-wrap' }}>{drawerRule.sql_expression}</Typography>
            </Box>
          </Box>
        )}
      </Drawer>
    </Box>
  );
}
