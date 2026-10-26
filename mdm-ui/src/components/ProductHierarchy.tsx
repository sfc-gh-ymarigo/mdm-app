import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Typography, Card, CardContent, alpha, CircularProgress, Chip, useTheme,
  Drawer, TextField, Button, IconButton, FormControl, InputLabel, Select, MenuItem,
  Switch, FormControlLabel, Tooltip, List, ListItemButton, ListItemText

} from '@mui/material';
import InventoryIcon from '@mui/icons-material/Inventory2';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ReactECharts from 'echarts-for-react';
import AddIcon from '@mui/icons-material/Add';
import SaveIcon from '@mui/icons-material/Save';
import DeleteIcon from '@mui/icons-material/Delete';
import CloseIcon from '@mui/icons-material/Close';
import CategoryIcon from '@mui/icons-material/Category';
import FolderIcon from '@mui/icons-material/Folder';
import CenterFocusStrongIcon from '@mui/icons-material/CenterFocusStrong';
import { useUser, getCurrentUserEmail } from '../context/UserContext';
import { useBrand } from '../config/BrandContext';
import { useToast, type ToastSeverity } from './common/Toast';
import { useAsk } from './common/Confirm';
import { formatMoney } from './common/format';
import { tr } from '../i18n';

import { statusColors, stageColor } from '../theme/brandColors';
import { PRODUCT_STAGES } from '../types/models';
type FlatCategory = { id: number; code: string; name: string; parent_id: number | null; level: number; is_active: boolean; productCount: number };
type CategoryNode = { id: number; code: string; name: string; level: number; productCount: number; stages?: Record<string, number>; children: CategoryNode[] };
type ProductSummary = { id: string; name: string; sku: string; lifecycle_stage: string; ean?: string; brand?: string; manufacturer?: string; list_price?: string; currency_code?: string; esg_rating?: string; product_type?: string; unit_of_measure?: string; weight_kg?: string; dq_score?: number; completeness?: number; short_desc?: string; category_name?: string; parent_category_name?: string };

const API = '/api/hierarchy';
const hdrs = () => ({ 'Content-Type': 'application/json', 'x-mdm-user': getCurrentUserEmail() });

// Discontinued products render hollow, like archived customers
const isHollow = (stage: string) => stage === 'DISCONTINUED';

function categoryToEcharts(nodes: CategoryNode[], rootName: string, rootColor: string, catColor: string, focus: string | null): unknown {
  const count = (n: CategoryNode) => (focus ? n.stages?.[focus] || 0 : n.productCount);
  const node = (n: CategoryNode, color: string, children?: unknown[]) => {
    const empty = n.productCount === 0;
    const style = empty
      ? { color: 'transparent', borderColor: alpha(color, 0.6), borderWidth: 2, borderType: 'dashed' as const }
      : { color, borderColor: color };
    // Legend focus: dim categories with no product in the selected stage
    const dim = focus != null && count(n) === 0;
    return {
      name: n.name, value: n.productCount, _catId: n.id, _childCount: count(n), _stages: n.stages || {},
      itemStyle: { ...style, opacity: dim ? 0.25 : 1 },
      label: { opacity: dim ? 0.35 : 1 },
      emphasis: { itemStyle: style },
      ...(children ? { children, collapsed: focus == null } : {}),
    };
  };
  return {
    name: rootName,
    itemStyle: { color: rootColor, borderColor: rootColor },
    emphasis: { itemStyle: { color: rootColor, borderColor: rootColor } },
    children: nodes.map(n => node(n, catColor, n.children.map(c => node(c, alpha(catColor, 0.7))))),
  };
}

