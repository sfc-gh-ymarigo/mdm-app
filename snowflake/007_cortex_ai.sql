-- ============================================================
-- 007 — Operational alerts (mirror health) and mirror procedures for the app
-- ============================================================
-- Templated:  snow sql -f snowflake/007_cortex_ai.sql -D database=MDM -D postgres_instance=MDM_PG
--
-- The semantic view for Cortex Analyst (MDM_ANALYTICS.MDM_ANALYTICS_VIEW) is generated from the
-- module configuration by MDM_ANALYTICS.SYNC_MODULES (008). This script creates
-- ALERT_LOG + a mirror health check every 15 minutes (serverless task).
--
-- Matching, DQ and workflow follow-up run in Postgres (the app's notification bell already
-- covers failing rules and stale workflows), so Snowflake only checks what Postgres cannot see:
-- whether the CDC mirror into Snowflake is still healthy. Findings land in MDM_AI.ALERT_LOG and
-- appear in the bell for admins; no e-mail integration is needed.
-- ============================================================

USE ROLE ACCOUNTADMIN;
USE DATABASE <% database %>;

-- ── 1. Alert log ──
-- One row per finding. Open findings are deduplicated on (alert_name, open) and closed by the
-- check itself when the condition clears. The app reads open rows into the admins' bell.
CREATE TABLE IF NOT EXISTS <% database %>.MDM_AI.ALERT_LOG (
  id           NUMBER AUTOINCREMENT PRIMARY KEY,
  alert_name   STRING NOT NULL,
  severity     STRING NOT NULL,          -- WARNING | ERROR
  message      STRING NOT NULL,
  details      VARIANT,
  raised_at    TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP(),
  last_seen_at TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP(),
  resolved_at  TIMESTAMP_LTZ
) COMMENT = 'Operational findings from Snowflake-side checks (mirror health); shown in the MDM notification bell';
GRANT SELECT ON TABLE <% database %>.MDM_AI.ALERT_LOG TO ROLE MDM_SERVICE_ROLE;
GRANT USAGE ON SCHEMA <% database %>.MDM_AI TO ROLE MDM_SERVICE_ROLE;

-- ── 2. Mirror health check ──
-- LIST_MIRRORS is a procedure, so this runs as a task rather than an ALERT (whose condition must
-- be a query). Raised when the mirror is missing, not ACTIVE, or reports an error. There is no
-- time-based rule: LAST_APPLY_TIME / LAST_OPERATION_TIME only move when changes arrive, so an idle
-- but healthy mirror would raise false alarms. Data recency is tracked by the FRESHNESS DMFs (006).
CREATE OR REPLACE PROCEDURE <% database %>.MDM_AI.CHECK_MIRROR_HEALTH()
RETURNS STRING
LANGUAGE SQL
EXECUTE AS OWNER
AS
$$
DECLARE
  st STRING;
  err STRING;
  remaining NUMBER;
  op_time TIMESTAMP_NTZ;
  problem STRING := NULL;
BEGIN
  CALL SNOWFLAKE.POSTGRES.LIST_MIRRORS('<% postgres_instance %>');
  SELECT "STATUS", "ERROR_MESSAGE", "INITIAL_SNAPSHOT_TABLES_REMAINING", "LAST_OPERATION_TIME"
    INTO :st, :err, :remaining, :op_time
    FROM TABLE(RESULT_SCAN(LAST_QUERY_ID())) LIMIT 1;

  IF (st IS NULL) THEN
    problem := 'No CDC mirror found for <% postgres_instance %>';
  ELSEIF (st <> 'ACTIVE') THEN
    problem := 'CDC mirror status is ' || st || COALESCE(': ' || NULLIF(err, ''), '');
  ELSEIF (NULLIF(err, '') IS NOT NULL) THEN
    problem := 'CDC mirror reports an error: ' || err;
  END IF;

  IF (problem IS NOT NULL) THEN
    UPDATE <% database %>.MDM_AI.ALERT_LOG SET last_seen_at = CURRENT_TIMESTAMP(), message = :problem
     WHERE alert_name = 'MIRROR_HEALTH' AND resolved_at IS NULL;
    IF (SQLROWCOUNT = 0) THEN
      INSERT INTO <% database %>.MDM_AI.ALERT_LOG (alert_name, severity, message, details)
        SELECT 'MIRROR_HEALTH', 'ERROR', :problem,
               OBJECT_CONSTRUCT('status', :st, 'error', :err, 'snapshot_tables_remaining', :remaining, 'last_operation_time', :op_time);
    END IF;
    RETURN problem;
  END IF;
  UPDATE <% database %>.MDM_AI.ALERT_LOG SET resolved_at = CURRENT_TIMESTAMP()
   WHERE alert_name = 'MIRROR_HEALTH' AND resolved_at IS NULL;
  RETURN 'ok';
