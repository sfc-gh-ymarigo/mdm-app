import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { ModuleConfig } from './modules/types.js';
import { logger } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface DemoConfig {
  /** ISO 4217 currency used when a record has none */
  defaultCurrency?: string;
  hierarchyRoots?: { productCatalog: string; customerTree: string };
  id: string;
  name: string;
  fullName: string;
  tagline: string;
  industry: string;
  domain: string;
  logo: string;
  palette: {
    primary: string;
    primaryLight: string;
    primaryDark: string;
    secondary: string;
    secondaryLight: string;
    secondaryDark: string;
    accent: string;
  };
  darkBackground: {
    default: string;
    paper: string;
    card: string;
    sidebarGradient: string;
  };
  lightBackground: {
    sidebarGradient: string;
  };
  status?: Partial<Branding['status']>;
  workflowTypes?: Partial<Branding['workflowTypes']>;
  matchMethods?: Partial<Branding['matchMethods']>;
  charts?: Partial<Branding['charts']>;
  typography?: { font?: Branding['typography']['font']; dark?: Partial<Branding['typography']['dark']>; light?: Partial<Branding['typography']['light']> };
  users: Array<{
    email: string;
    display_name: string;
    role: string;
    country_scope: string[] | null;
    sf_role: string;
  }>;
  defaultUser: string;
  llmContext: string;
  snowflake: {
    database: string;
    analyticsSchema?: string;
    mirrorDatabase?: string;
    mirrorName?: string;
    postgresInstance?: string;
    agent?: string;
    semanticView?: string;
    warehouse: string;
  };
  imageCdn: {
    pattern: string;
    fallback: string;
  };
  notifications: Array<{
    text: string;
    type: string;
    time: string;
    path: string;
  }>;
  languages?: LanguageConfig[];
  countries?: CountryConfig[];
  /** Snowflake-side governance. pii_unmask_roles: roles that see PII in clear (synced to
   *  GOVERNANCE.PII_UNMASK_ROLES; default MDM_ADMIN_ROLE). pii_fields: PII fields per module id,
   *  masked in the API and tagged PII_TYPE in Snowflake. See src/pii.ts. */
  governance?: { pii_unmask_roles?: string[]; pii_fields?: Record<string, string[]> };
  modules: ModuleConfig[];
}

// `enabled` is omitted when true, so existing configs without the key stay active.
// Read it through isEnabled() rather than testing the property directly.
export interface LanguageConfig {
  code: string;
  label: string;
  default?: boolean;
  enabled?: boolean;
}

export interface CountryConfig {
  code: string;
  label: string;
  enabled?: boolean;
}

export function isEnabled(item: { enabled?: boolean }): boolean {
  return item.enabled !== false;
}

let _config: DemoConfig | null = null;
let _configPath: string | null = null;

export function loadConfig(): DemoConfig {
  if (_config) return _config;

  const customer = process.env.DEMO_CUSTOMER || 'neutral';
  // Look for config relative to project root (mdm-api is one level down)
  const candidates = [
    path.resolve(__dirname, '..', '..', 'data', customer, 'config.json'),
    path.resolve(__dirname, '..', 'data', customer, 'config.json'),
    path.resolve(process.cwd(), 'data', customer, 'config.json'),
    path.resolve(process.cwd(), '..', 'data', customer, 'config.json'),
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      _config = JSON.parse(fs.readFileSync(p, 'utf-8')) as DemoConfig;
      _configPath = p;
      logger.info({ config: customer, path: p }, 'demo config loaded');
      return _config;
    }
  }

  throw new Error(`Demo config not found for customer "${customer}". Tried:\n${candidates.join('\n')}`);
}

export function saveConfig(): void {
  if (!_config) throw new Error('Config not loaded');
  persistConfig().catch(err => logger.error({ err }, 'config save failed'));
}