export default function ProductHierarchy() {
  const ask = useAsk();
  const theme = useTheme();
  const brand = useBrand();
  const isDark = theme.palette.mode === 'dark';
  const fgMuted = theme.palette.text.secondary;
  const dividerColor = theme.palette.divider;
  const { canEdit, isAdmin } = useUser();
  const navigate = useNavigate();

  const [categories, setCategories] = useState<CategoryNode[]>([]);
  const [flatCats, setFlatCats] = useState<FlatCategory[]>([]);
  const [catProducts, setCatProducts] = useState<ProductSummary[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<ProductSummary | null>(null);
  const [focusStage, setFocusStage] = useState<string | null>(null);
  const [prodEditing, setProdEditing] = useState(false);
  const [editProdCategory, setEditProdCategory] = useState<string>('');
  const [editProdLifecycle, setEditProdLifecycle] = useState<string>('');

  const [loading, setLoading] = useState(true);
  const toast = useToast();
  const setSnack = (s: { msg: string; severity: ToastSeverity } | null) => { if (s) toast(s.msg, s.severity); };
  const [saving, setSaving] = useState(false);
  const [selectedCat, setSelectedCat] = useState<FlatCategory | null>(null);
  const [catEditing, setCatEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editCode, setEditCode] = useState('');
  const [editParent, setEditParent] = useState<string>('');
  const [editActive, setEditActive] = useState(true);
  const [catCreating, setCatCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCode, setNewCode] = useState('');
  const [newParent, setNewParent] = useState<string>('');
  const chartRef = useRef<ReactECharts>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [catRes, flatRes] = await Promise.all([
        fetch(`${API}/product-categories`).then(r => r.json()),
        fetch(`${API}/product-categories/flat`).then(r => r.json()),
      ]);
      setCategories(catRes); setFlatCats(flatRes);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { fetchData(); }, [fetchData]);

  const rootCats = flatCats.filter(c => c.level === 0);
  const totalProducts = categories.reduce((s, c) => s + c.productCount + c.children.reduce((s2, cc) => s2 + cc.productCount, 0), 0);

  const handleCatClick = (params: { data?: { _catId?: number }; dataIndex?: number; event?: { target?: { type?: string; parent?: { type?: string } } } }) => {
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
    const catId = (params.data as any)?._catId;
    if (!catId) return;
    const cat = flatCats.find(c => c.id === catId);
    if (cat) { setSelectedCat(cat); setCatEditing(false); setCatCreating(false); fetchCatProducts(cat.id); }
  };

  const fetchCatProducts = async (catId: number) => {
    setLoadingProducts(true);
    try {
      const res = await fetch(`/api/products?category_id=${catId}`);
      const data = await res.json();
      setCatProducts(data);
    } catch { setCatProducts([]); }
    finally { setLoadingProducts(false); }
  };

  const resetZoom = () => {
    const instance = chartRef.current?.getEchartsInstance();
    if (instance) instance.dispatchAction({ type: 'restore' });
  };

  const startCatEdit = () => {
    if (!selectedCat) return;
    setEditName(selectedCat.name); setEditCode(selectedCat.code);
    setEditParent(selectedCat.parent_id != null ? String(selectedCat.parent_id) : '');
    setEditActive(selectedCat.is_active); setCatEditing(true);
  };

  const handleCatSave = async () => {
    if (!selectedCat) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {};
      if (editName !== selectedCat.name) body.name = editName;
      if (editCode !== selectedCat.code) body.code = editCode;
      const np = editParent ? parseInt(editParent) : null;
      if (np !== selectedCat.parent_id) body.parent_id = np;
      if (editActive !== selectedCat.is_active) body.is_active = editActive;
      if (Object.keys(body).length === 0) { setCatEditing(false); setSaving(false); return; }
      const res = await fetch(`${API}/product-categories/${selectedCat.id}`, { method: 'PUT', headers: hdrs(), body: JSON.stringify(body) });
      if (!res.ok) throw new Error((await res.json()).error || tr('productHierarchy.saveFailed'));
      setSnack({ msg: `${editName} updated`, severity: 'success' });
      setCatEditing(false); setSelectedCat(null); await fetchData();
    } catch (e) { setSnack({ msg: (e as Error).message, severity: 'error' }); }
    finally { setSaving(false); }
  };

  const handleCatDelete = async () => {
    if (!selectedCat) return;
    if (!(await ask(tr('productHierarchy.deleteName', { name: selectedCat.name })))) return;
    setSaving(true);
    try {
      const res = await fetch(`${API}/product-categories/${selectedCat.id}`, { method: 'DELETE', headers: hdrs() });
      if (!res.ok) throw new Error((await res.json()).error || tr('productHierarchy.deleteFailed'));
      setSnack({ msg: `${selectedCat.name} deleted`, severity: 'success' });
      setSelectedCat(null); await fetchData();
    } catch (e) { setSnack({ msg: (e as Error).message, severity: 'error' }); }
    finally { setSaving(false); }
  };

  const handleCatCreate = async () => {
    if (!newName.trim() || !newCode.trim()) { setSnack({ msg: tr('productHierarchy.codeAndNameAreRequired'), severity: 'error' }); return; }
    setSaving(true);
    try {
      const res = await fetch(`${API}/product-categories`, { method: 'POST', headers: hdrs(), body: JSON.stringify({ code: newCode.toUpperCase(), name: newName, parent_id: newParent ? parseInt(newParent) : null }) });
      if (!res.ok) throw new Error((await res.json()).error || tr('productHierarchy.createFailed'));
      setSnack({ msg: `${newName} created`, severity: 'success' });
      setCatCreating(false); setNewName(''); setNewCode(''); setNewParent(''); await fetchData();
    } catch (e) { setSnack({ msg: (e as Error).message, severity: 'error' }); }
    finally { setSaving(false); }
  };

  const childCats = selectedCat ? flatCats.filter(c => c.parent_id === selectedCat.id) : [];
  const parentCatName = selectedCat?.parent_id ? flatCats.find(c => c.id === selectedCat.parent_id)?.name : null;
  // All subcategories (for category dropdown in product edit)
  const allSubCats = flatCats.filter(c => c.level > 0);
  const drawerOpen = !!selectedCat || catCreating || !!selectedProduct;

  const startProdEdit = () => {
    if (!selectedProduct) return;
    // Find current category_id from the product's category_name
    const cat = flatCats.find(c => c.name === selectedProduct.category_name);
    setEditProdCategory(cat ? String(cat.id) : '');
    setEditProdLifecycle(selectedProduct.lifecycle_stage || '');
    setProdEditing(true);
  };

  const handleProdSave = async () => {
    if (!selectedProduct) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {};
      const currentCat = flatCats.find(c => c.name === selectedProduct.category_name);
      const newCatId = editProdCategory ? parseInt(editProdCategory) : null;
      if (newCatId !== (currentCat?.id ?? null)) body.category_id = newCatId;
      if (editProdLifecycle !== selectedProduct.lifecycle_stage) body.lifecycle_stage = editProdLifecycle;
      if (Object.keys(body).length === 0) { setProdEditing(false); setSaving(false); return; }
      const res = await fetch(`/api/entities/product/${selectedProduct.id}`, { method: 'PUT', headers: hdrs(), body: JSON.stringify(body) });
      if (!res.ok) throw new Error((await res.json()).error || tr('productHierarchy.saveFailed'));
      setSnack({ msg: `${selectedProduct.name} updated`, severity: 'success' });
      setProdEditing(false); setSelectedProduct(null); await fetchData();
      if (selectedCat) fetchCatProducts(selectedCat.id);
    } catch (e) { setSnack({ msg: (e as Error).message, severity: 'error' }); }
    finally { setSaving(false); }
  };

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;

  // Categories: brand secondary, lightened on dark backgrounds for contrast
  const catColor = isDark ? brand.palette.secondaryLight : brand.palette.secondary;
  const catTreeData = categoryToEcharts(categories, brand.hierarchyRoots?.productCatalog ?? tr('productHierarchy.productCatalog'),
    brand.palette.primary, catColor, focusStage);
  const stageTotals = categories.reduce<Record<string, number>>((acc, c) => {
    for (const [st, n] of Object.entries(c.stages || {})) acc[st] = (acc[st] || 0) + n;
    return acc;
  }, {});
  const stageLabel = (st: string) => tr(`stages.${st}`, { defaultValue: st.replace(/_/g, ' ') });
  const dot = (st: string) => `<span style="display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:6px;${isHollow(st) ? `border:1.5px dashed ${stageColor(st)}` : `background:${stageColor(st)}`}"></span>`;
  // Rich-text styles for the per-stage counts next to each category label
  const stageRich = Object.fromEntries(PRODUCT_STAGES.map((st, i) => [`s${i}`, {
    fontSize: 11, color: stageColor(st), padding: [0, 2],
  }]));
  const chartOption = {
    backgroundColor: 'transparent',
    toolbox: { show: false, feature: { restore: {} } },
    tooltip: {
      trigger: 'item' as const,
      formatter: (params: { name: string; value: number; data: { _stages?: Record<string, number> } }) => {
        let html = `<strong>${params.name}</strong>`;
        const st = params.data?._stages;
        if (!st) return html;
        if (!params.value) return html + `<br/>${tr('productHierarchy.noProductsInThisCategory')}`;
        for (const k of PRODUCT_STAGES) if (st[k]) html += `<br/>${dot(k)}${stageLabel(k)} · ${st[k]}`;
        return html;
      },
      backgroundColor: theme.palette.background.paper,
      borderColor: isDark ? alpha('#fff', 0.1) : alpha(brand.palette.primary, 0.12),
      textStyle: { color: theme.palette.text.primary, fontSize: 12 },
    },
    series: [{
      type: 'tree', data: [catTreeData], layout: 'orthogonal', orient: 'LR',
      left: '8%', right: '30%',
      symbol: 'roundRect', symbolSize: [18, 18], initialTreeDepth: 2,
      animationDurationUpdate: 750, roam: true,
      label: {
        position: 'right', verticalAlign: 'middle', fontSize: 14, color: theme.palette.text.primary,
        // Name, then one colored "■ n" per lifecycle stage present in the category
        formatter: (p: { data: { _stages?: Record<string, number> }; name: string }) => {
          const st = p.data?._stages;
          if (!st) return p.name;
          const parts = PRODUCT_STAGES.map((k, i) => (st[k] && (!focusStage || focusStage === k) ? `{s${i}|${isHollow(k) ? '□' : '■'} ${st[k]}}` : '')).filter(Boolean);
          return parts.length ? `${p.name}  ${parts.join(' ')}` : p.name;
        },
        rich: stageRich,
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
          {categories.length} root categories · {totalProducts} products classified · click label to {canEdit ? 'view/edit' : 'view'}, node to expand
        </Typography>
        {isAdmin && (
          <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={() => { setCatCreating(true); setSelectedCat(null); }}>{tr('productHierarchy.newCategory')}</Button>
        )}
      </Box>

      <Card><CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap', mb: 1, gap: 0.5, alignItems: 'center' }}>
          <Typography variant="caption" sx={{ color: fgMuted, mr: 0.5 }}>{tr('customerHierarchy.legendStage')}</Typography>
          {PRODUCT_STAGES.map(st => {
            const c = stageColor(st);
            const n = stageTotals[st] || 0;
            const on = focusStage === st;
            return (
              <Tooltip key={st} title={tr(on ? 'customerHierarchy.legendShowAll' : 'productHierarchy.legendFocus')}>
                <Chip size="small" clickable onClick={() => setFocusStage(on ? null : st)}
                  icon={<Box sx={{ width: 10, height: 10, borderRadius: '3px', ml: '6px !important', flexShrink: 0,
                    ...(isHollow(st) ? { border: `1.5px dashed ${c}` } : { bgcolor: c }) }} />}
                  label={`${stageLabel(st)} · ${n}`}
                  variant={on ? 'filled' : 'outlined'}
                  sx={{ fontSize: '0.68rem', opacity: n === 0 && !on ? 0.45 : 1,
                    borderColor: on ? c : alpha(c, 0.35), bgcolor: on ? alpha(c, 0.18) : 'transparent', color: theme.palette.text.primary }} />
              </Tooltip>
            );
          })}
          <Tooltip title={tr('productHierarchy.resetZoom')}><IconButton size="small" onClick={resetZoom} sx={{ ml: 1 }}><CenterFocusStrongIcon fontSize="small" /></IconButton></Tooltip>
        </Box>
        <ReactECharts ref={chartRef} option={chartOption} style={{ height: 500 }} opts={{ renderer: 'canvas' }} onEvents={{ click: handleCatClick }} />
      </CardContent></Card>

      <Drawer anchor="right" open={drawerOpen} onClose={() => { setSelectedCat(null); setCatEditing(false); setCatCreating(false); setSelectedProduct(null); }}
        PaperProps={{ sx: { width: { xs: '100%', md: 420 }, bgcolor: theme.palette.background.paper, p: 0 } }}>

        {catCreating && (
          <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <Box sx={{ p: 2.5, borderBottom: `1px solid ${dividerColor}`, display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <AddIcon sx={{ color: brand.palette.accent }} /><Typography variant="h6" sx={{ fontSize: '1rem' }}>{tr('productHierarchy.newCategory')}</Typography>
              <IconButton size="small" sx={{ ml: 'auto' }} onClick={() => setCatCreating(false)}><CloseIcon fontSize="small" /></IconButton>
            </Box>
            <Box sx={{ flex: 1, p: 2.5, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <TextField size="small" label={tr('productHierarchy.code')} value={newCode} onChange={e => setNewCode(e.target.value.toUpperCase())} fullWidth />
              <TextField size="small" label={tr('productHierarchy.name')} value={newName} onChange={e => setNewName(e.target.value)} fullWidth />
              <FormControl size="small" fullWidth><InputLabel>{tr('productHierarchy.parent')}</InputLabel><Select value={newParent} label={tr('productHierarchy.parent')} onChange={e => setNewParent(e.target.value)}><MenuItem value="">{tr('productHierarchy.rootLevel')}</MenuItem>{rootCats.map(c => <MenuItem key={c.id} value={String(c.id)}>{c.name}</MenuItem>)}</Select></FormControl>
            </Box>
            <Box sx={{ p: 2, borderTop: `1px solid ${dividerColor}`, display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
              <Button onClick={() => setCatCreating(false)}>{tr('productHierarchy.cancel')}</Button>
              <Button variant="contained" startIcon={saving ? <CircularProgress size={14} /> : <AddIcon />} onClick={handleCatCreate} disabled={saving}>{tr('productHierarchy.create')}</Button>
            </Box>
          </Box>
        )}

        {selectedProduct && (
          <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <Box sx={{ p: 2.5, borderBottom: `1px solid ${dividerColor}` }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
                <InventoryIcon sx={{ color: statusColors().success }} />
                <Chip label={stageLabel(selectedProduct.lifecycle_stage)} size="small" sx={{ fontSize: '0.6rem', bgcolor: alpha(stageColor(selectedProduct.lifecycle_stage), 0.15), color: stageColor(selectedProduct.lifecycle_stage) }} />
                {selectedProduct.product_type && <Chip label={selectedProduct.product_type} size="small" variant="outlined" sx={{ fontSize: '0.6rem' }} />}
                <IconButton size="small" sx={{ ml: 'auto' }} onClick={() => { setSelectedProduct(null); setProdEditing(false); }}><CloseIcon fontSize="small" /></IconButton>
              </Box>
              <Typography variant="h5" sx={{ fontWeight: 700 }}>{selectedProduct.name}</Typography>
              {selectedProduct.short_desc && <Typography variant="body2" sx={{ color: fgMuted, mt: 0.3 }}>{selectedProduct.short_desc}</Typography>}
            </Box>
            <Box sx={{ flex: 1, overflow: 'auto', p: 2.5 }}>
              {prodEditing ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <FormControl size="small" fullWidth>
                    <InputLabel>{tr('productHierarchy.category')}</InputLabel>
                    <Select value={editProdCategory} label={tr('productHierarchy.category')} onChange={e => setEditProdCategory(e.target.value)}>
                      <MenuItem value="">{tr('productHierarchy.none')}</MenuItem>
                      {allSubCats.map(c => {
                        const parentName = flatCats.find(p => p.id === c.parent_id)?.name;
                        return <MenuItem key={c.id} value={String(c.id)}>{parentName ? `${parentName} > ` : ''}{c.name}</MenuItem>;
                      })}
                    </Select>
                  </FormControl>
                  <FormControl size="small" fullWidth>
                    <InputLabel>{tr('productHierarchy.lifecycleStage')}</InputLabel>
                    <Select value={editProdLifecycle} label={tr('productHierarchy.lifecycleStage')} onChange={e => setEditProdLifecycle(e.target.value)}>
                      {['DRAFT', 'REVIEW', 'VALIDATED', 'PUBLISHED', 'SUSPENDED', 'ARCHIVED'].map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
                    </Select>
                  </FormControl>
                </Box>
              ) : (
                <>
                  <Box sx={{ mt: 1, mb: 2 }}>
                    {([['SKU', selectedProduct.sku], ['EAN', selectedProduct.ean], ['Brand', selectedProduct.brand], ['Manufacturer', selectedProduct.manufacturer], ['Category', selectedProduct.parent_category_name ? `${selectedProduct.parent_category_name} > ${selectedProduct.category_name}` : selectedProduct.category_name], ['Stage', selectedProduct.lifecycle_stage], ['Price', selectedProduct.list_price ? formatMoney(selectedProduct.list_price, selectedProduct.currency_code, brand.defaultCurrency) : undefined], ['Weight', selectedProduct.weight_kg ? `${selectedProduct.weight_kg} kg` : undefined], ['UoM', selectedProduct.unit_of_measure], ['ESG', selectedProduct.esg_rating]] as [string, string | undefined][]).filter(([, v]) => v).map(([l, v]) => (
                      <Box key={l} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.75, borderBottom: `1px solid ${dividerColor}` }}><Typography variant="body2" sx={{ color: fgMuted }}>{l}</Typography><Typography variant="body2" sx={{ fontWeight: 500 }}>{v}</Typography></Box>
                    ))}
                  </Box>
                  {(selectedProduct.dq_score != null || selectedProduct.completeness != null) && (
                    <Box sx={{ display: 'flex', gap: 3, mb: 2 }}>
                      {selectedProduct.dq_score != null && <Box sx={{ textAlign: 'center' }}><Typography variant="caption" sx={{ color: fgMuted }}>{tr('productHierarchy.dqScore')}</Typography><Typography variant="h6" sx={{ fontWeight: 700, color: selectedProduct.dq_score >= 80 ? statusColors().success : selectedProduct.dq_score >= 50 ? statusColors().warning : statusColors().error }}>{selectedProduct.dq_score}%</Typography></Box>}
                      {selectedProduct.completeness != null && <Box sx={{ textAlign: 'center' }}><Typography variant="caption" sx={{ color: fgMuted }}>{tr('productHierarchy.completeness')}</Typography><Typography variant="h6" sx={{ fontWeight: 700, color: selectedProduct.completeness >= 80 ? statusColors().success : selectedProduct.completeness >= 50 ? statusColors().warning : statusColors().error }}>{selectedProduct.completeness}%</Typography></Box>}
                    </Box>
                  )}
                </>
              )}
            </Box>
            <Box sx={{ p: 2, borderTop: `1px solid ${dividerColor}`, display: 'flex', gap: 1 }}>
              {prodEditing ? (
                <><Button onClick={() => setProdEditing(false)} disabled={saving}>{tr('productHierarchy.cancel')}</Button><Button variant="contained" startIcon={saving ? <CircularProgress size={14} /> : <SaveIcon />} onClick={handleProdSave} disabled={saving} sx={{ ml: 'auto' }}>{tr('productHierarchy.save')}</Button></>
              ) : (
                <><Button size="small" startIcon={<OpenInNewIcon />} onClick={() => navigate(`/products/${selectedProduct.id}`)}>{tr('productHierarchy.viewRecord')}</Button>
                {canEdit && <Button variant="contained" size="small" onClick={startProdEdit} sx={{ ml: 'auto' }}>{tr('productHierarchy.edit')}</Button>}</>
              )}
            </Box>
          </Box>
        )}

        {selectedCat && !catCreating && !selectedProduct && (
          <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <Box sx={{ p: 2.5, borderBottom: `1px solid ${dividerColor}` }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
                {selectedCat.level === 0 ? <FolderIcon sx={{ color: catColor }} /> : <CategoryIcon sx={{ color: alpha(catColor, 0.7) }} />}
                <Chip label={selectedCat.level === 0 ? tr('productHierarchy.root2') : 'Sub-category'} size="small" />
                {!selectedCat.is_active && <Chip label="INACTIVE" size="small" color="error" />}
                <IconButton size="small" sx={{ ml: 'auto' }} onClick={() => { setSelectedCat(null); setCatEditing(false); }}><CloseIcon fontSize="small" /></IconButton>
              </Box>
              <Typography variant="h5" sx={{ fontWeight: 700 }}>{selectedCat.name}</Typography>
              <Typography variant="caption" sx={{ color: fgMuted }}>Code: {selectedCat.code}</Typography>
            </Box>
            <Box sx={{ flex: 1, overflow: 'auto', p: 2.5 }}>
              {catEditing ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <TextField size="small" label={tr('productHierarchy.name')} value={editName} onChange={e => setEditName(e.target.value)} fullWidth />
                  <TextField size="small" label={tr('productHierarchy.code')} value={editCode} onChange={e => setEditCode(e.target.value.toUpperCase())} fullWidth />
                  <FormControl size="small" fullWidth><InputLabel>{tr('productHierarchy.parent')}</InputLabel><Select value={editParent} label={tr('productHierarchy.parent')} onChange={e => setEditParent(e.target.value)}><MenuItem value="">{tr('productHierarchy.root')}</MenuItem>{rootCats.filter(c => c.id !== selectedCat.id).map(c => <MenuItem key={c.id} value={String(c.id)}>{c.name}</MenuItem>)}</Select></FormControl>
                  <FormControlLabel control={<Switch checked={editActive} onChange={e => setEditActive(e.target.checked)} />} label={tr('productHierarchy.active')} />
                </Box>
              ) : (
                <>
                  <Box sx={{ mt: 1, mb: 2 }}>
                    {[['Code', selectedCat.code], ['Level', selectedCat.level === 0 ? tr('productHierarchy.root2') : 'Sub-category'], ['Parent', parentCatName || '(root)'], ['Products', `${selectedCat.productCount} assigned`], ['Status', selectedCat.is_active ? tr('productHierarchy.active') : 'Inactive']].map(([l, v]) => (
                      <Box key={l as string} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.75, borderBottom: `1px solid ${dividerColor}` }}><Typography variant="body2" sx={{ color: fgMuted }}>{l}</Typography><Typography variant="body2" sx={{ fontWeight: 500 }}>{v}</Typography></Box>
                    ))}
                  </Box>
                  {childCats.length > 0 && (<><Typography variant="overline" sx={{ color: fgMuted }}>{tr('productHierarchy.subCategoriesLength', { length: childCats.length })}</Typography><Box sx={{ mt: 1 }}>
                    {childCats.map(c => (
                      <Box key={c.id} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.75, borderBottom: `1px solid ${dividerColor}`, cursor: 'pointer', '&:hover': { bgcolor: alpha(fgMuted, 0.04) } }} onClick={() => { setSelectedCat(c); setCatEditing(false); fetchCatProducts(c.id); }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><CategoryIcon sx={{ fontSize: 16, color: fgMuted }} /><Typography variant="body2">{c.name}</Typography></Box>
                        <Chip label={`${c.productCount}`} size="small" sx={{ fontSize: '0.65rem', height: 20 }} />
                      </Box>
                    ))}
                  </Box></>)}
                  {/* Products in this category */}
                  {selectedCat.level > 0 && (
                    <Box sx={{ mt: 2 }}>
                      <Typography variant="overline" sx={{ color: fgMuted }}>{tr('productHierarchy.productsV0', { v0: loadingProducts ? '...' : catProducts.length })}</Typography>
                      {loadingProducts ? <CircularProgress size={20} sx={{ display: 'block', mt: 1 }} /> : catProducts.length > 0 ? (
                        <List dense disablePadding sx={{ mt: 0.5 }}>
                          {catProducts.map(p => (
                            <ListItemButton key={p.id} sx={{ borderBottom: `1px solid ${dividerColor}`, py: 0.5, px: 1, borderRadius: 1 }}
                              onClick={() => setSelectedProduct(p)}>
                              <InventoryIcon sx={{ fontSize: 16, color: fgMuted, mr: 1 }} />
                              <ListItemText primary={p.name} secondary={p.sku} primaryTypographyProps={{ variant: 'body2', fontWeight: 500 }} secondaryTypographyProps={{ variant: 'caption' }} />
                              <Chip label={stageLabel(p.lifecycle_stage)} size="small" sx={{ fontSize: '0.6rem', height: 18, ml: 1, bgcolor: alpha(stageColor(p.lifecycle_stage), 0.15), color: stageColor(p.lifecycle_stage) }} />
                            </ListItemButton>
                          ))}
                        </List>
                      ) : <Typography variant="caption" sx={{ color: fgMuted, mt: 0.5, display: 'block' }}>{tr('productHierarchy.noProductsInThisCategory')}</Typography>}
                    </Box>
                  )}
                </>
              )}
            </Box>
            <Box sx={{ p: 2, borderTop: `1px solid ${dividerColor}`, display: 'flex', gap: 1 }}>
              {catEditing ? (<><Button onClick={() => setCatEditing(false)} disabled={saving}>{tr('productHierarchy.cancel')}</Button><Button variant="contained" startIcon={saving ? <CircularProgress size={14} /> : <SaveIcon />} onClick={handleCatSave} disabled={saving} sx={{ ml: 'auto' }}>{tr('productHierarchy.save')}</Button></>) : isAdmin ? (<><Tooltip title={selectedCat.productCount > 0 || childCats.length > 0 ? tr('productHierarchy.hasProductsOrSubCategories') : 'Delete'}><span><Button color="error" size="small" startIcon={<DeleteIcon />} onClick={handleCatDelete} disabled={saving || selectedCat.productCount > 0 || childCats.length > 0}>{tr('productHierarchy.delete')}</Button></span></Tooltip><Button variant="contained" size="small" onClick={startCatEdit} sx={{ ml: 'auto' }}>{tr('productHierarchy.edit')}</Button></>) : null}
            </Box>
          </Box>
        )}
      </Drawer>
    </Box>
  );
}
