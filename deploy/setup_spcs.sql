-- ============================================================================
-- MDM on Snowpark Container Services — one-time account objects.
-- Templated for the Snowflake CLI; deploy/deploy.sh runs it as:
--   snow sql -f deploy/setup_spcs.sql -D database=MDM -D warehouse=MDM_WH \
--            -D pg_host=<postgres host> -D compute_pool=MDM_POOL
-- Requires ACCOUNTADMIN (compute pool, integration, grants). Idempotent.
-- Postgres passwords are set separately (see the SECRETS section) so they never
-- appear in this file or in shell history.
-- ============================================================================

USE ROLE ACCOUNTADMIN;

-- ── Service role ────────────────────────────────────────────────────────────
-- The container's own identity (its OAuth token at /snowflake/session/token)
-- runs as the role that owns the service.
CREATE ROLE IF NOT EXISTS MDM_SERVICE_ROLE;
GRANT ROLE MDM_SERVICE_ROLE TO ROLE SYSADMIN;

-- Users of the app: grant this role to anyone who should reach the UI.
-- What they can SEE is decided by mdm.app_user (sf_user mapping) + Postgres RLS.
CREATE ROLE IF NOT EXISTS MDM_APP_USER_ROLE;
GRANT ROLE MDM_APP_USER_ROLE TO ROLE SYSADMIN;

-- ── Container objects ───────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS <% database %>.MDM_APP;
CREATE IMAGE REPOSITORY IF NOT EXISTS <% database %>.MDM_APP.IMAGES;

CREATE COMPUTE POOL IF NOT EXISTS <% compute_pool %>
  MIN_NODES = 1 MAX_NODES = 1
  INSTANCE_FAMILY = CPU_X64_XS
  AUTO_RESUME = TRUE
  AUTO_SUSPEND_SECS = 3600;

-- ── Egress: Snowflake Postgres instance ─────────────────────────────────────
CREATE NETWORK RULE IF NOT EXISTS <% database %>.MDM_APP.MDM_PG_EGRESS
  MODE = EGRESS TYPE = HOST_PORT VALUE_LIST = ('<% pg_host %>:5432');

-- ── Secrets (placeholder values; set the real ones with ALTER SECRET) ────────
--   ALTER SECRET <db>.MDM_APP.MDM_PG_ADMIN SET PASSWORD = '...';
--   ALTER SECRET <db>.MDM_APP.MDM_PG_APP   SET PASSWORD = '...';
CREATE SECRET IF NOT EXISTS <% database %>.MDM_APP.MDM_PG_ADMIN
  TYPE = PASSWORD USERNAME = 'snowflake_admin' PASSWORD = 'change-me';
CREATE SECRET IF NOT EXISTS <% database %>.MDM_APP.MDM_PG_APP
  TYPE = PASSWORD USERNAME = 'mdm_app' PASSWORD = 'change-me';

CREATE EXTERNAL ACCESS INTEGRATION IF NOT EXISTS MDM_PG_ACCESS
  ALLOWED_NETWORK_RULES = (<% database %>.MDM_APP.MDM_PG_EGRESS)
  ALLOWED_AUTHENTICATION_SECRETS = (<% database %>.MDM_APP.MDM_PG_ADMIN, <% database %>.MDM_APP.MDM_PG_APP)
  ENABLED = TRUE;

-- ── Grants to the service role ──────────────────────────────────────────────
GRANT USAGE, MONITOR ON COMPUTE POOL <% compute_pool %> TO ROLE MDM_SERVICE_ROLE;
GRANT BIND SERVICE ENDPOINT ON ACCOUNT TO ROLE MDM_SERVICE_ROLE;
GRANT USAGE ON INTEGRATION MDM_PG_ACCESS TO ROLE MDM_SERVICE_ROLE;

GRANT USAGE ON DATABASE <% database %> TO ROLE MDM_SERVICE_ROLE;
GRANT USAGE ON ALL SCHEMAS IN DATABASE <% database %> TO ROLE MDM_SERVICE_ROLE;
GRANT CREATE SERVICE ON SCHEMA <% database %>.MDM_APP TO ROLE MDM_SERVICE_ROLE;
GRANT READ, WRITE ON IMAGE REPOSITORY <% database %>.MDM_APP.IMAGES TO ROLE MDM_SERVICE_ROLE;
GRANT READ ON SECRET <% database %>.MDM_APP.MDM_PG_ADMIN TO ROLE MDM_SERVICE_ROLE;
GRANT READ ON SECRET <% database %>.MDM_APP.MDM_PG_APP TO ROLE MDM_SERVICE_ROLE;
GRANT SELECT ON ALL TABLES IN DATABASE <% database %> TO ROLE MDM_SERVICE_ROLE;
GRANT SELECT ON ALL VIEWS IN DATABASE <% database %> TO ROLE MDM_SERVICE_ROLE;
GRANT SELECT ON FUTURE TABLES IN DATABASE <% database %> TO ROLE MDM_SERVICE_ROLE;
GRANT SELECT ON FUTURE VIEWS IN DATABASE <% database %> TO ROLE MDM_SERVICE_ROLE;
GRANT USAGE ON WAREHOUSE <% warehouse %> TO ROLE MDM_SERVICE_ROLE;

-- Cortex (AI functions, Analyst, Agent)
GRANT DATABASE ROLE SNOWFLAKE.CORTEX_USER TO ROLE MDM_SERVICE_ROLE;

-- Analyst SQL runs on a connection per caller role (app_user.sf_role). The service
-- can only open such a connection if it holds that role, so grant the MDM data roles.
GRANT ROLE MDM_ADMIN_ROLE  TO ROLE MDM_SERVICE_ROLE;
GRANT ROLE MDM_VIEWER_ROLE TO ROLE MDM_SERVICE_ROLE;
-- Repeat for each steward role in config users[].sf_role, e.g.:
-- GRANT ROLE MDM_STEWARD_DEU TO ROLE MDM_SERVICE_ROLE;

-- Lets the deploying user act as the service role
GRANT ROLE MDM_SERVICE_ROLE TO USER <% deploy_user %>;
