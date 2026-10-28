# MDM on Snowflake — Installation Guide

## Prerequisites

| Tool | Version | Check |
|---|---|---|
| Node.js | >= 18 | `node -v` |
| Snowflake CLI | latest | `snow --version` |
| openssl | any | `openssl version` |
| Snowflake account | a CLI connection whose user can use ACCOUNTADMIN | `snow connection test -c <name>` |

Snowflake Postgres mirroring is available on AWS and Azure only.

## Quick start

```bash
./setup.sh
```

The script asks for the Snowflake CLI connection, the MDM database name (default `MDM`) and the warehouse
(default `MDM_WH`). Every other name derives from the database:

| Object | Name |
|---|---|
| Postgres instance | `<DB>_PG` |
| CDC mirror / target database | `<db>_mirror` → `<DB>_MIRROR` |
| Analytics, governance, published data | `<DB>.MDM_ANALYTICS`, `<DB>.GOVERNANCE`, `<DB>.PUBLISH`, `<DB>.MDM_AI` |

Optional environment variables: `DEMO_CUSTOMER` (configuration under `data/<name>/config.json`, default
`neutral`), `MIRROR_REFRESH` (default `1 minute`), `CREDIT_QUOTA` (monthly credits for the warehouse
resource monitor, default `50`), `DMF_SCHEDULE` (default `60 MINUTE`), `PG_ALLOWED_CIDR` (IPv4 CIDRs allowed
to reach Postgres, comma-separated, default this machine's public IP as `/32`), `PG_PASSWORD_PG` (`snowflake_admin`
password of an instance created outside the script; skips the prompt).

Steps the script runs:

1. **Configuration**: checks the CLI connection and collects names.
2. **Postgres**: creates the instance, applies the migrations (`postgres/NNN_*.sql`), maps your Snowflake
   login to the bootstrap MDM admin, sets the `mdm_app` password and stores both passwords in `~/.pgpass`.
   A new instance accepts no connection until it has a network policy: the script creates the network rule
   `<DB>.MDM_APP.<PG>_INGRESS` (mode `POSTGRES_INGRESS`, value `PG_ALLOWED_CIDR`) and the policy `<PG>_POLICY`,
   and attaches it to the instance.
