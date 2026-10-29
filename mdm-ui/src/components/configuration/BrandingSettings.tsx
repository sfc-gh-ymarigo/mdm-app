import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box, Card, CardContent, Typography, TextField, Button, Stack, Alert, Snackbar, Chip, Divider,
  ToggleButton, ToggleButtonGroup, CircularProgress, IconButton, Tooltip, MenuItem,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import { ThemeProvider, alpha, useTheme } from '@mui/material/styles';
import UploadIcon from '@mui/icons-material/Upload';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import DashboardIcon from '@mui/icons-material/Dashboard';
import PeopleIcon from '@mui/icons-material/People';
import InventoryIcon from '@mui/icons-material/Inventory2';
import { BRAND_CONFIG_CHANGED, type BrandPalette } from '../../config/BrandContext';
import { getCurrentUserEmail } from '../../context/UserContext';
import { createDarkTheme, createLightTheme } from '../../theme/theme';
import { useUnsavedGuard } from '../common/useUnsavedGuard';
import { useAsk } from '../common/Confirm';
import { chartSeries, DEFAULT_CHARTS, DEFAULT_STATUS, DEFAULT_WORKFLOW_TYPES, DEFAULT_MATCH_METHODS, WORKFLOW_TYPES, MATCH_METHODS, DEFAULT_TYPOGRAPHY, FONT_STACKS,
  type StatusColors, type ChartsConfig, type TypographyConfig, type FontKey } from '../../theme/brandColors';
import { tr } from '../../i18n';
import { PALETTE_PRESETS, presetColors, presetSwatches, type PalettePreset } from '../../theme/palettePresets';

interface Branding {
  name: string;
  fullName: string;
  tagline: string;
  logo: string;
  palette: BrandPalette;
  darkBackground: { default: string; paper: string; card: string; sidebarGradient: string };
  lightBackground: { sidebarGradient: string };
  status: StatusColors;
  workflowTypes: Record<string, string>;
  matchMethods: Record<string, string>;
  charts: ChartsConfig;
  typography: TypographyConfig;
}
const STATUS_KEYS: (keyof StatusColors)[] = ['success', 'warning', 'error', 'info', 'neutral'];
const FONT_KEYS: FontKey[] = ['texta', 'system', 'serif'];
const MAX_CHART_COLORS = 24;
// API responses predating these blocks get the defaults
const complete = (b: Branding): Branding => ({
  ...b,
  status: { ...DEFAULT_STATUS, ...b.status },
  workflowTypes: { ...DEFAULT_WORKFLOW_TYPES, ...b.workflowTypes },
  matchMethods: { ...DEFAULT_MATCH_METHODS, ...b.matchMethods },
  charts: { ...DEFAULT_CHARTS, ...b.charts },
  typography: { ...DEFAULT_TYPOGRAPHY, ...b.typography, dark: { ...DEFAULT_TYPOGRAPHY.dark, ...b.typography?.dark }, light: { ...DEFAULT_TYPOGRAPHY.light, ...b.typography?.light } },
});

const PALETTE_KEYS: (keyof BrandPalette)[] = ['primary', 'primaryLight', 'primaryDark', 'secondary', 'secondaryLight', 'secondaryDark', 'accent'];
const DARK_KEYS = ['default', 'paper', 'card'] as const;
const HEX_RE = /^#[0-9A-Fa-f]{6}$/;
const MAX_LOGO_BYTES = 200_000;

const headers = () => ({ 'Content-Type': 'application/json', 'x-mdm-user': getCurrentUserEmail() });
const gradient = (a: string, b: string) => `linear-gradient(180deg, ${a} 0%, ${b} 100%)`;
// Sidebar gradients follow the colors they are built from
const withGradients = (b: Branding): Branding => ({
  ...b,
  darkBackground: { ...b.darkBackground, sidebarGradient: gradient(b.darkBackground.paper, b.darkBackground.default) },
  lightBackground: { sidebarGradient: gradient(b.palette.secondary, b.palette.secondaryDark) },
});
export const logoSrc = (logo?: string) => (!logo || logo === 'snowflake-logo.svg' ? '' : /^(https:|data:)/.test(logo) ? logo : `/logos/${logo}`);

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const valid = HEX_RE.test(value);
  return (
    <Stack direction="row" spacing={1} alignItems="center">
      <Box component="input" type="color" value={valid ? value : '#000000'} onChange={e => onChange(e.target.value.toUpperCase())}
        sx={{ width: 36, height: 36, p: 0, border: 'none', borderRadius: 1, cursor: 'pointer', bgcolor: 'transparent' }} />
      <TextField size="small" label={label} value={value} error={!valid} onChange={e => onChange(e.target.value.trim())} sx={{ flex: 1 }} />
    </Stack>
  );
}

