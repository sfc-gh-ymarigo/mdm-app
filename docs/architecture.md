# Architecture

## In one picture

```
            Browser (React UI)
                  │  /api/*  (identity: SPCS ingress header, or x-mdm-user in dev)
                  ▼
      ┌──────────────────────────┐       Cortex Analyst / Cortex AI
      │  mdm-api (Express, TS)   │──────────────────────────────┐
      │  identity → PII guard →  │                              │
      │  routes                  │                              ▼
      └──────────┬───────────────┘               ┌─────────────────────────────┐
                 │ two pools                     │ Snowflake                   │
                 │  mdm_app (RLS enforced)       │  <DB>_MIRROR.MDM  raw CDC   │
                 │  snowflake_admin (jobs)       │  <DB>.MDM_ANALYTICS views,  │
                 ▼                               │     history DTs, semantic   │
      ┌──────────────────────────┐   CDC mirror  │  <DB>.GOVERNANCE policies   │
      │ Snowflake Postgres       │──────────────▶│  <DB>.PUBLISH golden records│
      │ schema mdm (system of    │  (1 min)      │  <DB>.MDM_AI alert log      │
      │ record, all writes)      │               └─────────────────────────────┘
      └──────────────────────────┘
```

**Postgres is the system of record.** Every edit, merge, workflow step and DQ result is written there, in
transactions, with row-level security. **Snowflake is the read side**: analytics, AI, governance and
distribution, fed by the managed CDC mirror.

## Postgres (`schema mdm`)

- **Entities**: one table per module (`customer`, `product`, `supplier`), with system columns
  (`golden_id`, `lifecycle_stage`, `dq_score`, `completeness`, `is_deleted`, audit columns) plus the module's fields.
- **Triggers** do the bookkeeping: audit log, `updated_at`, golden ID assignment, hierarchy path, automatic
  onboarding workflow on insert, tombstones on hard delete (`deleted_record`).
- **Row-level security**: the app connects as `mdm_app`; `app.current_user` is set per request, and policies
  restrict rows to the user's country scope and modules. System jobs use the admin pool.
- **Configuration** lives in `app_config` (versioned), seeded from `data/<customer>/config.json`.
- **Migrations**: `postgres/NNN_*.sql`, applied by `mdm-api/src/migrate.ts` under an advisory lock, checksummed.

## API (`mdm-api`)

Request pipeline (`src/app.ts`): security headers (helmet) and a 1 MB body limit → **identity** (resolves the MDM user) →
**PII guard** (masks PII fields in responses and drops PII writes for users whose Snowflake role cannot
see PII) → routes.

| Area | Where |
|---|---|
| CRUD for every module | `src/modules/entityRouter.ts` (config-driven: fields, joins, country scope, hierarchy-change workflow) |
| Matching (fuzzy, phonetic, composite, embeddings, LLM judge) and merge/unmerge | `routes/matches.ts`, `src/matching.ts` |
| Data quality rules, templates, runs | `routes/dq.ts`, `src/dq-templates.ts` |
| Workflows (lifecycle transitions per module) | `routes/workflows.ts` |
| Golden records, stewardship, audit, notifications | `routes/golden.ts`, `stewardship.ts`, `audit.ts`, `notifications.ts` |
| Configuration, security, replication, health | `routes/admin.ts` |
| Cortex Analyst proxy, AI suggestions/translation | `routes/analyst.ts`, `routes/ai.ts` |

## Snowflake

| Layer | Objects |
|---|---|
| Raw | `<DB>_MIRROR.MDM.<table>` (one row per version), `<table>$CHANGES`, `<table>$LIVE` — owned by the mirror |
| Current state | `MDM_ANALYTICS.V_CURRENT_*`: latest version per id, tombstoned deletes removed |
| History | `<TABLE>_HISTORY` dynamic table per module (SCD2, `valid_from` / `valid_to`) |
| Analytics / AI | `V_<TABLE>_360` views, `V_MDM_KPIS`, semantic view `MDM_ANALYTICS_VIEW` for Cortex Analyst |
| Governance | Row access policies keyed on the caller's role (`V_ROLE_SCOPE`, mirrored from `app_user.sf_role`), `PII_TYPE` tag with a tag-based masking policy |
| Distribution | `PUBLISH` secure views (golden records + cross-reference), optional share |
| Operations | Freshness/volume DMFs, serverless mirror health task → `MDM_AI.ALERT_LOG` → bell |

**Generated from the configuration.** Module objects (current view, history, row access policy,
PII tags, DMFs, PUBLISH views, 360 view, KPIs, semantic view) are built by
`MDM_ANALYTICS.SYNC_MODULES` from the configuration mirrored in `APP_CONFIG`. The API calls it after
each module or field change, so enabling a module or adding a field reaches Snowflake without a
script.

**One access model.** Each MDM user maps to a Snowflake role. That role's country scope drives the row
access policies, and the PII unmask roles drive both the Snowflake masking policy and the app's PII guard.
A user therefore sees the same rows and the same masked fields in the app and in Cortex Analyst.

## Modules

A module is a block in the configuration: table, fields (type, group, reference domain, labels per
language), search, filters, matching stages, hierarchy, DQ templates. The API routes, the UI pages, the
Snowflake views and policies are all generated from it. Adding a module means a migration for its table and
a configuration block; `scripts/generate-ddl.ts` writes the matching Postgres/Snowflake DDL.
