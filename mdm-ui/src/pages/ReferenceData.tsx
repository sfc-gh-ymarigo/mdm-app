import { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Card, CardContent, List, ListItemButton, ListItemText,
  Table, TableHead, TableRow, TableCell, TableBody, Chip, IconButton,
  TextField, Button, Dialog, DialogTitle, DialogContent, DialogActions,
  Switch, FormControlLabel, alpha, useTheme, Tooltip, CircularProgress,
  InputAdornment,
} from '@mui/material';
import { useUser } from '../context/UserContext';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import SearchIcon from '@mui/icons-material/Search';
import LockIcon from '@mui/icons-material/Lock';
import { useBrand } from '../config/BrandContext';
import { useAsk } from '../components/common/Confirm';
import { tr } from '../i18n';

import { seriesColor } from '../theme/brandColors';
type Domain = { domain: string; type: string; total: number; active: number; description?: string; editable: boolean };
type CodelistValue = { id?: number; code: string; label: string; description?: string; metadata?: any; sort_order?: number; is_active?: boolean; region?: string; symbol?: string; entity_type?: string; is_terminal?: boolean };

const DOMAIN_LABELS: Record<string, string> = {
  COUNTRY: tr('referenceData.countries'), CURRENCY: tr('referenceData.currencies'), LANGUAGE: tr('referenceData.languages'),
  CUSTOMER_TYPE: tr('referenceData.customerTypes'), SEGMENT: tr('referenceData.segments'), INDUSTRY_CODE: tr('referenceData.industryCodes'),
  PRODUCT_TYPE: tr('referenceData.productTypes'), UNIT_OF_MEASURE: tr('referenceData.unitsOfMeasure'), ESG_RATING: tr('referenceData.esgRatings'),
  LIFECYCLE_STAGE: tr('referenceData.lifecycleStages'),
};

function domainLabel(d: string) { return DOMAIN_LABELS[d] || d.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); }

function typeColor(t: string) {
  if (t === 'builtin') return seriesColor(0);
  if (t === 'system') return seriesColor(1);
  return seriesColor(5);
}

