#!/usr/bin/env npx tsx
// ============================================================
// DDL Generator — reads config.json and generates the Postgres DDL for each module's full
// field catalog. Snowflake objects are not generated here: MDM_ANALYTICS.SYNC_MODULES
// (snowflake/008_modules.sql) builds them from the mirrored configuration.
//
// Usage:  npx tsx scripts/generate-ddl.ts [--module <id>]
//
// Outputs:
//   generated/pg_<module>.sql       — Postgres CREATE TABLE + indexes + triggers
// ============================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'data', process.env.DEMO_CUSTOMER || 'neutral', 'config.json');
const OUT_DIR = path.join(ROOT, 'generated');

interface FieldDef {
  name: string; label: string; type: string; group: string;
  required?: boolean; unique?: boolean; searchable?: boolean;
  trigram?: boolean; filterable?: boolean;
  ref_table?: string; ref_domain?: string;
  pg_type?: string; max_length?: number;
  active?: boolean; builtin?: boolean;
}

interface ModuleConfig {
  id: string; label: string; singular: string; table: string;
  name_field: string; country_scoped?: boolean;
  hierarchy?: { enabled: boolean; parent_field: string; type: string };
  fields: FieldDef[];
}

interface Config {
  snowflake: { database: string; mirrorDatabase: string; warehouse: string };
  modules: ModuleConfig[];
}

// ── Helpers ──────────────────────────────────────────────────

function pgType(f: FieldDef): string {
  if (f.pg_type) return f.pg_type;
  switch (f.type) {
    case 'text':    return f.max_length ? `VARCHAR(${f.max_length})` : 'TEXT';
    case 'number':  return 'NUMERIC';
    case 'boolean': return 'BOOLEAN';
    case 'date':    return 'DATE';
    case 'uuid':    return 'UUID';
    case 'ref':     return f.ref_table ? 'VARCHAR(3)' : 'VARCHAR(30)';
    case 'json':    return 'JSONB';
    default:        return 'TEXT';
  }
}

function pgColumn(f: FieldDef, tableName: string): string {
  let col = `    ${f.name.padEnd(20)} ${pgType(f)}`;
  if (f.required) col += ' NOT NULL';
  if (f.type === 'ref' && f.ref_table) col += ` REFERENCES ${f.ref_table}(code)`;
  if (f.type === 'uuid' && f.name.endsWith('_id')) {
    const parentTable = tableName;
    col += ` REFERENCES ${parentTable}(id)`;
  }
  return col;
}

// ── Postgres DDL ─────────────────────────────────────────────