// ── Config store (Postgres mdm.app_config) ──
// The JSON file under data/<id>/ only seeds the store on first start. Every save
// bumps the version; the trigger records history and NOTIFYs other replicas.
const CONFIG_ID = 'main';
let _version = 0;
let _pool: import('pg').Pool | null = null;
let _saveChain: Promise<void> = Promise.resolve();

function replaceConfig(doc: DemoConfig) {
  const cfg = loadConfig() as unknown as Record<string, unknown>;
  for (const k of Object.keys(cfg)) delete cfg[k];
  Object.assign(cfg, doc);
}

function persistConfig(): Promise<void> {
  _saveChain = _saveChain.then(async () => {
    if (!_pool) { if (_configPath) fs.writeFileSync(_configPath, JSON.stringify(_config, null, 2) + '\n', 'utf-8'); return; }
    const r = await _pool.query(
      `UPDATE mdm.app_config SET doc = $2, version = version + 1, updated_at = now(), updated_by = $3 WHERE id = $1 RETURNING version`,
      [CONFIG_ID, JSON.stringify(_config), _configActor]);
    _version = r.rows[0]?.version ?? _version;
  });
  return _saveChain;
}

let _configActor = 'system';
/** Attribute the next config save(s) to a user (set by the admin routes). */
export function setConfigActor(email: string) { _configActor = email || 'system'; }

export function configVersion() { return _version; }
/** Resolves once every pending config save has been written. */
export function flushConfig(): Promise<void> { return _saveChain.catch(() => undefined); }

export async function initConfigStore(pool: import('pg').Pool): Promise<void> {
  loadConfig();
  const existing = await pool.query('SELECT version, doc FROM mdm.app_config WHERE id = $1', [CONFIG_ID]);
  if (existing.rows.length) {
    replaceConfig(existing.rows[0].doc);
    _version = existing.rows[0].version;
    logger.info({ version: _version }, 'config loaded from mdm.app_config');
  } else {
    await pool.query(
      `INSERT INTO mdm.app_config (id, version, doc, updated_by, updated_at) VALUES ($1, 1, $2, 'seed', now())`,
      [CONFIG_ID, JSON.stringify(_config)]);
    _version = 1;
    logger.info({ path: _configPath }, 'config seeded into mdm.app_config');
  }
  _pool = pool;

  // Pick up saves made by other API replicas (reconnects if the connection drops)
  const reload = async () => {
    const r = await pool.query('SELECT version, doc FROM mdm.app_config WHERE id = $1', [CONFIG_ID]);
    if (r.rows.length && r.rows[0].version > _version) {
      replaceConfig(r.rows[0].doc); _version = r.rows[0].version; logger.info({ version: _version }, 'config reloaded');
    }
  };
  const listen = async (): Promise<void> => {
    if (_stopped) return;
    let listener: import('pg').PoolClient;
    try { listener = await pool.connect(); }
    catch (err) { logger.warn({ err }, 'config listener connect failed, retrying'); setTimeout(listen, 10_000); return; }
    _listener = listener;
    let dead = false;
    const restart = (err: Error) => {
      if (dead || _stopped) return; dead = true;
      logger.warn({ err }, 'config listener lost, reconnecting');
      listener.release(err);
      setTimeout(() => { listen(); reload().catch(() => {}); }, 5_000);
    };
    listener.on('error', restart);
    listener.on('notification', msg => {
      try {
        const { id, version } = JSON.parse(msg.payload || '{}');
        if (id === CONFIG_ID && version > _version) reload().catch(e => logger.warn({ err: e }, 'config reload failed'));
      } catch { /* malformed payload */ }
    });
    try { await listener.query('LISTEN mdm_config'); } catch (err) { restart(err as Error); }
  };
  await listen();
}

let _listener: import('pg').PoolClient | null = null;
let _stopped = false;

/** Releases the LISTEN connection so the pool can be closed (scripts, tests, graceful shutdown). */
export async function stopConfigListener() {
  _stopped = true;
  const l = _listener;
  _listener = null;
  if (l) { await l.query('UNLISTEN *').catch(() => {}); l.release(); }
}

