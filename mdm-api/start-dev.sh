#!/usr/bin/env bash
# Start the MDM API locally against a Snowflake Postgres instance.
# Settings come from mdm-api/.env.local (gitignored, see .env.example); passwords
# are read from ~/.pgpass at runtime so no secret is stored in the repo.
#   PG_USER     — admin pool (system jobs, BYPASSRLS)
#   PG_APP_USER — user pool (all user requests, Postgres RLS enforced)
set -euo pipefail
cd "$(dirname "$0")"

if [[ -f .env.local ]]; then set -a; source .env.local; set +a; fi

: "${PG_HOST:?Set PG_HOST in mdm-api/.env.local (Postgres instance host)}"
export PG_PORT="${PG_PORT:-5432}"
export PG_DATABASE="${PG_DATABASE:-postgres}"
export PG_USER="${PG_USER:-snowflake_admin}"
export PG_APP_USER="${PG_APP_USER:-mdm_app}"
# Local runs trust the x-mdm-user header (user switcher). Never set this in SPCS.
export MDM_DEV_AUTH="${MDM_DEV_AUTH:-1}"

pgpass_lookup() {
  awk -F: -v h="$PG_HOST" -v u="$1" '$1==h && $4==u {print $5; exit}' ~/.pgpass
}

if [[ -z "${PG_PASSWORD:-}" ]]; then
  PG_PASSWORD="$(pgpass_lookup "$PG_USER")"
  if [[ -z "$PG_PASSWORD" ]]; then
    echo "No ~/.pgpass entry for $PG_USER@$PG_HOST; set PG_PASSWORD." >&2
    exit 1
  fi
  export PG_PASSWORD
fi

if [[ -z "${PG_APP_PASSWORD:-}" ]]; then
  PG_APP_PASSWORD="$(pgpass_lookup "$PG_APP_USER")"
  if [[ -z "$PG_APP_PASSWORD" ]]; then
    echo "No ~/.pgpass entry for $PG_APP_USER@$PG_HOST; set PG_APP_PASSWORD." >&2
    exit 1
  fi
  export PG_APP_PASSWORD
fi

# `bash start-dev.sh migrate [status|up|baseline]` runs the migration CLI with the same settings
if [[ "${1:-}" == "migrate" ]]; then shift; exec npx tsx src/migrate.ts "$@"; fi
exec npm run dev