export default function ReferenceData() {
  const ask = useAsk();
  const theme = useTheme();
  const { palette: p } = useBrand();
  const fgMuted = theme.palette.text.secondary;

  const [domains, setDomains] = useState<Domain[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [values, setValues] = useState<CodelistValue[]>([]);
  const [loading, setLoading] = useState(false);
  const [valLoading, setValLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [editItem, setEditItem] = useState<Partial<CodelistValue> & { isNew?: boolean }>({});
  const [domainType, setDomainType] = useState<string>('codelist');
  const [newDomainOpen, setNewDomainOpen] = useState(false);
  const [newDomainName, setNewDomainName] = useState('');

  const fetchDomains = useCallback(async () => {
    setLoading(true);
    const r = await fetch('/api/refdata');
    const data: Domain[] = await r.json();
    setDomains(data);
    setLoading(false);
    if (!selected && data.length > 0) { setSelected(data[0].domain); setDomainType(data[0].type); }
  }, []);

  const fetchValues = useCallback(async (domain: string) => {
    setValLoading(true);
    const r = await fetch(`/api/refdata/${domain}`);
    const data = await r.json();
    setValues(data.values || []);
    setDomainType(data.type);
    setValLoading(false);
  }, []);

  useEffect(() => { fetchDomains(); }, [fetchDomains]);
  useEffect(() => { if (selected) fetchValues(selected); }, [selected, fetchValues]);

  const selectedMeta = domains.find(d => d.domain === selected);
  const { isAdmin } = useUser();
  // Reference data is global: only administrators edit it
  const editable = isAdmin && selectedMeta?.editable !== false;

  const filteredValues = values.filter(v => {
    if (!search) return true;
    const s = search.toLowerCase();
    return v.code.toLowerCase().includes(s) || v.label.toLowerCase().includes(s) || (v.description || '').toLowerCase().includes(s);
  });

  const handleSave = async () => {
    if (!selected || !editItem.code || !editItem.label) return;
    const body: any = { code: editItem.code, label: editItem.label, description: editItem.description || '', sort_order: editItem.sort_order || 0, is_active: editItem.is_active !== false };
    if (editItem.region !== undefined) body.region = editItem.region;
    if (editItem.symbol !== undefined) body.symbol = editItem.symbol;
    if (editItem.metadata) body.metadata = editItem.metadata;

    if (editItem.isNew) {
      await fetch(`/api/refdata/${selected}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } else {
      await fetch(`/api/refdata/${selected}/${editItem.code}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    }
    setEditOpen(false);
    fetchValues(selected);
    fetchDomains();
  };

  const handleDelete = async (code: string) => {
    if (!selected) return;
    if (!(await ask(tr('referenceData.deleteCodeFromV1', { code, v1: domainLabel(selected) })))) return;
    await fetch(`/api/refdata/${selected}/${code}`, { method: 'DELETE' });
    fetchValues(selected);
    fetchDomains();
  };

  const handleNewDomain = async () => {
    if (!newDomainName.trim()) return;
    const r = await fetch('/api/refdata', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ domain: newDomainName }) });
    const data = await r.json();
    if (r.ok) {
      setNewDomainOpen(false);
      setNewDomainName('');
      setSelected(data.domain);
      fetchDomains();
    }
  };

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" gutterBottom>{tr('referenceData.referenceData')}</Typography>
        <Typography variant="subtitle1">{tr('referenceData.manageCodeListsLookupTables')}</Typography>
      </Box>

      <Box sx={{ display: 'flex', gap: 2, height: 'calc(100vh - 180px)' }}>
        {/* Left panel: domain list */}
        <Card sx={{ width: 230, minWidth: 230, display: 'flex', flexDirection: 'column' }}>
          <CardContent sx={{ pb: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{tr('referenceData.domains')}</Typography>
            {isAdmin && <Tooltip title={tr('referenceData.createNewDomain')}>
              <IconButton size="small" onClick={() => setNewDomainOpen(true)}><AddIcon fontSize="small" /></IconButton>
            </Tooltip>}
          </CardContent>
          <Box sx={{ overflow: 'auto', flex: 1 }}>
            {loading ? <Box sx={{ textAlign: 'center', py: 4 }}><CircularProgress size={24} /></Box> : (
              <List dense disablePadding>
                {domains.map(d => (
                  <ListItemButton
                    key={d.domain}
                    selected={selected === d.domain}
                    onClick={() => setSelected(d.domain)}
                    sx={{ borderLeft: selected === d.domain ? `3px solid ${p.primary}` : '3px solid transparent', py: 1 }}
                  >
                    <ListItemText
                      primary={<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Typography variant="body2" sx={{ fontWeight: selected === d.domain ? 700 : 400 }}>{domainLabel(d.domain)}</Typography>
                        {!d.editable && <LockIcon sx={{ fontSize: 12, color: fgMuted }} />}
                      </Box>}
                      secondary={<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25 }}>
                        <Chip label={d.type} size="small" sx={{ height: 16, fontSize: '0.6rem', bgcolor: alpha(typeColor(d.type), 0.15), color: typeColor(d.type) }} />
                        <Typography variant="caption" sx={{ color: fgMuted }}>{d.total} values</Typography>
                      </Box>}
                    />
                  </ListItemButton>
                ))}
              </List>
            )}
          </Box>
        </Card>

        {/* Right panel: values */}
        <Card sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {selected ? (<>
            <CardContent sx={{ pb: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
              <Box>
                <Typography variant="h6" sx={{ fontWeight: 700 }}>{domainLabel(selected)}</Typography>
                <Typography variant="caption" sx={{ color: fgMuted }}>{selectedMeta?.description || `${values.length} values`}</Typography>
              </Box>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <TextField size="small" placeholder={tr('referenceData.search')} value={search} onChange={e => setSearch(e.target.value)}
                  InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
                  sx={{ width: 160 }} />
                {editable && <Button size="small" variant="contained" startIcon={<AddIcon />}
                  onClick={() => { setEditItem({ isNew: true, code: '', label: '', description: '', sort_order: (values.length + 1) * 10, is_active: true }); setEditOpen(true); }}>
                  {tr('referenceData.add')}
                </Button>}
              </Box>
            </CardContent>
            <Box sx={{ overflow: 'auto', flex: 1 }}>
              {valLoading ? <Box sx={{ textAlign: 'center', py: 4 }}><CircularProgress size={24} /></Box> : (
                <Table size="small" stickyHeader sx={{ tableLayout: 'fixed' }}>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 700, width: '20%' }}>{tr('referenceData.code')}</TableCell>
                      <TableCell sx={{ fontWeight: 700, width: domainType === 'codelist' ? '35%' : '45%' }}>{tr('referenceData.label')}</TableCell>
                      {domainType === 'builtin' && selected === 'COUNTRY' && <TableCell sx={{ fontWeight: 700, width: '20%' }}>{tr('referenceData.region')}</TableCell>}
                      {domainType === 'builtin' && selected === 'CURRENCY' && <TableCell sx={{ fontWeight: 700, width: '15%' }}>{tr('referenceData.symbol')}</TableCell>}
                      {domainType === 'system' && <TableCell sx={{ fontWeight: 700, width: '15%' }}>{tr('referenceData.entity')}</TableCell>}
                      {domainType === 'codelist' && <TableCell sx={{ fontWeight: 700, textAlign: 'center', width: '15%' }}>{tr('referenceData.status')}</TableCell>}
                      {editable && <TableCell sx={{ fontWeight: 700, textAlign: 'center', width: '15%' }}>{tr('referenceData.actions')}</TableCell>}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {filteredValues.map(v => (
                      <TableRow key={v.code + (v.entity_type || '')} hover sx={{ opacity: v.is_active === false ? 0.5 : 1 }}>
                        <TableCell><Typography variant="body2" noWrap sx={{ fontFamily: 'monospace', fontWeight: 600, fontSize: '0.75rem' }}>{v.code}</Typography></TableCell>
                        <TableCell>
                          <Typography variant="body2" noWrap>{v.label}</Typography>
                          {v.description && <Typography variant="caption" noWrap sx={{ color: fgMuted, display: 'block' }}>{v.description}</Typography>}
                        </TableCell>
                        {domainType === 'builtin' && selected === 'COUNTRY' && <TableCell><Chip label={v.region || '—'} size="small" variant="outlined" /></TableCell>}
                        {domainType === 'builtin' && selected === 'CURRENCY' && <TableCell>{v.symbol}</TableCell>}
                        {domainType === 'system' && <TableCell><Chip label={v.entity_type} size="small" sx={{ fontSize: '0.7rem' }} /></TableCell>}
                        {domainType === 'codelist' && <TableCell sx={{ textAlign: 'center' }}><Chip label={v.is_active ? tr('referenceData.active') : 'Inactive'} size="small" color={v.is_active ? 'success' : 'default'} sx={{ fontSize: '0.7rem' }} /></TableCell>}
                        {editable && <TableCell sx={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                          <IconButton size="small" onClick={() => { setEditItem({ ...v }); setEditOpen(true); }}><EditIcon fontSize="small" /></IconButton>
                          <IconButton size="small" color="error" onClick={() => handleDelete(v.code)}><DeleteIcon fontSize="small" /></IconButton>
                        </TableCell>}
                      </TableRow>
                    ))}
                    {filteredValues.length === 0 && (
                      <TableRow><TableCell colSpan={6} sx={{ textAlign: 'center', py: 4, color: fgMuted }}>
                        {search ? tr('referenceData.noMatchingValues') : 'No values in this domain yet. Click Add to create one.'}
                      </TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </Box>
          </>) : (
            <CardContent sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
              <Typography sx={{ color: fgMuted }}>{tr('referenceData.selectADomainFromThe')}</Typography>
            </CardContent>
          )}
        </Card>
      </Box>

      {/* Edit/Add dialog */}
      <Dialog open={editOpen} onClose={() => setEditOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editItem.isNew ? tr('referenceData.addValue') : 'Edit Value'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '16px !important' }}>
          <TextField label={tr('referenceData.code')} value={editItem.code || ''} onChange={e => setEditItem(prev => ({ ...prev, code: e.target.value.toUpperCase() }))}
            disabled={!editItem.isNew} fullWidth size="small" />
          <TextField label={tr('referenceData.label')} value={editItem.label || ''} onChange={e => setEditItem(prev => ({ ...prev, label: e.target.value }))} fullWidth size="small" />
          <TextField label={tr('referenceData.description')} value={editItem.description || ''} onChange={e => setEditItem(prev => ({ ...prev, description: e.target.value }))}
            fullWidth size="small" multiline rows={2} />
          {domainType === 'builtin' && selected === 'COUNTRY' && (
            <TextField label={tr('referenceData.region')} value={editItem.region || ''} onChange={e => setEditItem(prev => ({ ...prev, region: e.target.value }))} fullWidth size="small" />
          )}
          {domainType === 'builtin' && selected === 'CURRENCY' && (
            <TextField label={tr('referenceData.symbol')} value={editItem.symbol || ''} onChange={e => setEditItem(prev => ({ ...prev, symbol: e.target.value }))} fullWidth size="small" />
          )}
          {domainType === 'codelist' && (
            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField label={tr('referenceData.sortOrder')} type="number" value={editItem.sort_order || 0} onChange={e => setEditItem(prev => ({ ...prev, sort_order: Number(e.target.value) }))} size="small" sx={{ width: 120 }} />
              <FormControlLabel control={<Switch checked={editItem.is_active !== false} onChange={e => setEditItem(prev => ({ ...prev, is_active: e.target.checked }))} />} label={tr('referenceData.active')} />
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditOpen(false)}>{tr('referenceData.cancel')}</Button>
          <Button variant="contained" onClick={handleSave} disabled={!editItem.code || !editItem.label}>{tr('referenceData.save')}</Button>
        </DialogActions>
      </Dialog>

      {/* New Domain dialog */}
      <Dialog open={newDomainOpen} onClose={() => setNewDomainOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{tr('referenceData.createNewDomain2')}</DialogTitle>
        <DialogContent sx={{ pt: '16px !important' }}>
          <TextField label={tr('referenceData.domainName')} value={newDomainName} onChange={e => setNewDomainName(e.target.value)}
            fullWidth size="small" helperText={tr('referenceData.eGPaymentTermsDelivery')} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNewDomainOpen(false)}>{tr('referenceData.cancel')}</Button>
          <Button variant="contained" onClick={handleNewDomain} disabled={!newDomainName.trim()}>{tr('referenceData.create')}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