END;
$$;

-- Serverless: a warehouse task every few minutes would keep waking MDM_WH (60 s minimum each time)
-- and exhaust the resource monitor quota; serverless bills only the seconds the check runs.
CREATE OR REPLACE TASK <% database %>.MDM_AI.TASK_CHECK_MIRROR_HEALTH
  USER_TASK_MANAGED_INITIAL_WAREHOUSE_SIZE = 'XSMALL'
  SCHEDULE = '15 MINUTE'
  COMMENT = 'Mirror health → MDM_AI.ALERT_LOG (serverless: no warehouse wake-ups)'
AS
  CALL <% database %>.MDM_AI.CHECK_MIRROR_HEALTH();
ALTER TASK <% database %>.MDM_AI.TASK_CHECK_MIRROR_HEALTH RESUME;

-- ============================================================
-- Mirror status / refresh for the app (Configuration › Health, Replication)
-- ============================================================
-- The SNOWFLAKE.POSTGRES mirror procedures need the postgres_mirror_admin application role
-- and ownership of the Postgres instance. Rather than hand those to the service role, these
-- owner's-rights wrappers expose exactly the two operations the app needs.
CREATE OR REPLACE PROCEDURE <% database %>.MDM_AI.GET_MIRROR_STATUS()
RETURNS VARIANT
LANGUAGE SQL
COMMENT = 'Status of the MDM CDC mirror (LIST_MIRRORS row + lag in seconds)'
EXECUTE AS OWNER
AS
$$
DECLARE
  result VARIANT;
BEGIN
  CALL SNOWFLAKE.POSTGRES.LIST_MIRRORS('<% postgres_instance %>');
  SELECT OBJECT_INSERT(OBJECT_CONSTRUCT(*), 'CURRENT_LAG_SECONDS',
           DATEDIFF('second', "LAST_OPERATION_TIME", CURRENT_TIMESTAMP()::TIMESTAMP_NTZ))
    INTO :result
    FROM TABLE(RESULT_SCAN(LAST_QUERY_ID())) WHERE "MIRROR_NAME" = '<% mirror_name %>' LIMIT 1;
  RETURN result;
END;
$$;

CREATE OR REPLACE PROCEDURE <% database %>.MDM_AI.SET_MIRROR_REFRESH(INTERVAL STRING)
RETURNS STRING
LANGUAGE SQL
COMMENT = 'Change the MDM CDC mirror refresh interval, e.g. ''1 minute'''
EXECUTE AS OWNER
AS
$$
BEGIN
  IF (NOT REGEXP_LIKE(TRIM(:interval), '^[0-9]{1,4} (second|seconds|minute|minutes|hour|hours|day)$', 'i')) THEN
    RETURN 'invalid interval: ' || :interval;
  END IF;
  CALL SNOWFLAKE.POSTGRES.ALTER_MIRROR(mirror_name => '<% mirror_name %>', refresh_interval => TRIM(:interval));
  RETURN 'ok';
END;
$$;

GRANT USAGE ON PROCEDURE <% database %>.MDM_AI.GET_MIRROR_STATUS() TO ROLE MDM_SERVICE_ROLE;
GRANT USAGE ON PROCEDURE <% database %>.MDM_AI.SET_MIRROR_REFRESH(STRING) TO ROLE MDM_SERVICE_ROLE;
