#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# MDM — Setup Script
# Creates everything needed to run the MDM on a Snowflake account.
# Snowflake access goes through a Snowflake CLI connection (snow connection add);
# no Snowflake password is prompted for or stored.
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

banner() { echo -e "\n${CYAN}══════════════════════════════════════════════════════════${NC}"; echo -e "${CYAN}  $1${NC}"; echo -e "${CYAN}══════════════════════════════════════════════════════════${NC}\n"; }
ok()     { echo -e "  ${GREEN}✓${NC} $1"; }
warn()   { echo -e "  ${YELLOW}⚠${NC} $1"; }
fail()   { echo -e "  ${RED}✗${NC} $1"; exit 1; }
upper()  { echo "$1" | tr '[:lower:]' '[:upper:]'; }
lower()  { echo "$1" | tr '[:upper:]' '[:lower:]'; }

# ============================================================================
# 0. Pre-flight checks
# ============================================================================
banner "MDM Setup"

echo "This script will:"
echo "  1. Create a Snowflake Postgres instance"
echo "  2. Run schema migrations and seed sample data"
echo "  3. Configure CDC mirroring to Snowflake"
echo "  4. Create Snowflake objects (roles, SCD layer, semantic view, agent)"
echo "  5. Install npm dependencies and write mdm-api/.env.local"
echo ""

command -v node >/dev/null 2>&1 || fail "Node.js is required. Install from https://nodejs.org"
command -v snow >/dev/null 2>&1 || fail "Snowflake CLI (snow) is required. Install: pip install snowflake-cli"
command -v openssl >/dev/null 2>&1 || fail "openssl is required"

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
[[ "$NODE_VERSION" -ge 18 ]] || fail "Node.js >= 18 required (found $(node -v))"
ok "Node.js $(node -v)"
ok "Snowflake CLI $(snow --version 2>/dev/null | head -1)"

# ============================================================================
# 1. Collect configuration
# ============================================================================
banner "Step 1/5 — Configuration"

CONFIG_DIR="$SCRIPT_DIR/data"
DEMO_CUSTOMER="${DEMO_CUSTOMER:-neutral}"
[[ -f "$CONFIG_DIR/$DEMO_CUSTOMER/config.json" ]] || fail "No config at $CONFIG_DIR/$DEMO_CUSTOMER/config.json"
DEMO_NAME=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$CONFIG_DIR/$DEMO_CUSTOMER/config.json','utf8')).name)")
ok "Configuration: $DEMO_NAME ($DEMO_CUSTOMER)"

read -rp "  Snowflake CLI connection name (default: ${SNOW_CONNECTION:-default}): " IN; SNOW_CONNECTION="${IN:-${SNOW_CONNECTION:-default}}"
snowc() { snow sql -c "$SNOW_CONNECTION" "$@"; }
snowc -q "SELECT 1" >/dev/null || fail "Snowflake CLI connection '$SNOW_CONNECTION' does not work (snow connection test -c $SNOW_CONNECTION)"

