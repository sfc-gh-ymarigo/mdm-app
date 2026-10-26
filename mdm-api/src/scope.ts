// Country-scope helpers shared by all routes.
// Postgres RLS (mdm.scope_allows) is the enforcement backstop; these give clear
// 400/403 responses and keep queries that run on the admin pool scoped too.
import type { AppUser } from './db.js';
import { getModule, getCountries, isEnabled } from './config.js';

// Modules whose country_code may be NULL ("all markets") and still be visible to scoped users.
const NULL_OK_MODULES = new Set(['product']);

export function isCountryScoped(moduleId: string): boolean {
  return !!getModule(moduleId)?.country_scoped;
}

/** Country list the user is restricted to for this module, or null when unrestricted. */
export function effectiveScope(appUser: AppUser, moduleId: string): string[] | null {
  if (!isCountryScoped(moduleId)) return null;
  return appUser.country_scope;
}

/**
 * SQL predicate restricting `col` to the user's scope for a module, or '' when unrestricted.
 * Pushes the scope array onto params.
 */
export function scopeClause(appUser: AppUser, moduleId: string, col: string, params: unknown[]): string {
  const scope = effectiveScope(appUser, moduleId);
  if (scope === null) return '';
  params.push(scope);
  const p = `$${params.length}`;
  return NULL_OK_MODULES.has(moduleId) ? `(${col} IS NULL OR ${col} = ANY(${p}))` : `${col} = ANY(${p})`;
}

export function activeCountryCodes(): string[] {
  return getCountries().filter(isEnabled).map(c => c.code.toUpperCase());
}

/**
 * Validate a country_code being written for a module.
 * Returns an HTTP error (400 not an active operating country, 403 outside scope) or null.
 */
export function checkWriteCountry(appUser: AppUser, moduleId: string, country: unknown): { status: number; error: string } | null {
  const code = country == null || country === '' ? null : String(country).toUpperCase();
  const active = activeCountryCodes();
  if (code !== null && active.length > 0 && !active.includes(code)) {
    return { status: 400, error: `Country ${code} is not an active operating country (${active.join(', ')})` };
  }
  const scope = effectiveScope(appUser, moduleId);
  if (scope === null) return null;
  if (code === null) {
    return NULL_OK_MODULES.has(moduleId) ? null : { status: 403, error: 'Country is required for your country scope' };
  }
  if (!scope.includes(code)) {
    return { status: 403, error: `Country ${code} is outside your scope (${scope.join(', ') || 'none'})` };
  }
  return null;
}

/** True when a write actually changes country_code (unchanged legacy values are not re-validated). */
export function countryChanged(current: unknown, next: unknown): boolean {
  const norm = (v: unknown) => (v == null || v === '' ? '' : String(v).toUpperCase());
  return norm(current) !== norm(next);
}

/** Validate user country_scope codes against configured operating countries (active or not). */
export function checkScopeCodes(scope: unknown): string | null {
  if (scope == null) return null;
  if (!Array.isArray(scope)) return 'country_scope must be an array of country codes or null';
  const known = getCountries().map(c => c.code.toUpperCase());
  if (known.length === 0) return null;
  const bad = scope.map(s => String(s).toUpperCase()).filter(s => !known.includes(s));
  return bad.length ? `Unknown operating countries in scope: ${bad.join(', ')}` : null;
}

// Columns only the system may write: lifecycle via workflows and bulk stage changes, scores via DQ,
// identity and audit columns by triggers. Record create/update silently drops them.
export const PROTECTED_COLUMNS = new Set(['id', 'golden_id', 'lifecycle_stage', 'dq_score', 'completeness', 'last_dq_check',
  'hierarchy_path', 'hierarchy_level', 'is_deleted', 'created_by', 'created_at', 'updated_by', 'updated_at']);

/** Adds `ignored_fields` to the next JSON object response (only when something was dropped). */
export function reportIgnored(res: import('express').Response, ignored: string[]) {
  if (!ignored.length) return;
  const json = res.json.bind(res);
  res.json = (body: unknown) => json(body && typeof body === 'object' && !Array.isArray(body) ? { ...body, ignored_fields: ignored } : body);
}

// Entity tables that exist in Postgres (supplier is optional); filled by initScope().
let entityTables: Record<string, string> = { CUSTOMER: 'mdm.customer', PRODUCT: 'mdm.product' };

/**
 * Predicate keeping rows of side tables (audit_log, workflow_instance, dq_result, ...) whose
 * referenced entity is visible to the current user. Must run on a withUser/userDb connection:
 * the EXISTS sub-selects are filtered by Postgres RLS.
 */
export function visibleEntity(typeCol: string, idCol: string): string {
  const known = Object.keys(entityTables).map(t => `'${t}'`).join(',');
  const checks = Object.entries(entityTables)
    .map(([type, tbl]) => `(${typeCol} = '${type}' AND EXISTS (SELECT 1 FROM ${tbl} x WHERE x.id = ${idCol}))`);
  return `(${typeCol} NOT IN (${known}) OR ${checks.join(' OR ')})`;
}

/** Discover optional entity tables and mirror module scope toggles into mdm.module_scope. */
export async function initScope(): Promise<void> {
  const { default: pool } = await import('./db.js');
  const { getModules } = await import('./config.js');
  const tables: Record<string, string> = {};
  for (const m of getModules()) {
    const exists = (await pool.query('SELECT to_regclass($1) IS NOT NULL AS ok', [m.table])).rows[0]?.ok;
    if (exists) tables[m.id.toUpperCase()] = m.table;
  }
  if (Object.keys(tables).length) entityTables = tables;
  for (const m of getModules()) await syncModuleScope(m.id);
}

/** Push one module's Country Scope toggle to Postgres so RLS policies follow it. */
export async function syncModuleScope(moduleId: string): Promise<void> {
  const { default: pool } = await import('./db.js');
  const mod = getModule(moduleId);
  if (!mod) return;
  await pool.query(
    `INSERT INTO mdm.module_scope (module_id, table_name, country_scoped) VALUES ($1, $2, $3)
     ON CONFLICT (module_id) DO UPDATE SET table_name = EXCLUDED.table_name, country_scoped = EXCLUDED.country_scoped`,
    [mod.id, mod.table, !!mod.country_scoped]
  );
}
