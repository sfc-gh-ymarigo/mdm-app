import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Box, Typography, Card, CardContent, alpha, CircularProgress, Chip, useTheme,
  Drawer, Button, IconButton, Tooltip, FormControl, InputLabel, Select, MenuItem
} from '@mui/material';
import ReactECharts from 'echarts-for-react';
import SaveIcon from '@mui/icons-material/Save';
import CloseIcon from '@mui/icons-material/Close';
import PeopleIcon from '@mui/icons-material/People';
import PersonIcon from '@mui/icons-material/Person';
import CenterFocusStrongIcon from '@mui/icons-material/CenterFocusStrong';
import { useUser, getCurrentUserEmail } from '../context/UserContext';
import { useBrand } from '../config/BrandContext';
import StageChip from './StageChip';
import DqScoreBar from './DqScoreBar';
import { useToast, type ToastSeverity } from './common/Toast';
import { RecordLink } from './common/Links';
import { tr } from '../i18n';
import { CUSTOMER_STAGES, PRODUCT_STAGES } from '../types/models';

import { liveColors, stageColor as stageOf, statusColors } from '../theme/brandColors';
type CustomerNode = { id: string; name: string; tradeName: string | null; country: string | null; type: string | null; stage: string; dqScore: number | null; parentId: string | null; children: CustomerNode[] };

const stageColor = liveColors([...new Set([...CUSTOMER_STAGES, ...PRODUCT_STAGES])], stageOf);
// Terminal stages render hollow (dashed outline) so they don't read as drafts
const isHollow = (stage: string) => stage === 'ARCHIVED' || stage === 'DISCONTINUED';
const CUSTOMER_TYPES = ['ENTERPRISE', 'SMB', 'PROSPECT', 'PUBLIC_SECTOR'];
const API = '/api/hierarchy';
const hdrs = () => ({ 'Content-Type': 'application/json', 'x-mdm-user': getCurrentUserEmail() });

function flattenCustomers(nodes: CustomerNode[]): CustomerNode[] {
  const result: CustomerNode[] = [];
  function walk(n: CustomerNode) { result.push(n); n.children.forEach(walk); }
  nodes.forEach(walk);
  return result;
}

function customerToEcharts(nodes: CustomerNode[], rootName: string, rootColor: string, groupColor: string, focus: string | null): unknown {
  function convert(n: CustomerNode): unknown {
    const color = stageColor[n.stage] || statusColors().neutral;
    const childCount = n.children.length;
    const style = isHollow(n.stage)
      ? { color: 'transparent', borderColor: color, borderWidth: 2, borderType: 'dashed' as const }
      : { color, borderColor: color };
    // Legend focus: dim every customer outside the selected stage
    const dim = focus != null && n.stage !== focus;
    return {
      name: n.name, value: n.dqScore, _custId: n.id, _childCount: childCount, _stage: n.stage,
      collapsed: childCount > 0 && focus == null,
      itemStyle: { ...style, opacity: dim ? 0.2 : 1 },
      label: { opacity: dim ? 0.35 : 1 },
      emphasis: { itemStyle: style },
      children: n.children.map(convert),
    };
  }
  const root = { name: rootName, itemStyle: { color: rootColor, borderColor: rootColor }, emphasis: { itemStyle: { color: rootColor, borderColor: rootColor } } };
  if (!nodes.some(n => n.type)) return { ...root, children: nodes.map(convert) };
  const groups: Record<string, CustomerNode[]> = {};
  nodes.forEach(n => { const g = n.type || 'OTHER'; if (!groups[g]) groups[g] = []; groups[g].push(n); });
  const topLevel: unknown[] = [];
  Object.entries(groups).forEach(([type, custs]) => {
    topLevel.push({
      name: type.replace('_', ' '), _groupType: type, _childCount: custs.length,
      collapsed: focus == null,
      itemStyle: { color: groupColor, borderColor: groupColor },
      emphasis: { itemStyle: { color: groupColor, borderColor: groupColor } },
      label: { fontSize: 14, fontWeight: 'bold' },
      children: custs.map(convert),
    });
  });
  return { ...root, children: topLevel };
}

