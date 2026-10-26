-- ============================================================
-- 001 — Database, schemas, warehouse, cost guardrail, base roles
-- ============================================================
-- Templated for the Snowflake CLI (run as ACCOUNTADMIN):
--   snow sql -f snowflake/001_roles_warehouse.sql -D database=MDM -D warehouse=MDM_WH -D credit_quota=50
--
-- Every MDM workload (dynamic tables, alerts, DMF-adjacent queries, Analyst/Agent SQL from
-- the API) runs on one dedicated warehouse, capped by a monthly resource monitor.
-- Roles named per user in the module config (users[].sf_role) are created by setup.sh
-- before this script; the fixed roles below are always present.
-- ============================================================

USE ROLE ACCOUNTADMIN;

CREATE DATABASE IF NOT EXISTS <% database %>;
CREATE SCHEMA IF NOT EXISTS <% database %>.MDM_ANALYTICS;
CREATE SCHEMA IF NOT EXISTS <% database %>.MDM_AI;
CREATE SCHEMA IF NOT EXISTS <% database %>.GOVERNANCE;
CREATE SCHEMA IF NOT EXISTS <% database %>.PUBLISH;

-- ── Warehouse + resource monitor ────────────────────────────────────────────
CREATE WAREHOUSE IF NOT EXISTS <% warehouse %>
  WAREHOUSE_SIZE = 'XSMALL' AUTO_SUSPEND = 60 AUTO_RESUME = TRUE INITIALLY_SUSPENDED = TRUE
  COMMENT = 'MDM: dynamic tables, alerts, Analyst/Agent queries';
ALTER WAREHOUSE <% warehouse %> SET AUTO_SUSPEND = 60;

CREATE RESOURCE MONITOR IF NOT EXISTS <% warehouse %>_RM WITH
  CREDIT_QUOTA = <% credit_quota %> FREQUENCY = MONTHLY START_TIMESTAMP = IMMEDIATELY
  TRIGGERS ON 80 PERCENT DO NOTIFY
           ON 100 PERCENT DO SUSPEND
           ON 110 PERCENT DO SUSPEND_IMMEDIATE;
ALTER RESOURCE MONITOR <% warehouse %>_RM SET CREDIT_QUOTA = <% credit_quota %>;
ALTER WAREHOUSE <% warehouse %> SET RESOURCE_MONITOR = <% warehouse %>_RM;

-- ── Fixed roles ─────────────────────────────────────────────────────────────
--   MDM_ADMIN_ROLE     operate dynamic tables, alerts; edit governance mappings
--   MDM_VIEWER_ROLE    read analytics (row access + masking still apply)
--   MDM_SERVICE_ROLE   the API's service user: system jobs, governance sync
--   MDM_APP_USER_ROLE  granted to SPCS ingress users (see deploy/)
--   MDM_CONSUMER_ROLE  read-only on PUBLISH (golden records + cross-reference)
CREATE ROLE IF NOT EXISTS MDM_ADMIN_ROLE;
CREATE ROLE IF NOT EXISTS MDM_VIEWER_ROLE;
CREATE ROLE IF NOT EXISTS MDM_SERVICE_ROLE;
CREATE ROLE IF NOT EXISTS MDM_APP_USER_ROLE;
CREATE ROLE IF NOT EXISTS MDM_CONSUMER_ROLE;
GRANT ROLE MDM_ADMIN_ROLE TO ROLE SYSADMIN;
GRANT ROLE MDM_VIEWER_ROLE TO ROLE SYSADMIN;
GRANT ROLE MDM_SERVICE_ROLE TO ROLE SYSADMIN;
GRANT ROLE MDM_APP_USER_ROLE TO ROLE SYSADMIN;
GRANT ROLE MDM_CONSUMER_ROLE TO ROLE SYSADMIN;

GRANT USAGE ON DATABASE <% database %> TO ROLE MDM_ADMIN_ROLE;
GRANT USAGE ON DATABASE <% database %> TO ROLE MDM_VIEWER_ROLE;
GRANT USAGE ON DATABASE <% database %> TO ROLE MDM_SERVICE_ROLE;
GRANT USAGE ON DATABASE <% database %> TO ROLE MDM_CONSUMER_ROLE;
GRANT USAGE ON SCHEMA <% database %>.MDM_ANALYTICS TO ROLE MDM_ADMIN_ROLE;
GRANT USAGE ON SCHEMA <% database %>.MDM_ANALYTICS TO ROLE MDM_VIEWER_ROLE;
GRANT USAGE ON SCHEMA <% database %>.MDM_ANALYTICS TO ROLE MDM_SERVICE_ROLE;
GRANT USAGE ON SCHEMA <% database %>.MDM_AI TO ROLE MDM_ADMIN_ROLE;
GRANT USAGE ON SCHEMA <% database %>.MDM_AI TO ROLE MDM_SERVICE_ROLE;
GRANT USAGE ON SCHEMA <% database %>.GOVERNANCE TO ROLE MDM_SERVICE_ROLE;
GRANT USAGE ON SCHEMA <% database %>.PUBLISH TO ROLE MDM_CONSUMER_ROLE;
GRANT USAGE ON SCHEMA <% database %>.PUBLISH TO ROLE MDM_VIEWER_ROLE;
GRANT USAGE ON SCHEMA <% database %>.PUBLISH TO ROLE MDM_SERVICE_ROLE;

GRANT USAGE ON WAREHOUSE <% warehouse %> TO ROLE MDM_ADMIN_ROLE;
GRANT USAGE ON WAREHOUSE <% warehouse %> TO ROLE MDM_VIEWER_ROLE;
GRANT USAGE ON WAREHOUSE <% warehouse %> TO ROLE MDM_SERVICE_ROLE;
GRANT USAGE ON WAREHOUSE <% warehouse %> TO ROLE MDM_CONSUMER_ROLE;
GRANT OPERATE ON WAREHOUSE <% warehouse %> TO ROLE MDM_ADMIN_ROLE;