export async function configHistory(limit = 50) {
  if (!_pool) return [];
  const r = await _pool.query(
    'SELECT version, updated_by, updated_at FROM mdm.app_config_history WHERE id = $1 ORDER BY version DESC LIMIT $2',
    [CONFIG_ID, limit]);
  return r.rows;
}

// ── Snowflake object names ──
// Resolution order: environment variable > config.snowflake > neutral default.
export interface SfObjects {
  database: string; analyticsSchema: string; mirrorDatabase: string; mirrorName: string;
  postgresInstance: string; warehouse: string; agent: string; semanticView: string;
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_$]*(\.[A-Za-z_][A-Za-z0-9_$]*){0,2}$/;

export function sfObjects(): SfObjects {
  const s = (loadConfig().snowflake || {}) as Partial<DemoConfig["snowflake"]>;
  const database = process.env.MDM_DATABASE || s.database || 'MDM';
  const analyticsSchema = process.env.MDM_ANALYTICS_SCHEMA || s.analyticsSchema || 'MDM_ANALYTICS';
  const o: SfObjects = {
    database,
    analyticsSchema,
    mirrorDatabase: process.env.MDM_MIRROR_DATABASE || s.mirrorDatabase || `${database}_MIRROR`,
    mirrorName: process.env.MDM_MIRROR_NAME || s.mirrorName || `${database}_MIRROR`.toLowerCase(),
    postgresInstance: process.env.MDM_PG_INSTANCE || s.postgresInstance || `${database}_PG`,
    warehouse: process.env.MDM_WAREHOUSE || s.warehouse || 'MDM_WH',
    agent: process.env.MDM_AGENT || s.agent || `${database}.${analyticsSchema}.MDM_AGENT`,
    semanticView: process.env.MDM_SEMANTIC_VIEW || s.semanticView || `${database}.${analyticsSchema}.MDM_ANALYTICS_VIEW`,
  };
  // Names are interpolated into SQL — refuse anything that is not a plain identifier.
  for (const [k, v] of Object.entries(o)) {
    if (!IDENT.test(v)) throw new Error(`Invalid Snowflake identifier for ${k}: ${v}`);
  }
  return o;
}

/** Fully-qualified name inside the analytics schema, e.g. sfName('CUSTOMER_HISTORY'). */
export function sfName(object: string): string {
  const o = sfObjects();
  return `${o.database}.${o.analyticsSchema}.${object}`;
}

export function setModuleEnabled(moduleId: string, enabled: boolean): ModuleConfig | undefined {
  const cfg = loadConfig();
  const mod = cfg.modules.find(m => m.id === moduleId);
  if (!mod) return undefined;
  mod.enabled = enabled;
  saveConfig();
  return mod;
}

export function setModuleProperty(moduleId: string, key: 'allow_create' | 'country_scoped' | 'country_null_all', value: boolean): ModuleConfig | undefined {
  const cfg = loadConfig();
  const mod = cfg.modules.find(m => m.id === moduleId);
  if (!mod) return undefined;
  (mod as unknown as Record<string, unknown>)[key] = value;
  saveConfig();
  return mod;
}

// ── Localization: translation languages ──
// Language codes are stored lower-case (en, fr); country codes upper-case (FRA, GBR).

export function getLanguages(): LanguageConfig[] {
  return loadConfig().languages || [];
}

export function addLanguage(code: string, label: string, isDefault = false): LanguageConfig | undefined {
  const cfg = loadConfig();
  if (!cfg.languages) cfg.languages = [];
  const norm = code.trim().toLowerCase();
  if (!norm || !label.trim()) return undefined;
  if (cfg.languages.some(l => l.code.toLowerCase() === norm)) return undefined;
  // The first language added is always the default — there must never be a language
  // list without exactly one default.
  const makeDefault = isDefault || cfg.languages.length === 0;
  if (makeDefault) cfg.languages.forEach(l => { delete l.default; });
  const lang: LanguageConfig = { code: norm, label: label.trim() };
  if (makeDefault) lang.default = true;
  cfg.languages.push(lang);
  saveConfig();
  return lang;
}

