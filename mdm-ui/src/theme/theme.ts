import { createTheme, alpha } from '@mui/material/styles';
import type {} from '@mui/x-data-grid/themeAugmentation';
import type { BrandPalette } from '../config/BrandContext';
import { DEFAULT_STATUS, DEFAULT_TYPOGRAPHY, FONT_STACKS, type StatusColors, type TypographyConfig } from './brandColors';

/* ── Shared hourglass card styling ── */
const hourglassCard = {
  backgroundImage: 'none',
  backdropFilter: 'blur(20px)',
  borderRadius: 16,
  transition: 'transform 0.2s ease, box-shadow 0.2s ease',
  '&:hover': {
    transform: 'translateY(-2px)',
  },
};

/* ── Default brand palette ── used before config loads ── */
const DEFAULT_PALETTE: BrandPalette = {
  primary: '#29B5E8',
  primaryLight: '#56C8EF',
  primaryDark: '#1A8CB8',
  secondary: '#11567F',
  secondaryLight: '#1E7AAD',
  secondaryDark: '#0D3F5E',
  accent: '#49D4A9',
};

const DEFAULT_DARK_BG = { default: '#040D21', paper: '#081A36', card: '#0D2847', sidebarGradient: '' };

export interface ThemeBgConfig {
  darkBackground?: { default: string; paper: string; card: string; sidebarGradient: string };
  lightBackground?: { sidebarGradient: string };
  status?: Partial<StatusColors>;
  typography?: Partial<TypographyConfig>;
}
const statusOf = (bg: ThemeBgConfig) => ({ ...DEFAULT_STATUS, ...bg.status });
const typoOf = (bg: ThemeBgConfig): TypographyConfig => ({
  font: bg.typography?.font || DEFAULT_TYPOGRAPHY.font,
  dark: { ...DEFAULT_TYPOGRAPHY.dark, ...bg.typography?.dark },
  light: { ...DEFAULT_TYPOGRAPHY.light, ...bg.typography?.light },
});

// Re-export palette values for backward compat (Layout.tsx, etc. import these)
// These are the static defaults; components should prefer useBrand().palette when available.
export const BRAND_PRIMARY   = DEFAULT_PALETTE.primary;
export const BRAND_SECONDARY = DEFAULT_PALETTE.secondary;
export const BRAND_ACCENT    = DEFAULT_PALETTE.accent;

export const BG_DARK  = DEFAULT_DARK_BG.default;
export const BG_PAPER = DEFAULT_DARK_BG.paper;
export const BG_CARD  = DEFAULT_DARK_BG.card;

export function createDarkTheme(p: BrandPalette = DEFAULT_PALETTE, bg: ThemeBgConfig = {}) {
  const dbg = bg.darkBackground || DEFAULT_DARK_BG;
  const st = statusOf(bg), ty = typoOf(bg);
  return createTheme({
    palette: {
      mode: 'dark',
      primary:    { main: p.secondary, light: p.secondaryLight, dark: p.secondaryDark },
      secondary:  { main: p.accent },
      background: { default: dbg.default, paper: dbg.paper },
      success:    { main: st.success },
      warning:    { main: st.warning },
      error:      { main: st.error },
      info:       { main: st.info },
      divider: alpha('#FFFFFF', 0.08),
      text: { primary: ty.dark.primary, secondary: ty.dark.secondary },
    },
    typography: {
      fontFamily: FONT_STACKS[ty.font],
      h4:        { fontWeight: 700, letterSpacing: '-0.02em' },
      h5:        { fontWeight: 600, letterSpacing: '-0.01em' },
      h6:        { fontWeight: 600 },
      subtitle1: { fontWeight: 500, color: ty.dark.secondary },
      body2:     { color: alpha(ty.dark.secondary, 0.9) },
    },
    shape: { borderRadius: 16 },
    components: {
      MuiCard: {
        styleOverrides: {
          root: {
            ...hourglassCard,
            backgroundColor: dbg.card,
            border: `1px solid ${alpha('#FFFFFF', 0.06)}`,
            '&:hover': {
              ...hourglassCard['&:hover'],
              boxShadow: `0 8px 32px ${alpha(p.primary, 0.3)}`,
            },
          },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: { textTransform: 'none' as const, fontWeight: 600, borderRadius: 10 },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: { fontWeight: 500, borderRadius: 10 },
        },
      },
      MuiDataGrid: {
        styleOverrides: {
          root: { '--DataGrid-containerBackground': dbg.card, '--DataGrid-pinnedBackground': dbg.card },
          columnHeaderTitle: { fontWeight: 700 },
        },
      },
    },
  });
}

export function createLightTheme(p: BrandPalette = DEFAULT_PALETTE, bg: ThemeBgConfig = {}) {
  const st = statusOf(bg), ty = typoOf(bg);
  const BG_LIGHT       = '#F4F5F9';
  const BG_LIGHT_PAPER = '#FFFFFF';
  const BG_LIGHT_CARD  = '#FFFFFF';

  return createTheme({
    palette: {
      mode: 'light',
      primary:    { main: p.primary, light: p.primaryLight, dark: p.primaryDark },
      secondary:  { main: p.accent },
      background: { default: BG_LIGHT, paper: BG_LIGHT_PAPER },
      success:    { main: st.success },
      warning:    { main: st.warning },
      error:      { main: st.error },
      info:       { main: st.info },
      divider: alpha('#000000', 0.08),
      text: {
        primary: ty.light.primary,
        secondary: ty.light.secondary,
      },
    },
    typography: {
      fontFamily: FONT_STACKS[ty.font],
      h4:        { fontWeight: 700, letterSpacing: '-0.02em', color: ty.light.primary },
      h5:        { fontWeight: 600, letterSpacing: '-0.01em' },
      h6:        { fontWeight: 600 },
      subtitle1: { fontWeight: 500, color: ty.light.secondary },
      body2:     { color: ty.light.secondary },
    },
    shape: { borderRadius: 16 },
    components: {
      MuiCard: {
        styleOverrides: {
          root: {
            ...hourglassCard,
            backgroundColor: BG_LIGHT_CARD,
            border: `1px solid ${alpha(p.primary, 0.08)}`,
            boxShadow: `0 2px 12px ${alpha(p.primary, 0.06)}`,
            '&:hover': {
              ...hourglassCard['&:hover'],
              boxShadow: `0 8px 32px ${alpha(p.primary, 0.12)}`,
            },
          },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: { textTransform: 'none' as const, fontWeight: 600, borderRadius: 10 },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: { fontWeight: 500, borderRadius: 10 },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          root: { borderColor: alpha(p.primary, 0.08) },
        },
      },
      MuiDataGrid: {
        styleOverrides: {
          root: { '--DataGrid-containerBackground': BG_LIGHT_CARD, '--DataGrid-pinnedBackground': BG_LIGHT_CARD },
          columnHeaderTitle: { fontWeight: 700 },
        },
      },
    },
  });
}

// Static defaults for backward compat (used before config loads)
export const darkTheme = createDarkTheme();
export const lightTheme = createLightTheme();

export default darkTheme;
