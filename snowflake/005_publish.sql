-- ============================================================
-- 005 — PUBLISH: golden records + cross-reference for consumers
-- ============================================================
-- The views themselves are generated per module by MDM_ANALYTICS.SYNC_MODULES (008):
--   <MODULE>_GOLDEN : one row per golden record (the surviving source record; merged-away and
--                     deleted records are excluded). Active fields, financial/commercial groups excluded.
--   <MODULE>_XREF   : every source record (including merged-away ones) → its golden id.
-- Secure views over MDM_ANALYTICS.V_CURRENT_*: row access policies and PII masking apply.
-- MDM_CONSUMER_ROLE reads PUBLISH only; see deploy/share_publish.sql to share it.
-- ============================================================

USE ROLE ACCOUNTADMIN;
CREATE SCHEMA IF NOT EXISTS <% database %>.PUBLISH;

GRANT USAGE ON SCHEMA <% database %>.PUBLISH TO ROLE MDM_CONSUMER_ROLE;
GRANT SELECT ON ALL VIEWS IN SCHEMA <% database %>.PUBLISH TO ROLE MDM_CONSUMER_ROLE;
GRANT SELECT ON FUTURE VIEWS IN SCHEMA <% database %>.PUBLISH TO ROLE MDM_CONSUMER_ROLE;
GRANT SELECT ON ALL VIEWS IN SCHEMA <% database %>.PUBLISH TO ROLE MDM_VIEWER_ROLE;
GRANT SELECT ON FUTURE VIEWS IN SCHEMA <% database %>.PUBLISH TO ROLE MDM_VIEWER_ROLE;