SF_ACCOUNT=$(snowc -q "SELECT CURRENT_ORGANIZATION_NAME() || '-' || CURRENT_ACCOUNT_NAME() AS A" --format JSON | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8'))[0].A)")
SF_LOGIN=$(snowc -q "SELECT CURRENT_USER() AS U" --format JSON | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8'))[0].U)")
ok "Snowflake account $SF_ACCOUNT as $SF_LOGIN"

read -rp "  Snowflake database for MDM objects (default: MDM): " IN; MDM_DATABASE=$(upper "${IN:-MDM}")
read -rp "  Warehouse (default: MDM_WH): " IN; MDM_WAREHOUSE=$(upper "${IN:-MDM_WH}")
MDM_MIRROR_DATABASE="${MDM_DATABASE}_MIRROR"
MDM_MIRROR_NAME=$(lower "$MDM_MIRROR_DATABASE")
[[ "$MDM_DATABASE" =~ ^[A-Z_][A-Z0-9_]*$ && "$MDM_WAREHOUSE" =~ ^[A-Z_][A-Z0-9_]*$ ]] || fail "Names must be plain identifiers"

# Variables substituted into snowflake/*.sql (<% name %> placeholders)
MIRROR_REFRESH="${MIRROR_REFRESH:-1 minute}"      # CDC mirror refresh interval
CREDIT_QUOTA="${CREDIT_QUOTA:-50}"                # monthly credits for the MDM warehouse resource monitor
DMF_SCHEDULE="${DMF_SCHEDULE:-60 MINUTE}"         # freshness/volume DMF schedule (006)
[[ "$MIRROR_REFRESH" =~ ^[0-9]+\ (minute|minutes|hour|hours)$ && "$CREDIT_QUOTA" =~ ^[0-9]+$ ]] || fail "MIRROR_REFRESH must look like '5 minutes'; CREDIT_QUOTA must be a number"
SQL_VARS=(-D "database=$MDM_DATABASE" -D "mirror_database=$MDM_MIRROR_DATABASE" -D "mirror_name=$MDM_MIRROR_NAME" -D "warehouse=$MDM_WAREHOUSE" -D "credit_quota=$CREDIT_QUOTA" -D "dmf_schedule=$DMF_SCHEDULE")

echo ""
read -rp "  Create NEW Postgres instance? (y/n, default: y): " CREATE_PG
CREATE_PG="${CREATE_PG:-y}"
PG_INSTANCE="${MDM_DATABASE}_PG"

if [[ "$CREATE_PG" == "y" ]]; then
  read -rp "  Postgres instance name (default: $PG_INSTANCE): " IN; PG_INSTANCE=$(upper "${IN:-$PG_INSTANCE}")
  echo -e "  ${YELLOW}Creating Postgres instance '$PG_INSTANCE' (2-5 minutes)...${NC}"
  # CREATE prints the snowflake_admin credentials once — note them, they are asked for below.
  snowc -q "CREATE POSTGRES INSTANCE IF NOT EXISTS $PG_INSTANCE COMPUTE_FAMILY = 'STANDARD_M' STORAGE_SIZE_GB = 50 AUTHENTICATION_AUTHORITY = POSTGRES POSTGRES_VERSION = 17" \
    || fail "Failed to create Postgres instance"

  echo -n "  Waiting for instance to be READY."
  STATUS=UNKNOWN
  for i in $(seq 1 60); do
    STATUS=$(snowc -q "SHOW POSTGRES INSTANCES LIKE '$PG_INSTANCE'" --format JSON 2>/dev/null | node -e "
      const d = JSON.parse(require('fs').readFileSync(0,'utf8'));
      const row = d.find(r => r.name && r.name.toUpperCase() === '$PG_INSTANCE');
      console.log(row ? row.state || row.status || 'UNKNOWN' : 'NOT_FOUND');" 2>/dev/null || echo UNKNOWN)
    [[ "$STATUS" == "READY" ]] && { echo ""; ok "Postgres instance $PG_INSTANCE is READY"; break; }
    echo -n "."; sleep 10
  done
  [[ "$STATUS" == "READY" ]] || fail "Timeout waiting for Postgres instance"

  PG_HOST=$(snowc -q "SHOW POSTGRES INSTANCES LIKE '$PG_INSTANCE'" --format JSON 2>/dev/null | node -e "
    const d = JSON.parse(require('fs').readFileSync(0,'utf8'));
    const row = d.find(r => r.name && r.name.toUpperCase() === '$PG_INSTANCE');
    console.log(row ? row.host || '' : '');" 2>/dev/null)
  [[ -n "$PG_HOST" ]] || fail "Could not retrieve Postgres host"
  ok "Postgres host: $PG_HOST"
  [[ -n "${PG_PASSWORD_PG:-}" ]] || { read -rsp "  snowflake_admin password (shown once when the instance was created): " PG_PASSWORD_PG; echo ""; }
else
  read -rp "  Existing Postgres instance name (default: $PG_INSTANCE): " IN; PG_INSTANCE=$(upper "${IN:-$PG_INSTANCE}")
  read -rp "  Postgres host: " PG_HOST
  read -rsp "  snowflake_admin password: " PG_PASSWORD_PG; echo ""
fi

# A new instance accepts no inbound connections until a network policy allows them.
# Default: this machine's public IP only. Override with PG_ALLOWED_CIDR (comma-separated).
if [[ -z "${PG_ALLOWED_CIDR:-}" ]]; then
  MY_IP=$(curl -fsS https://checkip.amazonaws.com 2>/dev/null | tr -d '[:space:]')
  [[ "$MY_IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "Could not detect public IP; set PG_ALLOWED_CIDR"
  PG_ALLOWED_CIDR="$MY_IP/32"
fi
[[ "$PG_ALLOWED_CIDR" =~ ^[0-9./,]+$ ]] || fail "PG_ALLOWED_CIDR must be IPv4 CIDRs, e.g. 203.0.113.4/32"
CIDR_LIST=$(echo "$PG_ALLOWED_CIDR" | sed "s/[^,]*/'&'/g")
snowc -q "
  CREATE DATABASE IF NOT EXISTS $MDM_DATABASE;
  CREATE SCHEMA IF NOT EXISTS $MDM_DATABASE.MDM_APP;
  CREATE NETWORK RULE IF NOT EXISTS $MDM_DATABASE.MDM_APP.${PG_INSTANCE}_INGRESS
    TYPE = IPV4 MODE = POSTGRES_INGRESS VALUE_LIST = ($CIDR_LIST);
  ALTER NETWORK RULE $MDM_DATABASE.MDM_APP.${PG_INSTANCE}_INGRESS SET VALUE_LIST = ($CIDR_LIST);
  CREATE NETWORK POLICY IF NOT EXISTS ${PG_INSTANCE}_POLICY
    ALLOWED_NETWORK_RULE_LIST = ('$MDM_DATABASE.MDM_APP.${PG_INSTANCE}_INGRESS');
  ALTER POSTGRES INSTANCE $PG_INSTANCE SET NETWORK_POLICY = '${PG_INSTANCE}_POLICY';
" >/dev/null || fail "Failed to open Postgres ingress"
ok "Postgres ingress allowed from $PG_ALLOWED_CIDR (policy ${PG_INSTANCE}_POLICY)"

PG_USER="snowflake_admin"
PG_PORT=5432
PG_DATABASE="postgres"

# ============================================================================
# 2. Run Postgres migrations
# ============================================================================
banner "Step 2/5 — Postgres Schema & Data"

cd "$SCRIPT_DIR/mdm-api"
[[ -d node_modules ]] || { echo "  Installing API dependencies..."; npm install --silent; ok "Dependencies installed"; }

# Node runner for SQL files (psql is not required)
RUN_SQL="$(mktemp -t mdm_run_sql).cjs"
trap 'rm -f "$RUN_SQL"' EXIT
cat > "$RUN_SQL" << 'SQLRUNNER'
const { Client } = require(process.env.PG_MODULE);
const fs = require('fs');
const client = new Client({
  host: process.env.PG_HOST, port: parseInt(process.env.PG_PORT || '5432'),
  database: process.env.PG_DATABASE || 'postgres', user: process.env.PG_USER || 'snowflake_admin',
  password: process.env.PG_PASSWORD, ssl: { rejectUnauthorized: false },
});
(async () => {
  await client.connect();
  if (process.argv[2] === '-c') { await client.query(process.argv[3], process.argv.slice(4)); }
  else { await client.query(fs.readFileSync(process.argv[2], 'utf-8')); console.log(`  ✓ ${require('path').basename(process.argv[2])}`); }
  await client.end();
})().catch(e => { console.error(`  ✗ ${process.argv[2]}: ${e.message}`); process.exit(1); });
SQLRUNNER

export PG_HOST PG_PORT PG_DATABASE PG_USER
export PG_PASSWORD="$PG_PASSWORD_PG"
export PG_MODULE="$SCRIPT_DIR/mdm-api/node_modules/pg"

SQL_DIR="$SCRIPT_DIR/postgres"
echo "Running migrations..."
# Versioned migrations (postgres/NNN_*.sql, tracked in mdm.schema_migrations)
(cd "$SCRIPT_DIR/mdm-api" && MDM_DEV_AUTH=1 npx tsx src/migrate.ts up) || fail "Migrations failed"

# Sample data, loaded once (the migration chain never resets data)
SEED_FILE="$CONFIG_DIR/$DEMO_CUSTOMER/seed_${DEMO_CUSTOMER}.sql"
[[ -f "$SEED_FILE" ]] || SEED_FILE="$SQL_DIR/seed/demo_data.sql"
echo "  Seeding sample data from: $(basename "$SEED_FILE")"
node "$RUN_SQL" "$SEED_FILE"

# The person running setup becomes the first MDM admin (matched on Snowflake login)
node "$RUN_SQL" -c "UPDATE mdm.app_user SET sf_user = NULL WHERE upper(sf_user) = upper(\$1)" "$SF_LOGIN"
node "$RUN_SQL" -c "UPDATE mdm.app_user SET sf_user = upper(\$1) WHERE email = (SELECT email FROM mdm.app_user WHERE role = 'ADMIN' AND is_active ORDER BY created_at LIMIT 1)" "$SF_LOGIN"
ok "Snowflake user $SF_LOGIN mapped to the bootstrap MDM admin"

# Password for mdm_app (user-facing API role; RLS enforced). Generated locally, never printed.
PG_APP_USER="mdm_app"
PG_APP_PASSWORD="$(openssl rand -hex 24)"
PG_APP_PASSWORD="$PG_APP_PASSWORD" node -e "
  const { Client } = require(process.env.PG_MODULE);
  const c = new Client({ host: process.env.PG_HOST, port: 5432, database: process.env.PG_DATABASE,
    user: 'snowflake_admin', password: process.env.PG_PASSWORD, ssl: { rejectUnauthorized: false } });
  (async () => {
    await c.connect();
    const pw = (await c.query('SELECT quote_literal(\$1) AS q', [process.env.PG_APP_PASSWORD])).rows[0].q;
    await c.query('ALTER ROLE mdm_app PASSWORD ' + pw);
    await c.end();
  })().catch(e => { console.error(e.message); process.exit(1); });
" || fail "Failed to set mdm_app password"

# Store both Postgres passwords in ~/.pgpass (read by start-dev.sh), never in the repo
touch ~/.pgpass && chmod 600 ~/.pgpass
for entry in "$PG_USER:$PG_PASSWORD_PG" "$PG_APP_USER:$PG_APP_PASSWORD"; do
  u="${entry%%:*}"; p="${entry#*:}"
  grep -v "^$PG_HOST:[^:]*:[^:]*:$u:" ~/.pgpass > ~/.pgpass.tmp || true
  echo "$PG_HOST:$PG_PORT:*:$u:$p" >> ~/.pgpass.tmp && mv ~/.pgpass.tmp ~/.pgpass
done
chmod 600 ~/.pgpass
ok "Postgres ready; credentials stored in ~/.pgpass"

# ============================================================================
# 3. Configure Snowflake objects
# ============================================================================
banner "Step 3/5 — Snowflake Objects"

# Roles named in the module config (users[].sf_role) must exist before the governance script
node -e "
  const cfg = JSON.parse(require('fs').readFileSync('$CONFIG_DIR/$DEMO_CUSTOMER/config.json','utf8'));
  [...new Set(cfg.users.map(u => u.sf_role).filter(Boolean))].forEach(r => console.log(r));
" | while read -r ROLE; do
  [[ "$ROLE" =~ ^[A-Z_][A-Z0-9_]*$ ]] || { warn "Skipping invalid role name $ROLE"; continue; }
  snowc -q "CREATE ROLE IF NOT EXISTS $ROLE; GRANT ROLE $ROLE TO ROLE SYSADMIN;" >/dev/null
  ok "Role $ROLE"
done

# Database, schemas, warehouse + resource monitor, fixed roles
SQL_VARS+=(-D "postgres_instance=$PG_INSTANCE")   # known once the instance step has run
snowc -f "$SCRIPT_DIR/snowflake/001_roles_warehouse.sql" "${SQL_VARS[@]}" >/dev/null || fail "001_roles_warehouse.sql failed"
ok "Database $MDM_DATABASE, warehouse $MDM_WAREHOUSE (monitor ${MDM_WAREHOUSE}_RM, $CREDIT_QUOTA credits/month), roles"
# Config roles inherit viewer grants (re-run now that MDM_VIEWER_ROLE exists)
node -e "
  const cfg = JSON.parse(require('fs').readFileSync('$CONFIG_DIR/$DEMO_CUSTOMER/config.json','utf8'));
  [...new Set(cfg.users.map(u => u.sf_role).filter(Boolean))].forEach(r => console.log(r));
" | while read -r ROLE; do
  [[ "$ROLE" =~ ^[A-Z_][A-Z0-9_]*$ && "$ROLE" != MDM_VIEWER_ROLE ]] || continue
  snowc -q "GRANT ROLE MDM_VIEWER_ROLE TO ROLE $ROLE;" >/dev/null
done

echo "  Setting up CDC mirroring..."
snowc -q "
  GRANT APPLICATION ROLE snowflake.postgres_mirror_admin TO ROLE ACCOUNTADMIN;
  GRANT USAGE ON POSTGRES INSTANCE \"$PG_INSTANCE\" TO APPLICATION snowflake;
" >/dev/null || warn "Mirror grants may already exist"
node "$RUN_SQL" -c "CREATE EXTENSION IF NOT EXISTS snowflake_cdc CASCADE" || warn "CDC extension may need manual install"
snowc -q "
  CALL SNOWFLAKE.POSTGRES.CREATE_MIRROR(
    mirror_name       => '$MDM_MIRROR_NAME',
    postgres_instance => '$PG_INSTANCE',
    postgres_database => 'postgres',
    target_database   => '$MDM_MIRROR_DATABASE',
    postgres_tables   => NULL,
    postgres_schemas  => ['mdm'],
    refresh_interval  => '$MIRROR_REFRESH'
  );
" >/dev/null || warn "Mirror may already exist"
ok "CDC mirror $MDM_MIRROR_NAME → $MDM_MIRROR_DATABASE"

# The views and SYNC_MODULES (008) read the mirrored tables: wait for the initial copy
echo -n "  Waiting for the initial mirror copy"
# LIST_MIRRORS can report 0 remaining before every table is visible: also wait until the
# mirror holds as many tables as the Postgres mdm schema.
PG_TABLES=$(PG_PASSWORD="$PG_PASSWORD_PG" node -e "
  const { Client } = require(process.env.PG_MODULE);
  const c = new Client({ host: process.env.PG_HOST, port: 5432, database: 'postgres', user: 'snowflake_admin',
    password: process.env.PG_PASSWORD, ssl: { rejectUnauthorized: false } });
  c.connect().then(() => c.query(\"SELECT count(*)::int n FROM pg_tables WHERE schemaname = 'mdm'\"))
   .then(r => { console.log(r.rows[0].n); return c.end(); });" 2>/dev/null || echo 0)
for _ in $(seq 1 60); do
  REMAINING=$(snowc -q "CALL SNOWFLAKE.POSTGRES.LIST_MIRRORS('$PG_INSTANCE')" --format JSON 2>/dev/null \
    | node -e "const r=JSON.parse(require('fs').readFileSync(0,'utf8')).find(m=>m.MIRROR_NAME==='$MDM_MIRROR_NAME'); console.log(r ? r.INITIAL_SNAPSHOT_TABLES_REMAINING : 'x')" 2>/dev/null || echo x)
  MIRRORED=$(snowc -q "SELECT COUNT(*) AS N FROM $MDM_MIRROR_DATABASE.INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'MDM' AND TABLE_TYPE = 'BASE TABLE' AND NOT CONTAINS(TABLE_NAME, '\$')" --format JSON 2>/dev/null \
    | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8'))[0].N)" 2>/dev/null || echo 0)
  [[ "$REMAINING" == "0" && "$MIRRORED" -ge "$PG_TABLES" ]] && break
  echo -n "."; sleep 10
done
echo ""
[[ "$REMAINING" == "0" && "$MIRRORED" -ge "$PG_TABLES" ]] && ok "Mirror copy complete ($MIRRORED tables)" \
  || warn "Mirror still copying ($MIRRORED/$PG_TABLES tables); re-run the snowflake/00*.sql scripts once it is done"

# Current-state + history, analytics, governance, publish, DQ metrics, alerts, then the
# per-module objects (008) — in numeric order
for f in "$SCRIPT_DIR"/snowflake/0*.sql; do
  [[ "$(basename "$f")" == 001_* ]] && continue
  snowc -f "$f" "${SQL_VARS[@]}" >/dev/null && ok "$(basename "$f")" || warn "$(basename "$f") needs manual review"
done

# ============================================================================
# 4. Roles from configuration
# ============================================================================
banner "Step 4/5 — RBAC"

node -e "
  const cfg = JSON.parse(require('fs').readFileSync('$CONFIG_DIR/$DEMO_CUSTOMER/config.json','utf8'));
  [...new Set(['MDM_ADMIN_ROLE', 'MDM_VIEWER_ROLE', ...cfg.users.map(u => u.sf_role).filter(Boolean)])].forEach(r => console.log(r));
" | while read -r ROLE; do
  [[ "$ROLE" =~ ^[A-Z_][A-Z0-9_]*$ ]] || { warn "Skipping invalid role name $ROLE"; continue; }
  snowc -q "
    CREATE ROLE IF NOT EXISTS $ROLE;
    GRANT ROLE $ROLE TO ROLE SYSADMIN;
    GRANT USAGE ON DATABASE $MDM_DATABASE TO ROLE $ROLE;
    GRANT USAGE ON ALL SCHEMAS IN DATABASE $MDM_DATABASE TO ROLE $ROLE;
    GRANT SELECT ON ALL TABLES IN DATABASE $MDM_DATABASE TO ROLE $ROLE;
    GRANT SELECT ON ALL VIEWS IN DATABASE $MDM_DATABASE TO ROLE $ROLE;
    GRANT USAGE ON WAREHOUSE $MDM_WAREHOUSE TO ROLE $ROLE;
  " >/dev/null && ok "Role $ROLE"
done

# ============================================================================
# 5. Install app and write .env.local
# ============================================================================
banner "Step 5/5 — Application Setup"

(cd "$SCRIPT_DIR/mdm-api" && [[ -d node_modules ]] || npm install --silent); ok "API dependencies installed"
(cd "$SCRIPT_DIR/mdm-ui" && [[ -d node_modules ]] || npm install --silent); ok "UI dependencies installed"

ENV_FILE="$SCRIPT_DIR/mdm-api/.env.local"
cat > "$ENV_FILE" << ENVEOF
# Generated by setup.sh on $(date +%Y-%m-%d). No secrets: passwords are in ~/.pgpass.
DEMO_CUSTOMER=$DEMO_CUSTOMER
PG_HOST=$PG_HOST
SNOWFLAKE_ACCOUNT=$SF_ACCOUNT
MDM_DATABASE=$MDM_DATABASE
MDM_WAREHOUSE=$MDM_WAREHOUSE
MDM_MIRROR_DATABASE=$MDM_MIRROR_DATABASE
MDM_MIRROR_NAME=$MDM_MIRROR_NAME
MDM_PG_INSTANCE=$PG_INSTANCE
# Snowflake auth for the API: key-pair (preferred) or PAT
# SF_USER=MDM_SVC
# SF_PRIVATE_KEY_PATH=~/.snowflake/keys/mdm_svc.p8
ENVEOF
ok "Environment file written: mdm-api/.env.local"

cd "$SCRIPT_DIR"
banner "Setup Complete!"
echo -e "  Configuration: ${GREEN}$DEMO_NAME${NC}"
echo -e "  Postgres:      $PG_INSTANCE ($PG_HOST)"
echo -e "  Snowflake:     $SF_ACCOUNT / $MDM_DATABASE"
echo ""
echo "  Start locally:"
echo -e "    ${CYAN}bash mdm-api/start-dev.sh${NC}        # API on :3001 (dev auth)"
echo -e "    ${CYAN}cd mdm-ui && npm run dev${NC}         # UI on :3000"
echo ""
echo "  Deploy to Snowpark Container Services: see deploy/README in INSTALL.md (bash deploy/deploy.sh)"
echo ""