function Preview({ b, mode }: { b: Branding; mode: 'dark' | 'light' }) {
  const theme = useMemo(() => {
    const opts = { status: b.status, typography: b.typography };
    return mode === 'dark'
      ? createDarkTheme(b.palette, { darkBackground: b.darkBackground, ...opts })
      : createLightTheme(b.palette, opts);
  }, [b, mode]);
  const series = chartSeries(b.charts, b.charts.mode === 'monochrome' ? 8 : b.charts.colors.length);
  const p = b.palette;
  const sidebar = mode === 'dark' ? b.darkBackground.sidebarGradient : b.lightBackground.sidebarGradient;
  const src = logoSrc(b.logo);
  return (
    <ThemeProvider theme={theme}>
      <Box sx={{ display: 'flex', height: 340, borderRadius: 2, overflow: 'hidden', border: `1px solid ${theme.palette.divider}`, bgcolor: 'background.default' }}>
        <Box sx={{ width: 150, background: sidebar, p: 1.5, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <Box sx={{ height: 32, display: 'flex', alignItems: 'center', mb: 1 }}>
            {src
              ? <Box component="img" src={src} alt="" sx={{ maxHeight: 26, maxWidth: 120 }} />
              : <Box component="img" src="/logos/snowflake.png" alt="" sx={{ height: 26, opacity: 0.35 }} />}
          </Box>
          {[{ icon: <DashboardIcon fontSize="small" />, l: 'Dashboard', a: true }, { icon: <PeopleIcon fontSize="small" />, l: 'Customers' }, { icon: <InventoryIcon fontSize="small" />, l: 'Products' }].map(i => (
            <Box key={i.l} sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1, py: 0.5, borderRadius: 1.5, fontSize: '0.75rem',
              color: i.a ? p.primary : alpha('#fff', 0.6), bgcolor: i.a ? alpha(p.primary, 0.12) : 'transparent' }}>
              {i.icon}{i.l}
            </Box>
          ))}
        </Box>
        <Box sx={{ flex: 1, p: 2, color: 'text.primary' }}>
          <Typography variant="h6" sx={{ lineHeight: 1.2 }}>{b.fullName || b.name}</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>{b.tagline}</Typography>
          <Stack direction="row" spacing={1.5} sx={{ my: 1.5 }}>
            {[{ v: '1 284', c: p.primary }, { v: '92%', c: p.accent }, { v: '37', c: p.secondary }].map((k, i) => (
              <Card key={i} sx={{ flex: 1, borderLeft: `3px solid ${k.c}` }}><CardContent sx={{ py: 1, '&:last-child': { pb: 1 } }}>
                <Typography variant="h6" sx={{ color: k.c, fontWeight: 700 }}>{k.v}</Typography>
              </CardContent></Card>
            ))}
          </Stack>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Button size="small" variant="contained">{tr('branding.previewPrimary')}</Button>
            <Button size="small" variant="outlined" color="secondary">{tr('branding.previewSecondary')}</Button>
            {STATUS_KEYS.map(k => (
              <Chip key={k} size="small" label={k.toUpperCase()} sx={{ bgcolor: alpha(b.status[k], 0.15), color: b.status[k], fontWeight: 600 }} />
            ))}
          </Stack>
          <Typography variant="body2" sx={{ mt: 1.5 }}>{tr('branding.previewBody')}</Typography>
          <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 0.5, height: 64, mt: 1.5 }}>
            {series.map((c, i) => (
              <Box key={i} sx={{ flex: 1, bgcolor: c, borderRadius: '4px 4px 0 0', height: `${30 + ((i * 37) % 70)}%` }} />
            ))}
          </Box>
        </Box>
      </Box>
    </ThemeProvider>
  );
}

