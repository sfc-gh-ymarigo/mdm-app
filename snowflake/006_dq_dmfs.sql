-- ============================================================
-- 006 — Snowflake-side pipeline health: freshness + volume DMFs
-- ============================================================
-- Record-level data quality (rules, scores, failures, duplicates) lives in Postgres and is
-- managed in the app. Snowflake only watches what its consumers read — Analyst, PUBLISH — so a
-- stalled mirror or a sudden volume change shows in Snowflake's own quality monitoring:
--   FRESHNESS(updated_at)  seconds since the newest change reached the view
--   ROW_COUNT              records in the current-state view
-- The DMFs are attached to every module's current view by MDM_ANALYTICS.SYNC_MODULES (008),
-- on the schedule passed as dmf_schedule. Results: SNOWFLAKE.LOCAL.DATA_QUALITY_MONITORING_RESULTS
-- (Snowsight › Data Quality).
-- ============================================================

USE ROLE ACCOUNTADMIN;

-- The API's service user reads the results
GRANT APPLICATION ROLE SNOWFLAKE.DATA_QUALITY_MONITORING_VIEWER TO ROLE MDM_SERVICE_ROLE;