/** Parent-child tree for customers (grouped by customer type) or any module with a 'self' hierarchy. */
export default function CustomerHierarchy({ moduleId = 'customer' }: { moduleId?: string }) {
  const theme = useTheme();
  const brand = useBrand();
  const isCustomer = moduleId === 'customer';
  const mod = brand.modules.find(m => m.id === moduleId);
  const parentField = mod?.hierarchy?.parent_field || 'parent_id';
  const entityType = moduleId.toUpperCase();
  const singular = mod?.singular || moduleId;
  // Customer copy keeps its wording; other modules use entity-neutral labels
  const L = (key: string, generic: string, opts: Record<string, unknown> = {}) =>
    isCustomer ? tr(`customerHierarchy.${key}`, opts) : tr(`entityHierarchy.${generic}`, { entity: singular, ...opts });
  const isDark = theme.palette.mode === 'dark';
  const fgMuted = theme.palette.text.secondary;
  const dividerColor = theme.palette.divider;
  const { canEdit } = useUser();

  const [customers, setCustomers] = useState<CustomerNode[]>([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();
  const setSnack = (s: { msg: string; severity: ToastSeverity } | null) => { if (s) toast(s.msg, s.severity); };
  const [saving, setSaving] = useState(false);
  const [selectedCust, setSelectedCust] = useState<CustomerNode | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [custEditing, setCustEditing] = useState(false);
  const [editCustParent, setEditCustParent] = useState<string>('');
  const [editCustType, setEditCustType] = useState<string>('');
  const [custReparent, setCustReparent] = useState(false);
  const [reparentCustId, setReparentCustId] = useState<string>('');
  const [reparentTargetId, setReparentTargetId] = useState<string>('');
  const [focusStage, setFocusStage] = useState<string | null>(null);
  const chartRef = useRef<ReactECharts>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const url = isCustomer ? `${API}/customers` : `${API}/module/${moduleId}`;
      const data = await fetch(url, { headers: hdrs() }).then(r => r.json());
      setCustomers(Array.isArray(data) ? data : []);
    }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [isCustomer, moduleId]);
  useEffect(() => { fetchData(); }, [fetchData]);

  const allCusts = flattenCustomers(customers);
  const rootCusts = allCusts.filter(c => !c.parentId);
  const parentChildPairs = customers.filter(c => c.children.length > 0).length;

  const handleCustClick = (params: { data?: { _custId?: string; _groupType?: string }; dataIndex?: number; event?: { target?: { type?: string; parent?: { type?: string } } } }) => {
    const tgt = (params as any).event?.target;
    const isLabelClick = tgt?.parent?.type === 'text';
    const hasChildren = (params.data as any)?.children?.length > 0;
    if (!isLabelClick && hasChildren) {
      const instance = chartRef.current?.getEchartsInstance();
      if (instance && params.dataIndex != null) {
        instance.dispatchAction({ type: 'treeExpandAndCollapse', seriesId: (instance.getOption() as any).series[0].id, dataIndex: params.dataIndex });
      }
      return;
    }
    if (params.data?._groupType) { setSelectedGroup(params.data._groupType); setSelectedCust(null); setCustEditing(false); setCustReparent(false); return; }
    const custId = params.data?._custId;
    if (!custId) return;
    const cust = allCusts.find(c => c.id === custId);
    if (cust) { setSelectedCust(cust); setSelectedGroup(null); setCustEditing(false); setCustReparent(false); }
  };

  const resetZoom = () => {
    const instance = chartRef.current?.getEchartsInstance();
    if (instance) instance.dispatchAction({ type: 'restore' });
  };

  const startCustEdit = () => {
    if (!selectedCust) return;
    setEditCustParent(selectedCust.parentId || '');
    setEditCustType(selectedCust.type || '');
    setCustEditing(true);
  };

  const handleCustSave = async () => {
    if (!selectedCust) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {};
      const newPar = editCustParent || null;
      if (newPar !== selectedCust.parentId) body[parentField] = newPar;
      if (isCustomer && editCustType !== (selectedCust.type || '')) body.customer_type = editCustType || null;
      if (Object.keys(body).length === 0) { setCustEditing(false); setSaving(false); return; }
      const res = await fetch(`/api/entities/${moduleId}/${selectedCust.id}`, { method: 'PUT', headers: hdrs(), body: JSON.stringify(body) });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || tr('customerHierarchy.saveFailed')); }
      const data = await res.json();
      if (data._hierarchy_workflow) {
        setSnack({ msg: tr('customerHierarchy.hierarchyChangeSubmittedForApproval', { id: data._hierarchy_workflow.id }), severity: 'info' });
      } else {
        setSnack({ msg: `${selectedCust.name} updated`, severity: 'success' });
      }
      setCustEditing(false); setSelectedCust(null); await fetchData();
    } catch (e) { setSnack({ msg: (e as Error).message, severity: 'error' }); }
    finally { setSaving(false); }
  };

  const parentCust = selectedCust?.parentId ? allCusts.find(c => c.id === selectedCust.parentId) : null;
  const childCusts = selectedCust ? allCusts.filter(c => c.parentId === selectedCust.id) : [];
  const drawerOpen = !!selectedCust || !!selectedGroup || custReparent;

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;

  // Group nodes: brand secondary, lightened on dark backgrounds for contrast
  const groupColor = isDark ? brand.palette.secondaryLight : brand.palette.secondary;
  const rootLabel = isCustomer ? (brand.hierarchyRoots?.customerTree ?? tr('customerHierarchy.customerTree')) : (mod?.hierarchy?.root_label || mod?.label || moduleId);
  const custTreeData = customerToEcharts(customers, rootLabel,
    brand.palette.primary, groupColor, focusStage);
  const stageCounts = allCusts.reduce<Record<string, number>>((acc, c) => { acc[c.stage] = (acc[c.stage] || 0) + 1; return acc; }, {});
  // Customer lifecycle by default, plus any other stage actually present in the data
  const legendStages = [...new Set<string>([...CUSTOMER_STAGES, ...Object.keys(stageCounts)])];
  const stageLabel = (s: string) => tr(`stages.${s}`, { defaultValue: s.replace(/_/g, ' ') });
  const chartOption = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item' as const,
      formatter: (params: { name: string; value: number; data: { _stage?: string; _childCount?: number } }) => {
        const name = params.name.replace(/\{[^}]*\}/g, '').trim();
        let html = `<strong>${name}</strong>`;
        const stage = params.data?._stage;
        if (stage) html += `<br/><span style="display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:6px;background:${stageColor[stage]}"></span>${stageLabel(stage)}`;
        if (params.value != null) html += `<br/>DQ Score: ${params.value}%`;
        const cnt = params.data?._childCount;
        if (cnt) html += `<br/>${cnt} child${cnt > 1 ? 'ren' : ''}`;
        return html;
      },
      backgroundColor: theme.palette.background.paper,
      borderColor: isDark ? alpha('#fff', 0.1) : alpha(brand.palette.primary, 0.12),
      textStyle: { color: theme.palette.text.primary, fontSize: 12 },
    },
    toolbox: { show: false, feature: { restore: {} } },
    series: [{
      type: 'tree', data: [custTreeData], layout: 'orthogonal', orient: 'LR',
      left: '8%', right: '30%',
      symbol: 'roundRect', symbolSize: [18, 18], initialTreeDepth: 2,
      animationDurationUpdate: 750, roam: true,
      label: {
        position: 'right', verticalAlign: 'middle', fontSize: 14, color: theme.palette.text.primary,
        formatter: (p: { data: { _childCount?: number }; name: string }) => {
          const cnt = p.data?._childCount;
          return cnt ? `${p.name}  {count|${cnt}}` : p.name;
        },
        rich: { count: { fontSize: 11, color: theme.palette.text.secondary, backgroundColor: alpha(theme.palette.text.secondary, 0.12), padding: [2, 6], borderRadius: 8 } },
      },
      leaves: { label: { position: 'right', fontSize: 13, color: alpha(theme.palette.text.primary, 0.85) } },
      lineStyle: { color: isDark ? alpha('#fff', 0.12) : alpha(brand.palette.primary, 0.15), width: 1.5, curveness: 0.4 },
      emphasis: {
        focus: 'descendant' as const,
        itemStyle: { shadowBlur: 8, shadowColor: 'rgba(255,255,255,0.3)' },
        label: { fontWeight: 'bold' as const },
      },
      expandAndCollapse: false,
    }],
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="body2" color="text.secondary">
          {L('summary', 'summary', { entities: allCusts.length, count: parentChildPairs, action: canEdit ? tr('customerHierarchy.viewEdit') : tr('customerHierarchy.view') })}
        </Typography>
        {canEdit && (
          <Button size="small" variant="outlined" startIcon={<PeopleIcon />} onClick={() => { setCustReparent(true); setSelectedCust(null); setSelectedGroup(null); setReparentCustId(''); setReparentTargetId(''); }}>{L('moveCustomer', 'move')}</Button>
        )}
      </Box>

      <Card><CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap', mb: 1, gap: 0.5, alignItems: 'center' }}>
          <Typography variant="caption" sx={{ color: fgMuted, mr: 0.5 }}>{tr('customerHierarchy.legendStage')}</Typography>
          {legendStages.map(s => {
            const c = stageColor[s] || stageOf(s);
            const n = stageCounts[s] || 0;
            const on = focusStage === s;
            return (
              <Tooltip key={s} title={tr(on ? 'customerHierarchy.legendShowAll' : 'customerHierarchy.legendFocus')}>
                <Chip size="small" clickable onClick={() => setFocusStage(on ? null : s)}
                  icon={<Box sx={{ width: 10, height: 10, borderRadius: '3px', ml: '6px !important', flexShrink: 0,
                    ...(isHollow(s) ? { border: `1.5px dashed ${c}` } : { bgcolor: c }) }} />}
                  label={`${stageLabel(s)} · ${n}`}
                  variant={on ? 'filled' : 'outlined'}
                  sx={{ fontSize: '0.68rem', opacity: n === 0 && !on ? 0.45 : 1,
                    borderColor: on ? c : alpha(c, 0.35), bgcolor: on ? alpha(c, 0.18) : 'transparent', color: theme.palette.text.primary }} />
              </Tooltip>
            );
          })}
          <Tooltip title={tr('customerHierarchy.resetZoom')}><IconButton size="small" onClick={resetZoom} sx={{ ml: 1 }}><CenterFocusStrongIcon fontSize="small" /></IconButton></Tooltip>
        </Box>
        <ReactECharts ref={chartRef} option={chartOption} style={{ height: 500 }} opts={{ renderer: 'canvas' }} onEvents={{ click: handleCustClick }} />
      </CardContent></Card>

      <Drawer anchor="right" open={drawerOpen} onClose={() => { setSelectedCust(null); setCustEditing(false); setSelectedGroup(null); setCustReparent(false); }}
        PaperProps={{ sx: { width: { xs: '100%', md: 420 }, bgcolor: theme.palette.background.paper, p: 0 } }}>

        {selectedCust && (
          <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <Box sx={{ p: 2.5, borderBottom: `1px solid ${dividerColor}` }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
                {childCusts.length > 0 ? <PeopleIcon sx={{ color: isDark ? brand.palette.secondaryLight : brand.palette.secondary }} /> : <PersonIcon sx={{ color: stageColor[selectedCust.stage] || statusColors().neutral }} />}
                <StageChip stage={selectedCust.stage} />
                {selectedCust.type && <Chip label={selectedCust.type} size="small" variant="outlined" sx={{ fontSize: '0.6rem' }} />}
                <IconButton size="small" sx={{ ml: 'auto' }} onClick={() => { setSelectedCust(null); setCustEditing(false); }}><CloseIcon fontSize="small" /></IconButton>
              </Box>
              <Typography variant="h5" sx={{ fontWeight: 700 }}><RecordLink type={entityType} id={selectedCust.id}>{selectedCust.name}</RecordLink></Typography>
              {selectedCust.tradeName && <Typography variant="body2" sx={{ color: fgMuted, mt: 0.3 }}>{selectedCust.tradeName}</Typography>}
            </Box>
            <Box sx={{ flex: 1, overflow: 'auto', p: 2.5 }}>
              {custEditing ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {isCustomer && <FormControl size="small" fullWidth><InputLabel>{tr('customerHierarchy.customerType')}</InputLabel><Select value={editCustType} label={tr('customerHierarchy.customerType')} onChange={e => setEditCustType(e.target.value)}>{CUSTOMER_TYPES.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}</Select></FormControl>}
                  <FormControl size="small" fullWidth><InputLabel>{L('parentCompany', 'parent')}</InputLabel><Select value={editCustParent} label={L('parentCompany', 'parent')} onChange={e => setEditCustParent(e.target.value)}><MenuItem value="">{tr('customerHierarchy.noParent')}</MenuItem>{rootCusts.filter(c => c.id !== selectedCust.id).map(c => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}</Select></FormControl>
                </Box>
              ) : (
                <>
                  <Box sx={{ mt: 1, mb: 2 }}>
                    {[['Country', selectedCust.country], ['Type', selectedCust.type], ['Stage', selectedCust.stage], ['Parent', parentCust?.name || '(top level)']].map(([l, v]) => v && (
                      <Box key={l as string} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.75, borderBottom: `1px solid ${dividerColor}` }}><Typography variant="body2" sx={{ color: fgMuted }}>{l}</Typography><Typography variant="body2" sx={{ fontWeight: 500 }}>{v}</Typography></Box>
                    ))}
                  </Box>
                  <Box sx={{ mb: 2 }}><DqScoreBar value={selectedCust.dqScore} label={tr('customerHierarchy.dqScore')} /></Box>
                  {childCusts.length > 0 && (
                    <><Typography variant="overline" sx={{ color: fgMuted }}>{L('subsidiariesLength', 'children', { length: childCusts.length })}</Typography><Box sx={{ mt: 1 }}>
                      {childCusts.map(c => (
                        <Box key={c.id} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.75, borderBottom: `1px solid ${dividerColor}`, cursor: 'pointer', '&:hover': { bgcolor: alpha(fgMuted, 0.04) } }} onClick={() => { setSelectedCust(c); setCustEditing(false); }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><PersonIcon sx={{ fontSize: 16, color: stageColor[c.stage] || statusColors().neutral }} /><Typography variant="body2">{c.name}</Typography></Box>
                          {c.country && <Chip label={c.country} size="small" sx={{ fontSize: '0.6rem', height: 20 }} />}
                        </Box>
                      ))}
                    </Box></>
                  )}
                </>
              )}
            </Box>
            <Box sx={{ p: 2, borderTop: `1px solid ${dividerColor}`, display: 'flex', gap: 1 }}>
              {custEditing ? (<><Button onClick={() => setCustEditing(false)} disabled={saving}>{tr('customerHierarchy.cancel')}</Button><Button variant="contained" startIcon={saving ? <CircularProgress size={14} /> : <SaveIcon />} onClick={handleCustSave} disabled={saving} sx={{ ml: 'auto' }}>{tr('customerHierarchy.save')}</Button></>) : canEdit ? (<Button variant="contained" size="small" onClick={startCustEdit} sx={{ ml: 'auto' }}>{tr('customerHierarchy.edit')}</Button>) : null}
            </Box>
          </Box>
        )}

        {selectedGroup && !selectedCust && (
          <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <Box sx={{ p: 2.5, borderBottom: `1px solid ${dividerColor}` }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}><PeopleIcon sx={{ color: isDark ? brand.palette.secondaryLight : brand.palette.secondary }} /><Chip label={tr('customerHierarchy.customerGroup')} size="small" /><IconButton size="small" sx={{ ml: 'auto' }} onClick={() => setSelectedGroup(null)}><CloseIcon fontSize="small" /></IconButton></Box>
              <Typography variant="h5" sx={{ fontWeight: 700 }}>{selectedGroup.replace('_', ' ')}</Typography>
            </Box>
            <Box sx={{ flex: 1, overflow: 'auto', p: 2.5 }}>
              {allCusts.filter(c => c.type === selectedGroup).map(c => (
                <Box key={c.id} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 0.75, borderBottom: `1px solid ${dividerColor}`, cursor: 'pointer', '&:hover': { bgcolor: alpha(fgMuted, 0.04) } }}
                  onClick={() => { setSelectedCust(c); setSelectedGroup(null); setCustEditing(false); }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><PersonIcon sx={{ fontSize: 16, color: stageColor[c.stage] || statusColors().neutral }} /><Typography variant="body2">{c.name}</Typography></Box>
                  <Box sx={{ display: 'flex', gap: 0.5 }}>{c.country && <Chip label={c.country} size="small" sx={{ fontSize: '0.6rem', height: 20 }} />}<StageChip stage={c.stage} /></Box>
                </Box>
              ))}
            </Box>
          </Box>
        )}

        {custReparent && (
          <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <Box sx={{ p: 2.5, borderBottom: `1px solid ${dividerColor}`, display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <PeopleIcon sx={{ color: statusColors().warning }} /><Typography variant="h6" sx={{ fontSize: '1rem' }}>{L('moveCustomer', 'move')}</Typography>
              <IconButton size="small" sx={{ ml: 'auto' }} onClick={() => setCustReparent(false)}><CloseIcon fontSize="small" /></IconButton>
            </Box>
            <Box sx={{ flex: 1, p: 2.5, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <FormControl size="small" fullWidth><InputLabel>{L('customerToMove', 'toMove')}</InputLabel><Select value={reparentCustId} label={L('customerToMove', 'toMove')} onChange={e => setReparentCustId(e.target.value)}>{allCusts.map(c => <MenuItem key={c.id} value={c.id}>{c.name}{c.country ? ` (${c.country})` : ''}</MenuItem>)}</Select></FormControl>
              <FormControl size="small" fullWidth><InputLabel>{tr('customerHierarchy.newParent')}</InputLabel><Select value={reparentTargetId} label={tr('customerHierarchy.newParent')} onChange={e => setReparentTargetId(e.target.value)}><MenuItem value="">{tr('customerHierarchy.noParent')}</MenuItem>{allCusts.filter(c => c.id !== reparentCustId).map(c => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}</Select></FormControl>
            </Box>
            <Box sx={{ p: 2, borderTop: `1px solid ${dividerColor}`, display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
              <Button onClick={() => setCustReparent(false)}>{tr('customerHierarchy.cancel')}</Button>
              <Button variant="contained" disabled={!reparentCustId || saving} startIcon={saving ? <CircularProgress size={14} /> : <SaveIcon />} onClick={async () => {
                setSaving(true);
                try {
                  const res = await fetch(`/api/entities/${moduleId}/${reparentCustId}`, { method: 'PUT', headers: hdrs(), body: JSON.stringify({ [parentField]: reparentTargetId || null }) });
                  if (!res.ok) throw new Error((await res.json()).error || tr('customerHierarchy.failed'));
                  const data = await res.json();
                  if (data._hierarchy_workflow) {
                    setSnack({ msg: tr('customerHierarchy.hierarchyChangeSubmittedForApproval', { id: data._hierarchy_workflow.id }), severity: 'info' });
                  } else {
                    setSnack({ msg: L('customerMoved', 'moved'), severity: 'success' });
                  }
                  setCustReparent(false); await fetchData();
                } catch (e) { setSnack({ msg: (e as Error).message, severity: 'error' }); }
                finally { setSaving(false); }
              }}>{tr('customerHierarchy.move')}</Button>
            </Box>
          </Box>
        )}
      </Drawer>
    </Box>
  );
}