function generatePostgresDDL(mod: ModuleConfig): string {
  const tbl = mod.table;
  const entity = mod.id.toUpperCase();
  const allBuiltinFields = mod.fields.filter(f => f.builtin !== false);

  const lines: string[] = [];
  lines.push(`-- ============================================================`);
  lines.push(`-- ${mod.label} — Postgres DDL (generated from config.json)`);
  lines.push(`-- ============================================================`);
  lines.push('');
  lines.push(`CREATE TABLE IF NOT EXISTS ${tbl} (`);
  lines.push(`    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),`);
  lines.push(`    golden_id       VARCHAR(40),`);
  lines.push(`    source_system   VARCHAR(40) NOT NULL,`);
  lines.push(`    source_id       VARCHAR(80) NOT NULL,`);
  lines.push(`    lifecycle_stage VARCHAR(30) NOT NULL DEFAULT 'DRAFT',`);
  lines.push('');

  // Group fields by group
  const groups = [...new Set(allBuiltinFields.map(f => f.group))];
  for (const group of groups) {
    lines.push(`    -- ${group.charAt(0).toUpperCase() + group.slice(1)}`);
    const gFields = allBuiltinFields.filter(f => f.group === group);
    for (const f of gFields) {
      // Skip parent_id if it's a self-referencing hierarchy (handled separately)
      if (f.name === 'parent_id' && mod.hierarchy?.type === 'self') continue;
      lines.push(pgColumn(f, tbl) + ',');
    }
    lines.push('');
  }

  // Hierarchy columns (if self-referencing)
  if (mod.hierarchy?.enabled && mod.hierarchy.type === 'self') {
    lines.push(`    -- Hierarchy`);
    lines.push(`    parent_id       UUID REFERENCES ${tbl}(id),`);
    lines.push(`    hierarchy_path  LTREE,`);
    lines.push(`    hierarchy_level INT,`);
    lines.push('');
  }

  // Standard MDM columns
  lines.push(`    -- Dynamic attributes (EAV overflow)`);
  lines.push(`    extended_attrs  JSONB NOT NULL DEFAULT '{}',`);
  lines.push('');
  lines.push(`    -- Data quality`);
  lines.push(`    dq_score        NUMERIC(5,2),`);
  lines.push(`    completeness    NUMERIC(5,2),`);
  lines.push(`    last_dq_check   TIMESTAMPTZ,`);
  lines.push('');
  lines.push(`    -- Metadata`);
  lines.push(`    created_by      VARCHAR(80) NOT NULL DEFAULT CURRENT_USER,`);
  lines.push(`    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),`);
  lines.push(`    updated_by      VARCHAR(80) NOT NULL DEFAULT CURRENT_USER,`);
  lines.push(`    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),`);
  lines.push(`    is_deleted      BOOLEAN NOT NULL DEFAULT FALSE,`);
  lines.push('');
  lines.push(`    UNIQUE(source_system, source_id)`);
  lines.push(`);`);
  lines.push('');

  // Indexes
  lines.push(`-- Indexes`);
  lines.push(`CREATE INDEX IF NOT EXISTS idx_${mod.id}_golden ON ${tbl}(golden_id);`);
  lines.push(`CREATE INDEX IF NOT EXISTS idx_${mod.id}_lifecycle ON ${tbl}(lifecycle_stage);`);
  lines.push(`CREATE INDEX IF NOT EXISTS idx_${mod.id}_dq ON ${tbl}(dq_score);`);

  for (const f of allBuiltinFields) {
    if (f.trigram) {
      lines.push(`CREATE INDEX IF NOT EXISTS idx_${mod.id}_${f.name}_trgm ON ${tbl} USING gin(${f.name} gin_trgm_ops);`);
    }
    if (f.filterable) {
      lines.push(`CREATE INDEX IF NOT EXISTS idx_${mod.id}_${f.name} ON ${tbl}(${f.name});`);
    }
    if (f.unique) {
      lines.push(`CREATE UNIQUE INDEX IF NOT EXISTS idx_${mod.id}_${f.name}_uniq ON ${tbl}(${f.name}) WHERE ${f.name} IS NOT NULL;`);
    }
  }

  if (mod.country_scoped) {
    lines.push(`CREATE INDEX IF NOT EXISTS idx_${mod.id}_country ON ${tbl}(country_code);`);
  }
  if (mod.hierarchy?.type === 'self') {
    lines.push(`CREATE INDEX IF NOT EXISTS idx_${mod.id}_hierarchy ON ${tbl} USING gist(hierarchy_path);`);
    lines.push(`CREATE INDEX IF NOT EXISTS idx_${mod.id}_parent ON ${tbl}(parent_id);`);
  }

  lines.push('');

  // Audit trigger
  lines.push(`-- Audit trigger`);
  lines.push(`CREATE TRIGGER trg_${mod.id}_audit`);
  lines.push(`    AFTER INSERT OR UPDATE OR DELETE ON ${tbl}`);
  lines.push(`    FOR EACH ROW EXECUTE FUNCTION mdm.fn_audit_trigger('${entity}');`);
  lines.push('');

  // Auto-update trigger
  lines.push(`-- Auto-update timestamp`);
  lines.push(`CREATE TRIGGER trg_${mod.id}_updated`);
  lines.push(`    BEFORE UPDATE ON ${tbl}`);
  lines.push(`    FOR EACH ROW EXECUTE FUNCTION mdm.fn_set_updated_at();`);
  lines.push('');

  // Hierarchy trigger
  if (mod.hierarchy?.enabled && mod.hierarchy.type === 'self') {
    lines.push(`-- Hierarchy path trigger`);
    lines.push(`CREATE TRIGGER trg_${mod.id}_hierarchy`);
    lines.push(`    BEFORE INSERT OR UPDATE OF parent_id ON ${tbl}`);
    lines.push(`    FOR EACH ROW EXECUTE FUNCTION mdm.fn_update_hierarchy_path();`);
    lines.push('');
  }

  return lines.join('\n');
}

// ── Main ─────────────────────────────────────────────────────

const config: Config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
const targetModule = process.argv.find((_, i, a) => a[i - 1] === '--module');

fs.mkdirSync(OUT_DIR, { recursive: true });

const modules = targetModule
  ? config.modules.filter(m => m.id === targetModule)
  : config.modules;

if (modules.length === 0) {
  console.error(`Module "${targetModule}" not found`);
  process.exit(1);
}

for (const mod of modules) {
  const pgPath = path.join(OUT_DIR, `pg_${mod.id}.sql`);

  fs.writeFileSync(pgPath, generatePostgresDDL(mod), 'utf-8');

  const total = mod.fields.filter(f => f.builtin !== false).length;
  console.log(`${mod.id}: ${total} builtin fields → ${pgPath}`);
}

console.log('\nDone. Review generated/ folder before applying.');