export function setDefaultLanguage(code: string): LanguageConfig | undefined {
  const cfg = loadConfig();
  if (!cfg.languages) return undefined;
  const norm = code.trim().toLowerCase();
  const target = cfg.languages.find(l => l.code.toLowerCase() === norm);
  if (!target) return undefined;
  cfg.languages.forEach(l => { delete l.default; });
  target.default = true;
  // The default language is the primary content language, so it must be active.
  delete target.enabled;
  saveConfig();
  return target;
}

export function setLanguageEnabled(code: string, enabled: boolean): LanguageConfig | undefined {
  const cfg = loadConfig();
  if (!cfg.languages) return undefined;
  const norm = code.trim().toLowerCase();
  const target = cfg.languages.find(l => l.code.toLowerCase() === norm);
  if (!target) return undefined;
  if (enabled) delete target.enabled; else target.enabled = false;
  saveConfig();
  return target;
}

// ── Localization: operating countries ──

export function getCountries(): CountryConfig[] {
  return loadConfig().countries || [];
}

export function addCountry(code: string, label: string): CountryConfig | undefined {
  const cfg = loadConfig();
  if (!cfg.countries) cfg.countries = [];
  const norm = code.trim().toUpperCase();
  if (!norm || !label.trim()) return undefined;
  if (cfg.countries.some(c => c.code.toUpperCase() === norm)) return undefined;
  const country: CountryConfig = { code: norm, label: label.trim() };
  cfg.countries.push(country);
  saveConfig();
  return country;
}

export function setCountryEnabled(code: string, enabled: boolean): CountryConfig | undefined {
  const cfg = loadConfig();
  if (!cfg.countries) return undefined;
  const norm = code.trim().toUpperCase();
  const target = cfg.countries.find(c => c.code.toUpperCase() === norm);
  if (!target) return undefined;
  if (enabled) delete target.enabled; else target.enabled = false;
  saveConfig();
  return target;
}

// Re-export for convenience
export const config = new Proxy({} as DemoConfig, {
  get(_target, prop) {
    return (loadConfig() as unknown as Record<string | symbol, unknown>)[prop];
  },
});

// Module registry helpers
export function getModules(): ModuleConfig[] {
  return loadConfig().modules || [];
}

export function getEnabledModules(): ModuleConfig[] {
  return getModules().filter(m => m.enabled).sort((a, b) => a.order - b.order);
}

export function getModule(id: string): ModuleConfig | undefined {
  return getModules().find(m => m.id === id);
}

// Field management helpers
import type { FieldDef } from './modules/types.js';

export function setFieldActive(moduleId: string, fieldName: string, active: boolean): FieldDef | undefined {
  const mod = getModule(moduleId);
  if (!mod) return undefined;
  const field = mod.fields.find(f => f.name === fieldName);
  if (!field) return undefined;
  field.active = active;
  saveConfig();
  return field;
}

export function addCustomField(moduleId: string, fieldDef: FieldDef): FieldDef | undefined {
  const mod = getModule(moduleId);
  if (!mod) return undefined;
  if (mod.fields.some(f => f.name === fieldDef.name)) return undefined;
  fieldDef.builtin = false;
  fieldDef.active = true;
  mod.fields.push(fieldDef);
  saveConfig();
  return fieldDef;
}

export function deleteCustomField(moduleId: string, fieldName: string): boolean {
  const mod = getModule(moduleId);
  if (!mod) return false;
  const idx = mod.fields.findIndex(f => f.name === fieldName && !f.builtin);
  if (idx === -1) return false;
  mod.fields.splice(idx, 1);
  saveConfig();
  return true;
}

