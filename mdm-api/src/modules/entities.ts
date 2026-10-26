// ============================================================
// Entity resolution — one place that maps an entity type
// ('CUSTOMER', 'PRODUCT', 'SUPPLIER', …) to its module config.
// Unknown types are an error, never a silent fallback to another table.
// ============================================================
import { getModules, getEnabledModules } from '../config.js';
import type { ModuleConfig } from './types.js';

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export interface EntityInfo {
  type: string;            // 'CUSTOMER'
  moduleId: string;        // 'customer'
  table: string;           // 'mdm.customer'
  nameCol: string;         // 'legal_name'
  countryScoped: boolean;  // has a country_code column under the country-scope toggle
  hasCountry: boolean;     // table has an active country_code field
  goldenPrefix: string;    // 'GC'
  parentField: string | null;
  mod: ModuleConfig;
}

const TABLE_RE = /^mdm\.[a-z_][a-z0-9_]*$/;
const IDENT_RE = /^[a-z_][a-z0-9_]*$/;

export function goldenPrefix(mod: ModuleConfig): string {
  return (mod.golden_prefix || `G${mod.id[0]}`).toUpperCase();
}

function toInfo(mod: ModuleConfig): EntityInfo {
  if (!TABLE_RE.test(mod.table) || !IDENT_RE.test(mod.name_field)) {
    throw new HttpError(500, `Module ${mod.id} has an invalid table or name field`);
  }
  const hasCountry = mod.fields.some(f => f.name === 'country_code' && f.active !== false);
  const parent = mod.hierarchy?.enabled && mod.hierarchy.type === 'self' ? mod.hierarchy.parent_field : null;
  return {
    type: mod.id.toUpperCase(),
    moduleId: mod.id,
    table: mod.table,
    nameCol: mod.name_field,
    countryScoped: hasCountry && mod.country_scoped === true,
    hasCountry,
    goldenPrefix: goldenPrefix(mod),
    parentField: parent && IDENT_RE.test(parent) ? parent : null,
    mod,
  };
}

/** Resolve an entity type or module id. Throws 400 for unknown/disabled types. */
export function entityInfo(type: unknown, opts: { includeDisabled?: boolean } = {}): EntityInfo {
  const id = String(type ?? '').toLowerCase();
  const mod = (opts.includeDisabled ? getModules() : getEnabledModules()).find(m => m.id === id);
  if (!mod) throw new HttpError(400, `Unknown entity type: ${String(type ?? '')}`);
  return toInfo(mod);
}

/** All enabled entity modules. */
export function enabledEntities(): EntityInfo[] {
  return getEnabledModules().map(toInfo);
}

/** SQL expression giving the display name (or `col`) of (typeCol, idCol) across enabled modules. */
export function entityNameSql(typeCol: string, idCol: string, col?: 'dq_score' | 'golden_id'): string {
  const ents = enabledEntities();
  if (!ents.length) return 'NULL';
  return `CASE ${typeCol} ${ents.map(e =>
    `WHEN '${e.type}' THEN (SELECT ${col ? `x.${col}` : `x.${e.nameCol}::text`} FROM ${e.table} x WHERE x.id = ${idCol})`).join(' ')} END`;
}
