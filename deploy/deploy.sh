#!/usr/bin/env bash
# Build, push and (re)deploy the MDM to Snowpark Container Services.
#
#   bash deploy/deploy.sh --setup   # first time: create pool, repo, secrets, EAI, grants
#   bash deploy/deploy.sh           # build + push a new image, create or upgrade the service
#
# Reads mdm-api/.env.local (PG_HOST, MDM_DATABASE, ...). Uses a Snowflake CLI
# connection (SNOW_CONNECTION, default "default") and a local Docker daemon.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f mdm-api/.env.local ]]; then set -a; source mdm-api/.env.local; set +a; fi

SNOW_CONNECTION="${SNOW_CONNECTION:-default}"
: "${PG_HOST:?PG_HOST not set (mdm-api/.env.local)}"
export DEMO_CUSTOMER="${DEMO_CUSTOMER:-neutral}"
export MDM_DATABASE="${MDM_DATABASE:-MDM}"
export MDM_WAREHOUSE="${MDM_WAREHOUSE:-MDM_WH}"
export MDM_MIRROR_DATABASE="${MDM_MIRROR_DATABASE:-${MDM_DATABASE}_MIRROR}"
export MDM_MIRROR_NAME="${MDM_MIRROR_NAME:-$(echo "${MDM_DATABASE}_MIRROR" | tr '[:upper:]' '[:lower:]')}"
export MDM_PG_INSTANCE="${MDM_PG_INSTANCE:-${MDM_DATABASE}_PG}"
export PG_HOST
COMPUTE_POOL="${MDM_COMPUTE_POOL:-MDM_POOL}"
SERVICE="$MDM_DATABASE.MDM_APP.MDM_SERVICE"
TAG="${TAG:-$(git rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M)}"

for n in "$MDM_DATABASE" "$MDM_WAREHOUSE" "$COMPUTE_POOL"; do
  [[ "$n" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || { echo "Invalid identifier: $n" >&2; exit 1; }
done

snowc() { snow sql -c "$SNOW_CONNECTION" "$@"; }

if [[ "${1:-}" == "--setup" ]]; then
  DEPLOY_USER=$(snowc -q "SELECT CURRENT_USER() AS U" --format JSON | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8'))[0].U)")
  snowc -f deploy/setup_spcs.sql -D "database=$MDM_DATABASE" -D "warehouse=$MDM_WAREHOUSE" \
    -D "pg_host=$PG_HOST" -D "compute_pool=$COMPUTE_POOL" -D "deploy_user=\"$DEPLOY_USER\""
  echo ""
  echo "Now set the Postgres passwords (not stored in any file):"
  echo "  ALTER SECRET $MDM_DATABASE.MDM_APP.MDM_PG_ADMIN SET PASSWORD = '<snowflake_admin password>';"
  echo "  ALTER SECRET $MDM_DATABASE.MDM_APP.MDM_PG_APP   SET PASSWORD = '<mdm_app password>';"
  echo "Then map each user: UPDATE mdm.app_user SET sf_user = '<LOGIN_NAME>' WHERE email = '...';"
  exit 0
fi

# ── Build and push ──────────────────────────────────────────────────────────
REGISTRY=$(snow spcs image-registry url -c "$SNOW_CONNECTION")
REPO_PATH="$(echo "$MDM_DATABASE" | tr '[:upper:]' '[:lower:]')/mdm_app/images"
IMAGE_REMOTE="$REGISTRY/$REPO_PATH/mdm:$TAG"
export IMAGE="/$REPO_PATH/mdm:$TAG"

snow spcs image-registry login -c "$SNOW_CONNECTION"
docker build --platform linux/amd64 -t "$IMAGE_REMOTE" .
docker push "$IMAGE_REMOTE"

# ── Render spec ─────────────────────────────────────────────────────────────
SPEC=$(perl -pe 's/\$\{(\w+)\}/exists $ENV{$1} ? $ENV{$1} : die "unset: $1\n"/ge' deploy/mdm-service.yaml)

# ── Create or upgrade the service ───────────────────────────────────────────
EXISTS=$(snowc -q "SHOW SERVICES LIKE 'MDM_SERVICE' IN SCHEMA $MDM_DATABASE.MDM_APP" --format JSON | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).length)")
if [[ "$EXISTS" == "0" ]]; then
  snowc -q "USE ROLE MDM_SERVICE_ROLE;
    CREATE SERVICE $SERVICE
      IN COMPUTE POOL $COMPUTE_POOL
      EXTERNAL_ACCESS_INTEGRATIONS = (MDM_PG_ACCESS)
      QUERY_WAREHOUSE = $MDM_WAREHOUSE
      FROM SPECIFICATION \$\$
$SPEC
\$\$;
    GRANT SERVICE ROLE $SERVICE!mdm_user TO ROLE MDM_APP_USER_ROLE;"
  echo "Service created: $SERVICE"
else
  snowc -q "USE ROLE MDM_SERVICE_ROLE;
    ALTER SERVICE $SERVICE FROM SPECIFICATION \$\$
$SPEC
\$\$;"
  echo "Service upgraded: $SERVICE ($TAG)"
fi

echo "Endpoint (may take a few minutes to provision):"
snowc -q "USE ROLE MDM_SERVICE_ROLE; SHOW ENDPOINTS IN SERVICE $SERVICE;"