export function updateMatchingConfig(moduleId: string, updates: Record<string, unknown>): Record<string, unknown> | undefined {
  const mod = getModule(moduleId);
  if (!mod) return undefined;
  if (!mod.matching) {
    mod.matching = { enabled: false, fields: [] };
  }
  // Top-level matching properties
  if (updates.enabled !== undefined) mod.matching.enabled = !!updates.enabled;
  if (updates.fields !== undefined) mod.matching.fields = updates.fields as string[];
  // Method-level updates
  if (updates.methods !== undefined) {
    if (!mod.matching.methods) mod.matching.methods = {};
    const m = updates.methods as Record<string, Record<string, unknown>>;
    for (const [methodName, methodUpdates] of Object.entries(m)) {
      const target = (mod.matching.methods as Record<string, Record<string, unknown>>)[methodName];
      if (target) {
        Object.assign(target, methodUpdates);
      } else {
        (mod.matching.methods as Record<string, Record<string, unknown>>)[methodName] = methodUpdates;
      }
    }
  }
  saveConfig();
  return mod.matching as unknown as Record<string, unknown>;
}

export function updateHierarchyConfig(moduleId: string, updates: Record<string, unknown>): Record<string, unknown> | undefined {
  const mod = getModule(moduleId);
  if (!mod) return undefined;
  if (!mod.hierarchy) {
    mod.hierarchy = { enabled: false, parent_field: 'parent_id', root_label: '', type: 'self' };
  }
  const h = mod.hierarchy;
  if (updates.enabled !== undefined) h.enabled = !!updates.enabled;
  if (updates.root_label !== undefined) h.root_label = String(updates.root_label);
  if (updates.max_depth !== undefined) h.max_depth = updates.max_depth === null ? null : Number(updates.max_depth) || null;
  if (updates.max_parents !== undefined) h.max_parents = Number(updates.max_parents) || 1;
  if (updates.allow_root !== undefined) h.allow_root = !!updates.allow_root;
  if (updates.prevent_circular !== undefined) h.prevent_circular = !!updates.prevent_circular;
  if (updates.change_mode !== undefined) h.change_mode = updates.change_mode === 'immediate' ? 'immediate' : 'workflow';
  saveConfig();
  return h as unknown as Record<string, unknown>;
}

