-- ============================================================
-- MDM SCD Layer — Slowly Changing Dimensions from CDC Mirror
-- ============================================================
-- The Snowflake Postgres CDC mirror (<% mirror_database %>.MDM)
-- accumulates every version of each row. This script creates the
-- current-state views of the shared tables (matches, workflows, DQ,
-- audit, reference data, merges).
--
-- Module tables (customer, product, supplier …) get their current view
-- and SCD2 history table from MDM_ANALYTICS.SYNC_MODULES (008), generated
-- from the module configuration.
--
-- Hard deletes: the mirror keeps the last version of a deleted row, so
-- each id-keyed view also drops records with a newer tombstone in
-- MDM.DELETED_RECORD (written by a Postgres trigger, migration 022).
-- ============================================================

USE DATABASE <% database %>;
USE SCHEMA MDM_ANALYTICS;

-- ============================================================
-- 1. SCD TYPE 1 — Current-state dedup views
-- ============================================================
-- These views expose the latest version of each row, filtering
-- out CDC row accumulation. They serve as the "single source
-- of truth" for all downstream consumers.
-- ============================================================

CREATE OR REPLACE VIEW MDM_ANALYTICS.V_CURRENT_MATCH_CANDIDATE COPY GRANTS AS
SELECT * EXCLUDE (rn) FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY id ORDER BY created_at DESC) AS rn
    FROM <% mirror_database %>.MDM.MATCH_CANDIDATE
) v WHERE rn = 1
  AND NOT EXISTS (SELECT 1 FROM <% mirror_database %>.MDM.DELETED_RECORD d
                  WHERE d.table_name = 'match_candidate' AND d.record_id = v.id::STRING AND d.deleted_at >= v.created_at);

CREATE OR REPLACE VIEW MDM_ANALYTICS.V_CURRENT_WORKFLOW_INSTANCE COPY GRANTS AS
SELECT * EXCLUDE (rn) FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY id ORDER BY created_at DESC) AS rn
    FROM <% mirror_database %>.MDM.WORKFLOW_INSTANCE
) v WHERE rn = 1
  AND NOT EXISTS (SELECT 1 FROM <% mirror_database %>.MDM.DELETED_RECORD d
                  WHERE d.table_name = 'workflow_instance' AND d.record_id = v.id::STRING AND d.deleted_at >= v.created_at);

CREATE OR REPLACE VIEW MDM_ANALYTICS.V_CURRENT_DQ_RULE COPY GRANTS AS
SELECT * EXCLUDE (rn) FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY id ORDER BY created_at DESC) AS rn
    FROM <% mirror_database %>.MDM.DQ_RULE
) v WHERE rn = 1
  AND NOT EXISTS (SELECT 1 FROM <% mirror_database %>.MDM.DELETED_RECORD d
                  WHERE d.table_name = 'dq_rule' AND d.record_id = v.id::STRING AND d.deleted_at >= v.created_at);

-- DQ runs replace their results (delete + insert): keep the latest result per rule and record,
-- for rules that still exist (no tombstones for results, see migration 024)
CREATE OR REPLACE VIEW MDM_ANALYTICS.V_CURRENT_DQ_RESULT COPY GRANTS AS
SELECT * EXCLUDE (rn) FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY rule_id, entity_type, entity_id ORDER BY evaluated_at DESC, id DESC) AS rn
    FROM <% mirror_database %>.MDM.DQ_RESULT
) v WHERE rn = 1
  AND EXISTS (SELECT 1 FROM MDM_ANALYTICS.V_CURRENT_DQ_RULE r WHERE r.id = v.rule_id);

-- Append-only tables: audit_log, entity_comment — no dedup needed, but
-- filter out CDC duplicates by distinct ID
CREATE OR REPLACE VIEW MDM_ANALYTICS.V_CURRENT_AUDIT_LOG COPY GRANTS AS
SELECT * EXCLUDE (rn) FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY id ORDER BY performed_at DESC) AS rn
    FROM <% mirror_database %>.MDM.AUDIT_LOG
) v WHERE rn = 1
  AND NOT EXISTS (SELECT 1 FROM <% mirror_database %>.MDM.DELETED_RECORD d
                  WHERE d.table_name = 'audit_log' AND d.record_id = v.id::STRING AND d.deleted_at >= v.performed_at);

-- Reference tables (no versioning, but dedup for safety)
CREATE OR REPLACE VIEW MDM_ANALYTICS.V_CURRENT_REF_COUNTRY AS
SELECT * EXCLUDE (rn) FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY code ORDER BY code) AS rn
    FROM <% mirror_database %>.MDM.REF_COUNTRY
) WHERE rn = 1;

CREATE OR REPLACE VIEW MDM_ANALYTICS.V_CURRENT_REF_CURRENCY AS
SELECT * EXCLUDE (rn) FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY code ORDER BY code) AS rn
    FROM <% mirror_database %>.MDM.REF_CURRENCY
) WHERE rn = 1;

CREATE OR REPLACE VIEW MDM_ANALYTICS.V_CURRENT_REF_CODELIST COPY GRANTS AS
SELECT * EXCLUDE (rn) FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY id ORDER BY updated_at DESC) AS rn
    FROM <% mirror_database %>.MDM.REF_CODELIST
) v WHERE rn = 1
  AND NOT EXISTS (SELECT 1 FROM <% mirror_database %>.MDM.DELETED_RECORD d
                  WHERE d.table_name = 'ref_codelist' AND d.record_id = v.id::STRING AND d.deleted_at >= v.updated_at);

CREATE OR REPLACE VIEW MDM_ANALYTICS.V_CURRENT_PRODUCT_CATEGORY COPY GRANTS AS
SELECT * EXCLUDE (rn) FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY id ORDER BY id) AS rn
    FROM <% mirror_database %>.MDM.PRODUCT_CATEGORY
) v WHERE rn = 1
  AND NOT EXISTS (SELECT 1 FROM <% mirror_database %>.MDM.DELETED_RECORD d
                  WHERE d.table_name = 'product_category' AND d.record_id = v.id::STRING AND TRUE);

-- Merges (survivor ← merged); unmerged_at is set when a merge was undone
CREATE OR REPLACE VIEW MDM_ANALYTICS.V_CURRENT_MERGE_HISTORY COPY GRANTS AS
SELECT * EXCLUDE (rn) FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY id ORDER BY COALESCE(unmerged_at, merged_at) DESC) AS rn
    FROM <% mirror_database %>.MDM.MERGE_HISTORY
) v WHERE rn = 1
  AND NOT EXISTS (SELECT 1 FROM <% mirror_database %>.MDM.DELETED_RECORD d
                  WHERE d.table_name = 'merge_history' AND d.record_id = v.id::STRING AND d.deleted_at >= COALESCE(v.unmerged_at, v.merged_at));