export default function BrandingSettings() {
  const theme = useTheme();
  const ask = useAsk();
  const [saved, setSaved] = useState<Branding | null>(null);
  const [draft, setDraft] = useState<Branding | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'dark' | 'light'>(theme.palette.mode);
  const [snack, setSnack] = useState<{ msg: string; severity: 'success' | 'error' } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/admin/branding', { headers: headers() }).then(r => r.json()).then(d => { setSaved(complete(d.branding)); setDraft(complete(d.branding)); });
  }, []);

  const dirty = !!saved && !!draft && JSON.stringify(saved) !== JSON.stringify(draft);
  useUnsavedGuard(dirty);
  const invalid = !!draft && (
    [...PALETTE_KEYS.map(k => draft.palette[k]), ...DARK_KEYS.map(k => draft.darkBackground[k]),
      ...STATUS_KEYS.map(k => draft.status[k]), ...Object.values(draft.workflowTypes), ...Object.values(draft.matchMethods), ...draft.charts.colors, draft.charts.base,
      draft.typography.dark.primary, draft.typography.dark.secondary, draft.typography.light.primary, draft.typography.light.secondary,
    ].some(v => !HEX_RE.test(v))
    || !draft.name.trim() || !draft.fullName.trim() || !draft.tagline.trim());

  if (!draft) return <Box sx={{ p: 4, textAlign: 'center' }}><CircularProgress size={28} /></Box>;

  const set = (patch: Partial<Branding>) => setDraft(d => withGradients({ ...d!, ...patch }));
  // Fills palette, backgrounds and chart series; identity, logo, status and typography are kept
  const applyPreset = (p: PalettePreset) => {
    const c = presetColors(p);
    set({ palette: { ...c.palette }, darkBackground: { ...c.darkBackground, sidebarGradient: '' }, charts: { ...c.charts, colors: [...c.charts.colors] } });
  };
  const setPalette = (k: keyof BrandPalette, v: string) => set({ palette: { ...draft.palette, [k]: v } });
  const setDark = (k: typeof DARK_KEYS[number], v: string) => set({ darkBackground: { ...draft.darkBackground, [k]: v } });
  const setStatus = (k: keyof StatusColors, v: string) => set({ status: { ...draft.status, [k]: v } });
  const setMap = (group: 'workflowTypes' | 'matchMethods', k: string, v: string) => set({ [group]: { ...draft[group], [k]: v } });
  const setCharts = (patch: Partial<ChartsConfig>) => set({ charts: { ...draft.charts, ...patch } });
  const setChartColor = (i: number, v: string) => setCharts({ colors: draft.charts.colors.map((c, j) => (j === i ? v : c)) });
  const setText = (m: 'dark' | 'light', k: 'primary' | 'secondary', v: string) =>
    set({ typography: { ...draft.typography, [m]: { ...draft.typography[m], [k]: v } } });

  const request = async (url: string, init: RequestInit, okMsg: string) => {
    setBusy(true);
    try {
      const r = await fetch(url, { headers: headers(), ...init });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { setSnack({ msg: body.error || `Request failed (${r.status})`, severity: 'error' }); return; }
      setSaved(complete(body.branding)); setDraft(complete(body.branding));
      window.dispatchEvent(new Event(BRAND_CONFIG_CHANGED));
      setSnack({ msg: okMsg, severity: 'success' });
    } catch {
      setSnack({ msg: tr('configuration.networkErrorIsTheApi'), severity: 'error' });
    } finally { setBusy(false); }
  };
  const save = () => request('/api/admin/branding', { method: 'PUT', body: JSON.stringify(draft) }, tr('branding.saved'));
  const reset = async () => {
    if (await ask(tr('branding.resetConfirm'))) request('/api/admin/branding/reset', { method: 'POST' }, tr('branding.resetDone'));
  };

  const onFile = (f: File | undefined) => {
    if (!f) return;
    if (!/^image\/(png|svg\+xml)$/.test(f.type)) { setSnack({ msg: tr('branding.logoType'), severity: 'error' }); return; }
    if (f.size > MAX_LOGO_BYTES) { setSnack({ msg: tr('branding.logoTooLarge'), severity: 'error' }); return; }
    const reader = new FileReader();
    reader.onload = () => set({ logo: String(reader.result) });
    reader.readAsDataURL(f);
  };
  const src = logoSrc(draft.logo);
  const logoIsUrl = /^https:/.test(draft.logo);

  return (
    <Box>
      <Typography variant="h5" gutterBottom>{tr('branding.title')}</Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>{tr('branding.subtitle')}</Typography>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'minmax(0,1fr) minmax(0,1fr)' }, gap: 3, alignItems: 'start' }}>
        <Stack spacing={3}>
          <Card><CardContent>
            <Typography variant="subtitle2" gutterBottom>{tr('branding.identity')}</Typography>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField size="small" label={tr('branding.name')} value={draft.name} onChange={e => set({ name: e.target.value })} inputProps={{ maxLength: 40 }} />
              <TextField size="small" label={tr('branding.fullName')} value={draft.fullName} onChange={e => set({ fullName: e.target.value })} inputProps={{ maxLength: 80 }} />
              <TextField size="small" label={tr('branding.tagline')} value={draft.tagline} onChange={e => set({ tagline: e.target.value })} inputProps={{ maxLength: 160 }} />
            </Stack>
          </CardContent></Card>

          <Card><CardContent>
            <Typography variant="subtitle2" gutterBottom>{tr('branding.logo')}</Typography>
            <Stack direction="row" spacing={2} alignItems="center" sx={{ mt: 1 }}>
              <Box sx={{ width: 140, height: 56, borderRadius: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: alpha(theme.palette.text.primary, 0.05) }}>
                {src
                  ? <Box component="img" src={src} alt="" sx={{ maxHeight: 44, maxWidth: 124 }} />
                  : <Box component="img" src="/logos/snowflake.png" alt="" sx={{ height: 36, opacity: 0.35 }} />}
              </Box>
              <Stack spacing={1}>
                <Button size="small" variant="outlined" startIcon={<UploadIcon />} onClick={() => fileRef.current?.click()}>{tr('branding.uploadLogo')}</Button>
                <Button size="small" onClick={() => set({ logo: '' })} disabled={!draft.logo}>{tr('branding.useFlake')}</Button>
              </Stack>
              <input ref={fileRef} type="file" accept="image/png,image/svg+xml" hidden onChange={e => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
            </Stack>
            <TextField size="small" fullWidth sx={{ mt: 2 }} label={tr('branding.logoUrl')} placeholder="https://…"
              value={logoIsUrl ? draft.logo : ''} onChange={e => set({ logo: e.target.value.trim() })}
              helperText={tr('branding.logoHelp')} />
          </CardContent></Card>

          <Card><CardContent>
            <Typography variant="subtitle2" gutterBottom>{tr('branding.presets')}</Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1.5 }}>{tr('branding.presetsHelp')}</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 1.5 }}>
              {PALETTE_PRESETS.map(p => {
                const c = presetColors(p);
                const active = draft.palette.primary === c.palette.primary && draft.darkBackground.default === c.darkBackground.default
                  && draft.palette.secondary === c.palette.secondary;
                return (
                  <Box key={p.id} component="button" type="button" onClick={() => applyPreset(p)} aria-pressed={active}
                    sx={{ p: 1, borderRadius: 2, cursor: 'pointer', textAlign: 'left', bgcolor: 'transparent', color: 'text.primary', font: 'inherit',
                      border: `2px solid ${active ? theme.palette.primary.main : alpha(theme.palette.text.primary, 0.12)}`,
                      '&:hover': { borderColor: active ? theme.palette.primary.main : alpha(theme.palette.text.primary, 0.3) } }}>
                    <Box sx={{ display: 'flex', height: 34, borderRadius: 1, overflow: 'hidden', mb: 0.75 }}>
                      {presetSwatches(p).map(s => <Box key={s} sx={{ flex: 1, bgcolor: s }} />)}
                    </Box>
                    <Typography variant="caption" sx={{ fontWeight: 600 }}>{p.name}</Typography>
                  </Box>
                );
              })}
            </Box>
          </CardContent></Card>

          <Card><CardContent>
            <Typography variant="subtitle2" gutterBottom>{tr('branding.palette')}</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 1.5, mt: 1 }}>
              {PALETTE_KEYS.map(k => <ColorField key={k} label={tr(`branding.colors.${k}`)} value={draft.palette[k]} onChange={v => setPalette(k, v)} />)}
            </Box>
            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle2" gutterBottom>{tr('branding.darkBackground')}</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 1.5, mt: 1 }}>
              {DARK_KEYS.map(k => <ColorField key={k} label={tr(`branding.colors.bg_${k}`)} value={draft.darkBackground[k]} onChange={v => setDark(k, v)} />)}
            </Box>
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 1.5 }}>{tr('branding.gradientHelp')}</Typography>
          </CardContent></Card>

          <Card><CardContent>
            <Typography variant="subtitle2" gutterBottom>{tr('branding.status')}</Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>{tr('branding.statusHelp')}</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 1.5 }}>
              {STATUS_KEYS.map(k => <ColorField key={k} label={tr(`branding.statusKeys.${k}`)} value={draft.status[k]} onChange={v => setStatus(k, v)} />)}
            </Box>
          </CardContent></Card>

          <Card><CardContent>
            <Typography variant="subtitle2" gutterBottom>{tr('branding.workflowTypes')}</Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>{tr('branding.workflowTypesHelp')}</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 1.5 }}>
              {WORKFLOW_TYPES.map(k => <ColorField key={k} label={tr(`branding.workflowTypeKeys.${k}`)} value={draft.workflowTypes[k]} onChange={v => setMap('workflowTypes', k, v)} />)}
            </Box>
            <Stack direction="row" spacing={1} sx={{ mt: 1.5, flexWrap: 'wrap', gap: 1 }}>
              {WORKFLOW_TYPES.map(k => <Chip key={k} size="small" label={tr(`branding.workflowTypeKeys.${k}`)} sx={{ bgcolor: alpha(draft.workflowTypes[k], 0.15), color: draft.workflowTypes[k], fontWeight: 600 }} />)}
            </Stack>
          </CardContent></Card>

          <Card><CardContent>
            <Typography variant="subtitle2" gutterBottom>{tr('branding.matchMethods')}</Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>{tr('branding.matchMethodsHelp')}</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 1.5 }}>
              {MATCH_METHODS.map(k => <ColorField key={k} label={tr(`branding.matchMethodKeys.${k}`)} value={draft.matchMethods[k]} onChange={v => setMap('matchMethods', k, v)} />)}
            </Box>
            <Stack direction="row" spacing={1} sx={{ mt: 1.5, flexWrap: 'wrap', gap: 1 }}>
              {MATCH_METHODS.map(k => <Chip key={k} size="small" label={tr(`branding.matchMethodKeys.${k}`)} sx={{ bgcolor: alpha(draft.matchMethods[k], 0.15), color: draft.matchMethods[k], fontWeight: 600 }} />)}
            </Stack>
          </CardContent></Card>

          <Card><CardContent>
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
              <Typography variant="subtitle2">{tr('branding.charts')}</Typography>
              <ToggleButtonGroup size="small" exclusive value={draft.charts.mode} onChange={(_, v) => v && setCharts({ mode: v })}>
                <ToggleButton value="categorical">{tr('branding.categorical')}</ToggleButton>
                <ToggleButton value="monochrome">{tr('branding.monochrome')}</ToggleButton>
              </ToggleButtonGroup>
            </Stack>
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1.5 }}>
              {draft.charts.mode === 'categorical' ? tr('branding.categoricalHelp', { max: MAX_CHART_COLORS }) : tr('branding.monochromeHelp')}
            </Typography>
            {draft.charts.mode === 'categorical' ? (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
                {draft.charts.colors.map((c, i) => (
                  <Box key={i} sx={{ position: 'relative', '&:hover .rm': { opacity: 1 } }}>
                    <Tooltip title={`${i + 1}. ${c}`}>
                      <Box component="input" type="color" value={HEX_RE.test(c) ? c : '#000000'} onChange={e => setChartColor(i, e.target.value.toUpperCase())}
                        sx={{ width: 36, height: 36, p: 0, border: 'none', borderRadius: 1, cursor: 'pointer', bgcolor: 'transparent' }} />
                    </Tooltip>
                    {draft.charts.colors.length > 2 && (
                      <IconButton className="rm" size="small" onClick={() => setCharts({ colors: draft.charts.colors.filter((_, j) => j !== i) })}
                        sx={{ position: 'absolute', top: -8, right: -8, p: 0.1, opacity: 0, bgcolor: 'background.paper', '&:hover': { bgcolor: 'background.paper' } }}>
                        <CloseIcon sx={{ fontSize: 12 }} />
                      </IconButton>
                    )}
                  </Box>
                ))}
                {draft.charts.colors.length < MAX_CHART_COLORS && (
                  <Tooltip title={tr('branding.addColor')}>
                    <IconButton size="small" onClick={() => setCharts({ colors: [...draft.charts.colors, chartSeries({ ...draft.charts, mode: 'monochrome' }, 1)[0]] })}
                      sx={{ border: `1px dashed ${theme.palette.divider}`, width: 36, height: 36, borderRadius: 1 }}>
                      <AddIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
                <Button size="small" sx={{ ml: 'auto' }} onClick={() => setCharts({ colors: DEFAULT_CHARTS.colors })}>{tr('branding.defaultColors')}</Button>
              </Box>
            ) : (
              <Stack spacing={1.5}>
                <ColorField label={tr('branding.baseColor')} value={draft.charts.base} onChange={v => setCharts({ base: v })} />
                <Box sx={{ display: 'flex', height: 24, borderRadius: 1, overflow: 'hidden' }}>
                  {chartSeries(draft.charts, 12).map((c, i) => <Box key={i} sx={{ flex: 1, bgcolor: c }} />)}
                </Box>
                <Stack direction="row" spacing={1}>
                  {[draft.palette.primary, draft.palette.secondary, draft.palette.accent].map(c => (
                    <Button key={c} size="small" variant="outlined" onClick={() => setCharts({ base: c })}
                      startIcon={<Box sx={{ width: 12, height: 12, borderRadius: 0.5, bgcolor: c }} />}>{c}</Button>
                  ))}
                </Stack>
              </Stack>
            )}
          </CardContent></Card>

          <Card><CardContent>
            <Typography variant="subtitle2" gutterBottom>{tr('branding.typography')}</Typography>
            <TextField select size="small" fullWidth sx={{ mt: 1 }} label={tr('branding.font')} value={draft.typography.font}
              onChange={e => set({ typography: { ...draft.typography, font: e.target.value as FontKey } })}>
              {FONT_KEYS.map(f => <MenuItem key={f} value={f} sx={{ fontFamily: FONT_STACKS[f] }}>{tr(`branding.fonts.${f}`)}</MenuItem>)}
            </TextField>
            {(['dark', 'light'] as const).map(m => (
              <Box key={m} sx={{ mt: 2 }}>
                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>{tr(m === 'dark' ? 'branding.textDark' : 'branding.textLight')}</Typography>
                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 1.5 }}>
                  <ColorField label={tr('branding.textPrimary')} value={draft.typography[m].primary} onChange={v => setText(m, 'primary', v)} />
                  <ColorField label={tr('branding.textSecondary')} value={draft.typography[m].secondary} onChange={v => setText(m, 'secondary', v)} />
                </Box>
              </Box>
            ))}
          </CardContent></Card>
        </Stack>

        <Box sx={{ position: { xl: 'sticky' }, top: 0, order: { xs: -1, xl: 0 } }}>
          <Card><CardContent>
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
              <Typography variant="subtitle2">{tr('branding.preview')}</Typography>
              <ToggleButtonGroup size="small" exclusive value={mode} onChange={(_, v) => v && setMode(v)}>
                <ToggleButton value="dark">{tr('branding.dark')}</ToggleButton>
                <ToggleButton value="light">{tr('branding.light')}</ToggleButton>
              </ToggleButtonGroup>
            </Stack>
            <Preview b={draft} mode={mode} />
            {invalid && <Alert severity="warning" sx={{ mt: 2 }}>{tr('branding.invalid')}</Alert>}
            <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: 2 }}>
              <Button startIcon={<RestartAltIcon />} color="inherit" onClick={reset} disabled={busy}>{tr('branding.reset')}</Button>
              <Button onClick={() => setDraft(saved)} disabled={!dirty || busy}>{tr('common.cancel')}</Button>
              <Button variant="contained" onClick={save} disabled={!dirty || invalid || busy}>{tr('common.save')}</Button>
            </Stack>
          </CardContent></Card>
        </Box>
      </Box>

      <Snackbar open={!!snack} autoHideDuration={4000} onClose={() => setSnack(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
        {snack ? <Alert severity={snack.severity} onClose={() => setSnack(null)}>{snack.msg}</Alert> : undefined}
      </Snackbar>
    </Box>
  );
}