// ── Branding ──
// Defaults used by the "reset" action: Snowflake palette, flake watermark (empty logo).
export const DEFAULT_BRANDING = {
  name: 'Glacier',
  fullName: 'Glacier — MDM on Snowflake',
  tagline: 'Master Data Management — overview & quality insights',
  logo: 'glacier-logo.svg',
  palette: {
    primary: '#29B5E8', primaryLight: '#56C8EF', primaryDark: '#1A8CB8',
    secondary: '#11567F', secondaryLight: '#1E7AAD', secondaryDark: '#0D3F5E',
    accent: '#49D4A9',
  },
  darkBackground: {
    default: '#040D21', paper: '#081A36', card: '#0D2847',
    sidebarGradient: 'linear-gradient(180deg, #081A36 0%, #040D21 100%)',
  },
  lightBackground: { sidebarGradient: 'linear-gradient(180deg, #11567F 0%, #0D3F5E 100%)' },
  // Status colors: chips, priorities, lifecycle stages, KPI accents
  status: { success: '#66BB6A', warning: '#FFA726', error: '#EF5350', info: '#42A5F5', neutral: '#78909C' },
  // Workflow type badges / progress, and Match & Merge method chips
  workflowTypes: { ONBOARDING: '#42A5F5', ENRICHMENT: '#AB47BC', MERGE: '#FFA726', DEACTIVATION: '#EF5350', HIERARCHY_CHANGE: '#26A69A' },
  matchMethods: { EXACT_KEY: '#4CAF50', FUZZY: '#66BB6A', PHONETIC: '#00897B', COMPOSITE: '#FF9800', ADDRESS: '#0288D1', EMBEDDING: '#2196F3', LLM_JUDGE: '#AB47BC' },
  // Chart series: a free list (categorical) or shades of one base color (monochrome)
  charts: {
    mode: 'categorical' as 'categorical' | 'monochrome',
    colors: ['#29B5E8', '#AB47BC', '#66BB6A', '#FFA726', '#EF5350', '#26A69A', '#42A5F5', '#FF7043', '#5C6BC0', '#FFCA28', '#8D6E63', '#EC407A'],
    base: '#29B5E8',
  },
  typography: {
    font: 'texta' as 'texta' | 'system' | 'serif',
    dark: { primary: '#FFFFFF', secondary: '#B4BCCB' },
    light: { primary: '#1A1A2E', secondary: '#555577' },
  },
};
export type Branding = typeof DEFAULT_BRANDING;
export const FONTS = ['texta', 'system', 'serif'] as const;
const MAX_CHART_COLORS = 24;

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;
const GRADIENT_RE = /^linear-gradient\(\s*\d{1,3}deg\s*(,\s*#[0-9A-Fa-f]{6}\s+\d{1,3}%\s*){2,4}\)$/;
const MAX_LOGO = 300_000; // characters of data-URI (~200 KB file)

export function getBranding(): Branding {
  const c = loadConfig();
  return {
    name: c.name, fullName: c.fullName, tagline: c.tagline, logo: c.logo === 'snowflake-logo.svg' ? '' : (c.logo || ''),
    palette: { ...DEFAULT_BRANDING.palette, ...c.palette },
    darkBackground: { ...DEFAULT_BRANDING.darkBackground, ...c.darkBackground },
    lightBackground: { ...DEFAULT_BRANDING.lightBackground, ...c.lightBackground },
    status: { ...DEFAULT_BRANDING.status, ...c.status },
    workflowTypes: { ...DEFAULT_BRANDING.workflowTypes, ...c.workflowTypes },
    matchMethods: { ...DEFAULT_BRANDING.matchMethods, ...c.matchMethods },
    charts: { ...DEFAULT_BRANDING.charts, ...c.charts },
    typography: {
      font: c.typography?.font || DEFAULT_BRANDING.typography.font,
      dark: { ...DEFAULT_BRANDING.typography.dark, ...c.typography?.dark },
      light: { ...DEFAULT_BRANDING.typography.light, ...c.typography?.light },
    },
  };
}

/** Strips scripts, event handlers and external references from an SVG. Returns null if not an SVG. */
export function sanitizeSvg(svg: string): string | null {
  if (!/<svg[\s>]/i.test(svg)) return null;
  return svg
    .replace(/<script[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script[^>]*\/?>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|xlink:href)\s*=\s*("\s*(javascript|https?|data):[^"]*"|'\s*(javascript|https?|data):[^']*')/gi, '');
}

function normalizeLogo(logo: unknown): string {
  const v = String(logo ?? '').trim();
  if (!v) return '';
  if (v.length > MAX_LOGO) throw new Error('logo is too large (max ~200 KB)');
  if (/^https:\/\/[^\s"'<>]+$/i.test(v)) return v;
  if (/^[\w.-]+\.(svg|png)$/i.test(v)) return v; // file under /logos/
  const png = v.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (png) return v;
  const svg = v.match(/^data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)$/);
  if (svg) {
    const clean = sanitizeSvg(Buffer.from(svg[1], 'base64').toString('utf-8'));
    if (!clean) throw new Error('logo is not a valid SVG');
    return 'data:image/svg+xml;base64,' + Buffer.from(clean, 'utf-8').toString('base64');
  }
  throw new Error('logo must be an https URL or a PNG/SVG data URI');
}

function text(v: unknown, field: string, max: number): string {
  const s = String(v ?? '').trim();
  if (!s || s.length > max) throw new Error(`${field} must be 1-${max} characters`);
  return s;
}

function colors<T extends Record<string, string>>(cur: T, patch: unknown, group: string, gradients: string[] = []): T {
  if (patch == null) return cur;
  if (typeof patch !== 'object') throw new Error(`${group} must be an object`);
  const out = { ...cur };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (!(k in cur)) throw new Error(`unknown field ${group}.${k}`);
    const val = String(v).trim();
    if (gradients.includes(k) ? !GRADIENT_RE.test(val) : !HEX_RE.test(val)) {
      throw new Error(`${group}.${k} must be ${gradients.includes(k) ? 'a linear-gradient of #RRGGBB stops' : 'a #RRGGBB color'}`);
    }
    (out as Record<string, string>)[k] = val;
  }
  return out;
}

function charts(cur: Branding['charts'], patch: unknown): Branding['charts'] {
  if (patch == null) return cur;
  if (typeof patch !== 'object') throw new Error('charts must be an object');
  const p = patch as Record<string, unknown>;
  for (const k of Object.keys(p)) if (!['mode', 'colors', 'base'].includes(k)) throw new Error(`unknown field charts.${k}`);
  const out = { ...cur };
  if ('mode' in p) {
    if (p.mode !== 'categorical' && p.mode !== 'monochrome') throw new Error('charts.mode must be categorical or monochrome');
    out.mode = p.mode;
  }
  if ('colors' in p) {
    const list = p.colors;
    if (!Array.isArray(list) || list.length < 2 || list.length > MAX_CHART_COLORS) throw new Error(`charts.colors must list 2-${MAX_CHART_COLORS} colors`);
    out.colors = list.map((v, i) => {
      const c = String(v).trim();
      if (!HEX_RE.test(c)) throw new Error(`charts.colors[${i}] must be a #RRGGBB color`);
      return c;
    });
  }
  if ('base' in p) {
    const c = String(p.base).trim();
    if (!HEX_RE.test(c)) throw new Error('charts.base must be a #RRGGBB color');
    out.base = c;
  }
  return out;
}

function typography(cur: Branding['typography'], patch: unknown): Branding['typography'] {
  if (patch == null) return cur;
  if (typeof patch !== 'object') throw new Error('typography must be an object');
  const p = patch as Record<string, unknown>;
  for (const k of Object.keys(p)) if (!['font', 'dark', 'light'].includes(k)) throw new Error(`unknown field typography.${k}`);
  if ('font' in p && !(FONTS as readonly unknown[]).includes(p.font)) throw new Error(`typography.font must be one of ${FONTS.join(', ')}`);
  return {
    font: ('font' in p ? p.font : cur.font) as Branding['typography']['font'],
    dark: colors(cur.dark, p.dark, 'typography.dark'),
    light: colors(cur.light, p.light, 'typography.light'),
  };
}

/** Validates a partial branding patch and returns the merged result. Throws on invalid input. */
export function validateBranding(patch: Record<string, unknown>): Branding {
  const allowed = ['name', 'fullName', 'tagline', 'logo', 'palette', 'darkBackground', 'lightBackground', 'status', 'workflowTypes', 'matchMethods', 'charts', 'typography'];
  for (const k of Object.keys(patch)) if (!allowed.includes(k)) throw new Error(`unknown field ${k}`);
  const cur = getBranding();
  return {
    name: 'name' in patch ? text(patch.name, 'name', 40) : cur.name,
    fullName: 'fullName' in patch ? text(patch.fullName, 'fullName', 80) : cur.fullName,
    tagline: 'tagline' in patch ? text(patch.tagline, 'tagline', 160) : cur.tagline,
    logo: 'logo' in patch ? normalizeLogo(patch.logo) : cur.logo,
    palette: colors(cur.palette, patch.palette, 'palette'),
    darkBackground: colors(cur.darkBackground, patch.darkBackground, 'darkBackground', ['sidebarGradient']),
    lightBackground: colors(cur.lightBackground, patch.lightBackground, 'lightBackground', ['sidebarGradient']),
    status: colors(cur.status, patch.status, 'status'),
    workflowTypes: colors(cur.workflowTypes, patch.workflowTypes, 'workflowTypes'),
    matchMethods: colors(cur.matchMethods, patch.matchMethods, 'matchMethods'),
    charts: charts(cur.charts, patch.charts),
    typography: typography(cur.typography, patch.typography),
  };
}

export async function setBranding(b: Branding): Promise<Branding> {
  Object.assign(loadConfig(), b);
  await persistConfig();
  return getBranding();
}
