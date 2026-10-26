// Brand-driven semantic colors: status, lifecycle stages, priorities, workflow types,
// match methods and chart series. Many callers live outside React (DataGrid columns,
// ECharts builders), so AppThemeProvider pushes the current branding into a module
// registry; the getters below read from it.
import { alpha } from '@mui/material/styles';

export interface StatusColors { success: string; warning: string; error: string; info: string; neutral: string }
export interface ChartsConfig { mode: 'categorical' | 'monochrome'; colors: string[]; base: string }
export type FontKey = 'texta' | 'system' | 'serif';
export interface TypographyConfig {
  font: FontKey;
  dark: { primary: string; secondary: string };
  light: { primary: string; secondary: string };
}

export const DEFAULT_STATUS: StatusColors = { success: '#66BB6A', warning: '#FFA726', error: '#EF5350', info: '#42A5F5', neutral: '#78909C' };
export const WORKFLOW_TYPES = ['ONBOARDING', 'ENRICHMENT', 'MERGE', 'DEACTIVATION', 'HIERARCHY_CHANGE'] as const;
export const MATCH_METHODS = ['EXACT_KEY', 'FUZZY', 'PHONETIC', 'COMPOSITE', 'ADDRESS', 'EMBEDDING', 'LLM_JUDGE'] as const;
export type ColorMap = Record<string, string>;
export const DEFAULT_WORKFLOW_TYPES: ColorMap = { ONBOARDING: '#42A5F5', ENRICHMENT: '#AB47BC', MERGE: '#FFA726', DEACTIVATION: '#EF5350', HIERARCHY_CHANGE: '#26A69A' };
export const DEFAULT_MATCH_METHODS: ColorMap = { EXACT_KEY: '#4CAF50', FUZZY: '#66BB6A', PHONETIC: '#00897B', COMPOSITE: '#FF9800', ADDRESS: '#0288D1', EMBEDDING: '#2196F3', LLM_JUDGE: '#AB47BC' };
export const DEFAULT_CHARTS: ChartsConfig = {
  mode: 'categorical',
  colors: ['#29B5E8', '#AB47BC', '#66BB6A', '#FFA726', '#EF5350', '#26A69A', '#42A5F5', '#FF7043', '#5C6BC0', '#FFCA28', '#8D6E63', '#EC407A'],
  base: '#29B5E8',
};
export const DEFAULT_TYPOGRAPHY: TypographyConfig = {
  font: 'texta',
  dark: { primary: '#FFFFFF', secondary: '#B4BCCB' },
  light: { primary: '#1A1A2E', secondary: '#555577' },
};
export const FONT_STACKS: Record<FontKey, string> = {
  texta: '"Texta", "Helvetica Neue", "Arial", sans-serif',
  system: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
};

// ── color math ──
const toRgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const toHex = (rgb: number[]) => '#' + rgb.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase();
const mix = (a: string, b: string, t: number) => { const x = toRgb(a), y = toRgb(b); return toHex(x.map((v, i) => v + (y[i] - v) * t)); };

/** n shades of one color, from light to dark, keeping the base in the middle. */
export function monochrome(base: string, n: number): string[] {
  if (n <= 1) return [base];
  const light = mix(base, '#FFFFFF', 0.6), dark = mix(base, '#000000', 0.55);
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    return t < 0.5 ? mix(light, base, t * 2) : mix(base, dark, (t - 0.5) * 2);
  });
}

/** n series colors. Categorical cycles the list; monochrome spreads shades over n. */
export function chartSeries(cfg: ChartsConfig, n: number): string[] {
  if (cfg.mode === 'monochrome') return monochrome(cfg.base, Math.max(n, 1));
  const list = cfg.colors.length ? cfg.colors : DEFAULT_CHARTS.colors;
  return Array.from({ length: Math.max(n, 1) }, (_, i) => list[i % list.length]);
}

// ── registry (set by AppThemeProvider) ──
let _status: StatusColors = DEFAULT_STATUS;
let _charts: ChartsConfig = DEFAULT_CHARTS;
let _workflow: ColorMap = DEFAULT_WORKFLOW_TYPES;
let _methods: ColorMap = DEFAULT_MATCH_METHODS;
let _version = 0;
export function setBrandColors(status?: Partial<StatusColors>, charts?: Partial<ChartsConfig>, workflowTypes?: ColorMap, matchMethods?: ColorMap) {
  _status = { ...DEFAULT_STATUS, ...status };
  _workflow = { ...DEFAULT_WORKFLOW_TYPES, ...workflowTypes };
  _methods = { ...DEFAULT_MATCH_METHODS, ...matchMethods };
  _charts = { ...DEFAULT_CHARTS, ...charts };
  _version++;
}
/** Changes whenever branding colors change; use as a memo dependency. */
export const brandColorsVersion = () => _version;

export const statusColors = () => _status;
export const chartsConfig = () => _charts;
/** i-th of n series colors */
export const seriesColor = (i: number, n = _charts.mode === 'monochrome' ? 8 : _charts.colors.length) => chartSeries(_charts, n)[i % Math.max(n, 1)];

// Categorical keys map to fixed series slots so a value keeps its color across pages
const STAGE_STATUS: Record<string, keyof StatusColors> = {
  DRAFT: 'neutral', REVIEW: 'warning', VALIDATED: 'info', APPROVED: 'info',
  ACTIVE: 'success', PUBLISHED: 'success', SUSPENDED: 'error', ARCHIVED: 'neutral', DISCONTINUED: 'neutral',
};
export function stageColor(stage: string): string {
  if (stage === 'ENRICHMENT') return seriesColor(1);
  const s = STAGE_STATUS[stage];
  const c = s ? _status[s] : _status.neutral;
  return stage === 'ARCHIVED' || stage === 'DISCONTINUED' ? alpha(c, 0.75) : c;
}
export const priorityColor = (p: string) => ({ HIGH: _status.error, MEDIUM: _status.warning, LOW: _status.success } as Record<string, string>)[p] || _status.neutral;
export const workflowTypeColor = (t: string) => _workflow[t] || _status.neutral;
export function matchMethodColor(method: string): string {
  const m = method.endsWith('+LLM') ? 'LLM_JUDGE' : method;
  return _methods[m] || _status.neutral;
}
/** Match score: high = likely duplicate (error), medium = review (warning) */
export const matchScoreColor = (score: number, fallback: string) => (score >= 80 ? _status.error : score >= 50 ? _status.warning : fallback);
/** DQ / quality score: good / fair / poor */
export const qualityColor = (score: number) => (score >= 90 ? _status.success : score >= 70 ? _status.warning : _status.error);

/** Object whose values are read live from the registry (keeps `map[key]` and Object.entries working). */
export function liveColors(keys: string[], fn: (k: string) => string): Record<string, string> {
  const o: Record<string, string> = {};
  for (const k of keys) Object.defineProperty(o, k, { get: () => fn(k), enumerable: true });
  return o;
}