3. **Snowflake objects**: database, warehouse and resource monitor, roles (`snowflake/001`), the CDC mirror,
   then `snowflake/002`–`008`. The script waits until every `mdm` table is mirrored before running `002`.
   The first `SYNC_MODULES` run (in `008`) returns `pending: configuration not mirrored yet`: the module
   configuration is written to `mdm.app_config` when the API starts for the first time (see "After the first
   start").
4. **RBAC**: grants the MDM roles.
5. **Application**: installs npm dependencies and writes `mdm-api/.env.local` (no secrets).

The script never asks for a Snowflake password.

## Manual setup

Use this when the script cannot run end to end, or to re-apply one layer.

### 1. Postgres instance

```sql
CREATE POSTGRES INSTANCE MDM_PG
  COMPUTE_FAMILY = 'STANDARD_M' STORAGE_SIZE_GB = 50
  AUTHENTICATION_AUTHORITY = POSTGRES POSTGRES_VERSION = 17;
SHOW POSTGRES INSTANCES;   -- note the host; the admin password is shown once at creation

-- Allow connections (none are accepted without a network policy)
CREATE DATABASE IF NOT EXISTS MDM;
CREATE SCHEMA IF NOT EXISTS MDM.MDM_APP;
CREATE NETWORK RULE MDM.MDM_APP.MDM_PG_INGRESS TYPE = IPV4 MODE = POSTGRES_INGRESS
  VALUE_LIST = ('<your public IP>/32');
CREATE NETWORK POLICY MDM_PG_POLICY ALLOWED_NETWORK_RULE_LIST = ('MDM.MDM_APP.MDM_PG_INGRESS');
ALTER POSTGRES INSTANCE MDM_PG SET NETWORK_POLICY = 'MDM_PG_POLICY';
```

### 2. Migrations

```bash
cd mdm-api && npm install
# PG_HOST in mdm-api/.env.local, passwords for snowflake_admin / mdm_app in ~/.pgpass
bash start-dev.sh migrate up      # or: npm run migrate -- up | status
```

Migrations are versioned and checksummed in `mdm.schema_migrations`: never edit an applied file, add a new one.
Sample data: `node reset_demo.cjs` (resets entity data).

### 3. CDC mirror

```sql
USE ROLE ACCOUNTADMIN;
GRANT APPLICATION ROLE snowflake.postgres_mirror_admin TO ROLE ACCOUNTADMIN;
GRANT USAGE ON POSTGRES INSTANCE MDM_PG TO APPLICATION snowflake;
CALL SNOWFLAKE.POSTGRES.CREATE_MIRROR(
  mirror_name => 'mdm_mirror', postgres_instance => 'MDM_PG', postgres_database => 'postgres',
  target_database => 'MDM_MIRROR', postgres_tables => NULL, postgres_schemas => ['mdm'],
  refresh_interval => '1 minute');
```

The mirror tracks the whole `mdm` schema, so tables added by later migrations are mirrored automatically.

### 4. Snowflake objects

The scripts are templates: names are passed as `snow sql -D` variables.

```bash
VARS=(-D database=MDM -D mirror_database=MDM_MIRROR -D mirror_name=mdm_mirror -D warehouse=MDM_WH
      -D postgres_instance=MDM_PG -D credit_quota=50 -D dmf_schedule='60 MINUTE')
for f in snowflake/00{1..8}_*.sql; do snow sql -c <connection> -f "$f" "${VARS[@]}"; done
```

| Script | Creates |
|---|---|
| `001_roles_warehouse.sql` | Database, schemas, warehouse + resource monitor, MDM roles |
| `002_current_and_history.sql` | `V_CURRENT_*` views of the shared tables (workflows, audit, DQ, reference data) |
| `003_analytics.sql` | DQ scorecard view |
| `004_governance.sql` | Row access policies (country/entity scope), PII tag + masking policy, `SET_PII_COLUMNS` |
| `005_publish.sql` | `PUBLISH` schema and consumer grants |
| `006_dq_dmfs.sql` | Grant to read data metric results |
| `007_cortex_ai.sql` | Mirror health task + `ALERT_LOG`, mirror status procedures |
| `008_modules.sql` | `SYNC_MODULES` procedure and its first run: per-module views, history, policies, DMFs, `PUBLISH` views, 360 views, KPIs and the semantic view |

Module objects are rebuilt by `MDM_ANALYTICS.SYNC_MODULES`, which the API calls after every module or field change (see `docs/operations.md`, "Module objects"). Re-running `002` or `004` by hand is safe; finish with `CALL <DB>.MDM_ANALYTICS.SYNC_MODULES(0);`.
See `docs/operations.md` for day-2 operations.

### 5. Run locally

`mdm-api/.env.local` (gitignored, written by `setup.sh`):

```bash
PG_HOST=<postgres host>
SNOWFLAKE_ACCOUNT=<org>-<account>
MDM_DATABASE=MDM          # mirror, Postgres instance and semantic view names derive from it
MDM_WAREHOUSE=MDM_WH
SF_USER=MDM_SVC           # Snowflake auth for the API: key pair or PAT
SF_PRIVATE_KEY_PATH=~/.snowflake/keys/mdm_svc.p8
# SF_PAT=...
```

```bash
bash mdm-api/start-dev.sh   # API on :3001, dev auth (user switcher)
cd mdm-ui && npm run dev    # UI on http://localhost:3000
```

#### After the first start

On a fresh install, start the API once, wait for the next mirror refresh, then build the module objects:

```sql
CALL MDM.MDM_ANALYTICS.SYNC_MODULES(0);   -- per-module views, policies, DMFs, PUBLISH views, semantic view
```

Afterwards the API calls it on every module or field change.

To reach Postgres from another network, add its address to the ingress rule:

```sql
ALTER NETWORK RULE MDM.MDM_APP.MDM_PG_INGRESS SET VALUE_LIST = ('203.0.113.4/32', '198.51.100.0/24');
```

Tests: `cd mdm-api && npm test` (creates and drops a throwaway database), `cd mdm-ui && npx vitest run`.

### Authentication

| Mode | When | Identity |
|---|---|---|
| `spcs` | Running in Snowpark Container Services | `Sf-Context-Current-User` ingress header, mapped to `mdm.app_user.sf_user` |
| `dev` | `MDM_DEV_AUTH=1` (set by `start-dev.sh`) | `x-mdm-user` header from the UI user switcher |
| `none` | Neither | All API calls return 401 |

Map Snowflake logins and roles to MDM users in Configuration → Security → Users. The user's Snowflake role
(`sf_role`) drives row access and PII masking in Snowflake, and the app applies the same PII rule.

### 6. Deploy to Snowpark Container Services

See `deploy/`: `setup_spcs.sql` (one-time objects), `deploy.sh` (build, push, create or upgrade the service),
`mdm-service.yaml` (service spec), `share_publish.sql` (share the `PUBLISH` schema).

## Project structure

```
.
├── setup.sh                     # Installer (see above)
├── reset_demo.cjs               # Reload the sample data
├── data/<customer>/config.json  # Branding, users, modules (fields, matching, hierarchy, DQ), Snowflake settings
├── postgres/NNN_*.sql           # Versioned migrations; postgres/seed/ holds sample data
├── snowflake/00N_*.sql          # Snowflake layer (templates, see table above)
├── deploy/                      # SPCS and sharing
├── docs/operations.md           # Runbook
├── mdm-api/                     # Express + TypeScript API
│   ├── src/app.ts               # Middleware (identity, PII guard) and route mounting, /api/config
│   ├── src/modules/             # Generic entity router (CRUD for every module)
│   ├── src/routes/              # Matching, DQ, workflows, golden records, admin, notifications, Analyst …
│   ├── src/pii.ts               # PII masking rule shared with Snowflake
│   ├── src/migrate.ts           # Migration runner
│   └── test/                    # API tests (vitest)
└── mdm-ui/                      # React + Vite + MUI
    └── src/pages, components, locales (en, fr)
```

## Customization

Copy `data/neutral/config.json` to `data/<name>/config.json`, edit it (name, logo, palette, users, modules,
Snowflake settings), add the logo under `mdm-ui/public/logos/`, and start with `DEMO_CUSTOMER=<name>`.
Most module settings (fields, DQ templates, matching, lifecycle) can also be changed at runtime in
Configuration; changes are stored in Postgres and versioned.
