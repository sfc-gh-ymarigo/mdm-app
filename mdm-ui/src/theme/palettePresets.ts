// Ready-made full palettes for Branding. Each is six swatches from darkest to lightest plus a highlight;
// toBranding() derives every brand color from them (status colors stay semantic and are not touched).
import type { BrandPalette } from '../config/BrandContext';
import type { ChartsConfig } from './brandColors';

export interface PalettePreset {
  id: string;
  name: string;
  /** Darkest to lightest */
  shades: [string, string, string, string, string];
  /** Vivid highlight used as primary; when absent the mid shade is primary */
  highlight?: string;
  /** Fixed values instead of derived ones (the Glacier default) */
  fixed?: { palette: BrandPalette; darkBackground: { default: string; paper: string; card: string }; charts: ChartsConfig };
}

export const PALETTE_PRESETS: PalettePreset[] = [
  {
    id: 'glacier', name: 'Glacier', shades: ['#040D21', '#0D2847', '#11567F', '#29B5E8', '#A8E6F7'], highlight: '#29B5E8',
    fixed: {
      palette: { primary: '#29B5E8', primaryLight: '#56C8EF', primaryDark: '#1A8CB8', secondary: '#11567F', secondaryLight: '#1E7AAD', secondaryDark: '#0D3F5E', accent: '#49D4A9' },
      darkBackground: { default: '#040D21', paper: '#081A36', card: '#0D2847' },
      charts: { mode: 'categorical', colors: ['#29B5E8', '#AB47BC', '#66BB6A', '#FFA726', '#EF5350', '#26A69A', '#42A5F5', '#FF7043', '#5C6BC0', '#FFCA28', '#8D6E63', '#EC407A'], base: '#29B5E8' },
    },
  },
  { id: 'mocha', name: 'Mocha', shades: ['#1A120E', '#3A2418', '#6B4A2E', '#A88462', '#D5C4AE'] },
  { id: 'amethyst', name: 'Amethyst', shades: ['#0E0B1D', '#2A1E4D', '#5A3B8C', '#8B7CC7', '#C9C2E3'] },
  { id: 'moss', name: 'Moss', shades: ['#0F1F17', '#1E3A2E', '#3E5A3F', '#6B7F67', '#C7CBB8'] },
  { id: 'harbor', name: 'Harbor', shades: ['#0B132B', '#1C2541', '#3A506B', '#5BC0DE', '#F4D6B0'], highlight: '#D97706' },
  { id: 'neon-slate', name: 'Neon Slate', shades: ['#121212', '#1F2937', '#334155', '#64748B', '#F1F5F9'], highlight: '#EC4899' },
  { id: 'lagoon', name: 'Lagoon', shades: ['#0A0F14', '#0F3D3E', '#2E6F73', '#7FB3B8', '#EADCC8'], highlight: '#C6601F' },
  { id: 'dusk', name: 'Dusk', shades: ['#1A0F2E', '#3B1B4F', '#7A2E6F', '#D6598F', '#F4D7D4'], highlight: '#FF6B6B' },
  { id: 'forest-gold', name: 'Forest Gold', shades: ['#0B0F0D', '#1F2A1F', '#3E5A3F', '#8CA98C', '#D9C7A3'], highlight: '#B08D57' },
  { id: 'graphite', name: 'Graphite', shades: ['#111213', '#1D1F22', '#3A3D42', '#8A8F98', '#D4D7DC'] },
];

const rgb = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const hex = (c: number[]) => '#' + c.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase();
const mix = (a: string, b: string, t: number) => { const x = rgb(a), y = rgb(b); return hex(x.map((v, i) => v + (y[i] - v) * t)); };

/** Brand colors of a preset: palette, dark backgrounds and chart series. */
export function presetColors(p: PalettePreset) {
  if (p.fixed) return p.fixed;
  const [c0, c1, c2, c3, c4] = p.shades;
  const primary = p.highlight || c3;
  const palette: BrandPalette = {
    primary,
    primaryLight: p.highlight ? mix(primary, '#FFFFFF', 0.25) : mix(c3, c4, 0.5),
    primaryDark: p.highlight ? mix(primary, '#000000', 0.2) : c2,
    secondary: c2,
    secondaryLight: mix(c2, c3, 0.5),
    secondaryDark: c1,
    accent: p.highlight ? c3 : c4,
  };
  const charts: ChartsConfig = {
    mode: 'categorical',
    colors: [primary, palette.accent, c4, mix(c2, c3, 0.5), mix(primary, c4, 0.5), mix(palette.accent, c1, 0.4)],
    base: primary,
  };
  return { palette, darkBackground: { default: c0, paper: mix(c0, c1, 0.5), card: c1 }, charts };
}

/** Swatches shown on the preset card */
export const presetSwatches = (p: PalettePreset) => (p.highlight && !p.shades.includes(p.highlight) ? [...p.shades, p.highlight] : p.shades);
