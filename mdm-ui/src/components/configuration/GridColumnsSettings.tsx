// Records grid columns of one module: which fields are shown and in which order.
// Name, source, stage, DQ score and completeness are always shown by the grid.
import { useEffect, useState } from 'react';
import { Box, Button, Card, CardContent, Chip, IconButton, List, ListItem, ListItemText, MenuItem, TextField, Tooltip, Typography, alpha, useTheme } from '@mui/material';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import CloseIcon from '@mui/icons-material/Close';
import { BRAND_CONFIG_CHANGED } from '../../config/BrandContext';
import { getCurrentUserEmail } from '../../context/UserContext';
import { useToast } from '../common/Toast';
import { tr } from '../../i18n';

type Field = { name: string; label: string; type: string; group: string };
const headers = () => ({ 'Content-Type': 'application/json', 'x-mdm-user': getCurrentUserEmail() });

export default function GridColumnsSettings({ moduleId }: { moduleId: string }) {
  const theme = useTheme();
  const toast = useToast();
  const [available, setAvailable] = useState<Field[]>([]);
  const [saved, setSaved] = useState<string[]>([]);
  const [cols, setCols] = useState<string[]>([]);
  const [customized, setCustomized] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/admin/modules/${moduleId}/list-columns`, { headers: headers() })
      .then(r => r.json())
      .then(d => { setAvailable(d.available || []); setSaved(d.columns || []); setCols(d.columns || []); setCustomized(!!d.customized); })
      .catch(() => toast(tr('gridColumns.loadFailed'), 'error'));
  }, [moduleId]); // eslint-disable-line react-hooks/exhaustive-deps

  const byName = new Map(available.map(f => [f.name, f]));
  const dirty = cols.join() !== saved.join();
  const move = (i: number, d: number) => setCols(c => { const n = [...c]; [n[i], n[i + d]] = [n[i + d], n[i]]; return n; });

  const save = async (columns: string[] | null) => {
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/modules/${moduleId}/list-columns`, { method: 'PUT', headers: headers(), body: JSON.stringify({ columns }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setSaved(d.columns); setCols(d.columns); setCustomized(d.customized);
      window.dispatchEvent(new Event(BRAND_CONFIG_CHANGED));
      toast(columns ? tr('gridColumns.saved') : tr('gridColumns.reset'), 'success');
    } catch (e) { toast((e as Error).message, 'error'); }
    setBusy(false);
  };

  const fixedChip = (label: string) => <Chip key={label} label={label} size="small" variant="outlined" sx={{ fontSize: '0.7rem' }} />;

  return (
    <Card><CardContent>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
        <Typography variant="h6" sx={{ fontSize: '0.95rem' }}>{tr('gridColumns.title')}</Typography>
        <Chip size="small" label={customized ? tr('gridColumns.custom') : tr('gridColumns.default')}
          sx={{ fontSize: '0.65rem', height: 20, bgcolor: alpha(theme.palette.primary.main, customized ? 0.15 : 0.05) }} />
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{tr('gridColumns.help')}</Typography>

      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.75, mb: 2 }}>
        <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>{tr('gridColumns.alwaysShown')}</Typography>
        {[tr('gridColumns.name'), tr('list.source'), tr('list.stage'), tr('record.dqScore'), tr('record.completeness')].map(fixedChip)}
      </Box>

      {cols.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{tr('gridColumns.none')}</Typography>
      ) : (
        <List dense disablePadding sx={{ mb: 2, maxWidth: 520, border: `1px solid ${theme.palette.divider}`, borderRadius: 1 }}>
          {cols.map((n, i) => (
            <ListItem key={n} divider={i < cols.length - 1}
              secondaryAction={<Box>
                <Tooltip title={tr('gridColumns.up')}><span><IconButton size="small" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUpwardIcon fontSize="small" /></IconButton></span></Tooltip>
                <Tooltip title={tr('gridColumns.down')}><span><IconButton size="small" disabled={i === cols.length - 1} onClick={() => move(i, 1)}><ArrowDownwardIcon fontSize="small" /></IconButton></span></Tooltip>
                <Tooltip title={tr('gridColumns.remove')}><IconButton size="small" onClick={() => setCols(c => c.filter(x => x !== n))}><CloseIcon fontSize="small" /></IconButton></Tooltip>
              </Box>}>
              <Typography variant="caption" color="text.secondary" sx={{ width: 24 }}>{i + 1}</Typography>
              <ListItemText primary={byName.get(n)?.label || n} secondary={`${n} · ${byName.get(n)?.group ?? ''}`}
                primaryTypographyProps={{ fontSize: '0.85rem' }} secondaryTypographyProps={{ fontSize: '0.7rem' }} />
            </ListItem>
          ))}
        </List>
      )}

      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.5 }}>
        <TextField select size="small" label={tr('gridColumns.add')} value="" sx={{ minWidth: 260 }}
          onChange={e => setCols(c => [...c, e.target.value])}>
          {available.filter(f => !cols.includes(f.name)).map(f => (
            <MenuItem key={f.name} value={f.name}>{f.label} <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>{f.group}</Typography></MenuItem>
          ))}
        </TextField>
        <Button variant="contained" disabled={!dirty || busy} onClick={() => save(cols)}>{tr('common.save')}</Button>
        <Button disabled={!dirty || busy} onClick={() => setCols(saved)}>{tr('gridColumns.cancel')}</Button>
        <Button color="inherit" disabled={!customized || busy} onClick={() => save(null)}>{tr('gridColumns.restoreDefault')}</Button>
      </Box>
    </CardContent></Card>
  );
}
