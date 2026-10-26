-- ============================================================
-- 004 — Governance: grants, fail-closed row access policies, PII tags + masking
-- ============================================================
-- Templated for the Snowflake CLI:
--   snow sql -f snowflake/004_governance.sql -D database=MDM -D mirror_database=MDM_MIRROR
--
-- Who sees what is driven by the MDM's own user table (mdm.app_user, mirrored to
-- <mirror_database>.MDM.APP_USER):
--   app_user.sf_role        → the Snowflake role Analyst/Agent SQL runs under for that user
--   app_user.country_scope  → NULL = all countries, array = those countries only
--   mdm.module_scope        → modules whose Country Scope switch is off are not filtered
-- A role that no active app_user maps to sees NOTHING. Only ACCOUNTADMIN and the
-- service role (system jobs; Analyst never runs as it) bypass the policies.
-- Changes in app_user reach Snowflake with the mirror's refresh lag (~1 minute).
-- ============================================================

USE ROLE ACCOUNTADMIN;
CREATE SCHEMA IF NOT EXISTS <% database %>.GOVERNANCE;
-- Policies on the analytics layer read the mirror as their owner; users never need it directly

-- ── 1. Grants on the analytics layer ────────────────────────────────────────
GRANT SELECT ON ALL VIEWS IN SCHEMA <% database %>.MDM_ANALYTICS TO ROLE MDM_VIEWER_ROLE;
GRANT SELECT ON ALL DYNAMIC TABLES IN SCHEMA <% database %>.MDM_ANALYTICS TO ROLE MDM_VIEWER_ROLE;
GRANT SELECT ON FUTURE VIEWS IN SCHEMA <% database %>.MDM_ANALYTICS TO ROLE MDM_VIEWER_ROLE;
GRANT SELECT ON FUTURE DYNAMIC TABLES IN SCHEMA <% database %>.MDM_ANALYTICS TO ROLE MDM_VIEWER_ROLE;
GRANT OPERATE ON ALL DYNAMIC TABLES IN SCHEMA <% database %>.MDM_ANALYTICS TO ROLE MDM_ADMIN_ROLE;
GRANT OPERATE ON FUTURE DYNAMIC TABLES IN SCHEMA <% database %>.MDM_ANALYTICS TO ROLE MDM_ADMIN_ROLE;

-- ── 2. Mappings (read by the policies as their owner) ───────────────────────
-- One row per (Snowflake role, allowed country); '*' = every country
CREATE OR REPLACE SECURE VIEW <% database %>.GOVERNANCE.V_ROLE_SCOPE AS
SELECT DISTINCT UPPER(u.sf_role) AS sf_role, f.value::STRING AS country_code
FROM <% mirror_database %>.MDM.APP_USER u,
     LATERAL FLATTEN(input => COALESCE(u.country_scope::ARRAY, ARRAY_CONSTRUCT('*'))) f
WHERE u.is_active AND u.sf_role IS NOT NULL;

CREATE OR REPLACE SECURE VIEW <% database %>.GOVERNANCE.V_MODULE_SCOPE AS
SELECT UPPER(module_id) AS module_id, country_scoped
FROM <% mirror_database %>.MDM.MODULE_SCOPE;

-- Entity → country for side tables (workflows, matches, audit) that only carry an entity id.
-- Bootstrap only: MDM_ANALYTICS.SYNC_MODULES (008) replaces it with one branch per module.
CREATE SECURE VIEW IF NOT EXISTS <% database %>.GOVERNANCE.V_ENTITY_COUNTRY AS
SELECT NULL::STRING AS entity_type, NULL::STRING AS entity_id, NULL::STRING AS country_code,
       FALSE AS null_country_visible WHERE FALSE;

-- ── 3. Policies ─────────────────────────────────────────────────────────────
-- Module policies (<MODULE>_SCOPE_RAP on each module's views) are created by SYNC_MODULES (008).

-- Side tables: visible when the referenced entity is (entity ids are UUID in the mirror)
CREATE ROW ACCESS POLICY IF NOT EXISTS <% database %>.GOVERNANCE.ENTITY_SCOPE_RAP
AS (entity_type VARCHAR, entity_id UUID) RETURNS BOOLEAN -> FALSE;
ALTER ROW ACCESS POLICY <% database %>.GOVERNANCE.ENTITY_SCOPE_RAP SET BODY ->
    CURRENT_ROLE() IN ('ACCOUNTADMIN', 'MDM_SERVICE_ROLE')
    -- all-country roles see every row, including rows whose entity no longer exists
    OR EXISTS (SELECT 1 FROM <% database %>.GOVERNANCE.V_ROLE_SCOPE s WHERE s.sf_role = CURRENT_ROLE() AND s.country_code = '*')
    OR EXISTS (
        SELECT 1
        FROM <% database %>.GOVERNANCE.V_ROLE_SCOPE s
        JOIN <% database %>.GOVERNANCE.V_ENTITY_COUNTRY e ON TRUE
        JOIN <% database %>.GOVERNANCE.V_MODULE_SCOPE m ON m.module_id = e.entity_type
        WHERE s.sf_role = CURRENT_ROLE()
          AND e.entity_type = UPPER(entity_type) AND e.entity_id = entity_id::STRING
          AND (NOT m.country_scoped OR s.country_code = e.country_code
               OR (e.country_code IS NULL AND e.null_country_visible))
    );

-- ── 4. Attach (idempotent: drop then add) ───────────────────────────────────
ALTER VIEW <% database %>.MDM_ANALYTICS.V_CURRENT_WORKFLOW_INSTANCE DROP ALL ROW ACCESS POLICIES;
ALTER VIEW <% database %>.MDM_ANALYTICS.V_CURRENT_WORKFLOW_INSTANCE ADD ROW ACCESS POLICY <% database %>.GOVERNANCE.ENTITY_SCOPE_RAP ON (entity_type, entity_id);
ALTER VIEW <% database %>.MDM_ANALYTICS.V_CURRENT_MATCH_CANDIDATE DROP ALL ROW ACCESS POLICIES;
ALTER VIEW <% database %>.MDM_ANALYTICS.V_CURRENT_MATCH_CANDIDATE ADD ROW ACCESS POLICY <% database %>.GOVERNANCE.ENTITY_SCOPE_RAP ON (entity_type, entity_id_a);
ALTER VIEW <% database %>.MDM_ANALYTICS.V_CURRENT_AUDIT_LOG DROP ALL ROW ACCESS POLICIES;
ALTER VIEW <% database %>.MDM_ANALYTICS.V_CURRENT_AUDIT_LOG ADD ROW ACCESS POLICY <% database %>.GOVERNANCE.ENTITY_SCOPE_RAP ON (entity_type, entity_id);

-- ── 5. Raw mirror is not a user surface ─────────────────────────────────────
-- Users read the analytics views (row access + masking applied). Direct SELECT on the
-- mirror would bypass both, so only the service role keeps it.
REVOKE SELECT ON ALL TABLES IN SCHEMA <% mirror_database %>.MDM FROM ROLE MDM_VIEWER_ROLE;
REVOKE USAGE ON SCHEMA <% mirror_database %>.MDM FROM ROLE MDM_VIEWER_ROLE;
REVOKE USAGE ON DATABASE <% mirror_database %> FROM ROLE MDM_VIEWER_ROLE;

-- ── 6. PII: tag + tag-based masking ─────────────────────────────────────────
-- Columns tagged GOVERNANCE.PII_TYPE are masked unless a role in the session is listed in
-- GOVERNANCE.PII_UNMASK_ROLES. That table is owned by the MDM: the API rewrites it whenever an
-- admin saves "PII unmask roles" on the Configuration page (governance.pii_unmask_roles).
-- IS_ROLE_IN_SESSION honours role hierarchy, so listing MDM_STEWARD_ROLE also covers roles
-- granted it. The service role (system jobs) and ACCOUNTADMIN always see clear values.
CREATE TAG IF NOT EXISTS <% database %>.GOVERNANCE.PII_TYPE ALLOWED_VALUES 'TAX_ID', 'EMAIL', 'PHONE'
  COMMENT = 'Personal / identifying data; masked by GOVERNANCE.PII_STRING_MASK';

CREATE TABLE IF NOT EXISTS <% database %>.GOVERNANCE.PII_UNMASK_ROLES (
  role_name  STRING NOT NULL,
  synced_by  STRING,
  synced_at  TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP()
) COMMENT = 'Roles that see PII in clear. Managed from the MDM Configuration page; edits here are overwritten on the next save.';
GRANT SELECT, INSERT, DELETE ON TABLE <% database %>.GOVERNANCE.PII_UNMASK_ROLES TO ROLE MDM_SERVICE_ROLE;
-- First install: admins only, until the Configuration page says otherwise
INSERT INTO <% database %>.GOVERNANCE.PII_UNMASK_ROLES (role_name, synced_by)
SELECT 'MDM_ADMIN_ROLE', 'install' WHERE NOT EXISTS (SELECT 1 FROM <% database %>.GOVERNANCE.PII_UNMASK_ROLES);

CREATE MASKING POLICY IF NOT EXISTS <% database %>.GOVERNANCE.PII_STRING_MASK
AS (val STRING) RETURNS STRING -> '***';
ALTER MASKING POLICY <% database %>.GOVERNANCE.PII_STRING_MASK SET BODY ->
  CASE
    WHEN val IS NULL THEN NULL
    WHEN IS_ROLE_IN_SESSION('ACCOUNTADMIN') OR IS_ROLE_IN_SESSION('MDM_SERVICE_ROLE') THEN val
    WHEN EXISTS (SELECT 1 FROM <% database %>.GOVERNANCE.PII_UNMASK_ROLES r WHERE IS_ROLE_IN_SESSION(r.role_name)) THEN val
    -- email: keep the domain; tax id / phone: keep the last 4 characters
    WHEN SYSTEM$GET_TAG_ON_CURRENT_COLUMN('<% database %>.GOVERNANCE.PII_TYPE') = 'EMAIL'
      THEN REGEXP_REPLACE(val, '^[^@]*', '***')
    WHEN LENGTH(val) > 4 THEN REPEAT('*', LENGTH(val) - 4) || RIGHT(val, 4)
    ELSE '****'
  END;
ALTER MASKING POLICY <% database %>.GOVERNANCE.PII_STRING_MASK SET COMMENT =
  'Tag-based (PII_TYPE). Clear for ACCOUNTADMIN, MDM_SERVICE_ROLE and roles in GOVERNANCE.PII_UNMASK_ROLES';
-- Bind the policy to the tag once (re-binding the same policy raises an error)
EXECUTE IMMEDIATE $$
BEGIN
  ALTER TAG <% database %>.GOVERNANCE.PII_TYPE SET MASKING POLICY <% database %>.GOVERNANCE.PII_STRING_MASK;
EXCEPTION
  WHEN STATEMENT_ERROR THEN
    IF (NOT CONTAINS(:SQLERRM, 'already')) THEN RAISE; END IF;
END;
$$;

-- Module views are tagged when SYNC_MODULES (008) creates them and by SET_PII_COLUMNS (below)
-- when the column selection changes; views built on them (360, PUBLISH) inherit the masking.

-- ── 7. PII column selection from the app (Configuration › Security › Data masking) ──
-- Owner's rights: tags exactly COLS of V_CURRENT_<ENTITY> / <ENTITY>_HISTORY with PII_TYPE and
-- untags the other text columns. Only touches those two objects, only the PII_TYPE tag.
CREATE OR REPLACE PROCEDURE <% database %>.GOVERNANCE.SET_PII_COLUMNS(ENTITY STRING, COLS ARRAY)
RETURNS STRING
LANGUAGE SQL
COMMENT = 'Tags exactly COLS (text columns) of the entity current view and history table with PII_TYPE; untags the rest. Called by the MDM app on Data masking save.'
EXECUTE AS OWNER
AS
$$
DECLARE
  objs RESULTSET;
  set_list STRING;
  unset_list STRING;
  done STRING := '';
BEGIN
  objs := (SELECT table_name, IFF(table_type = 'VIEW', 'VIEW', 'DYNAMIC TABLE') AS kind
             FROM <% database %>.INFORMATION_SCHEMA.TABLES
            WHERE table_schema = 'MDM_ANALYTICS'
              AND table_name IN ('V_CURRENT_' || UPPER(:ENTITY), UPPER(:ENTITY) || '_HISTORY'));
  FOR o IN objs DO
    LET obj STRING := o.table_name;
    LET kind STRING := o.kind;
    SELECT LISTAGG(IFF(ARRAY_CONTAINS(LOWER(column_name)::VARIANT, :COLS),
                       'COLUMN ' || column_name || ' SET TAG <% database %>.GOVERNANCE.PII_TYPE = ''' ||
                         CASE WHEN column_name ILIKE '%EMAIL%' THEN 'EMAIL' WHEN column_name ILIKE '%PHONE%' THEN 'PHONE' ELSE 'TAX_ID' END || '''',
                       NULL), ', '),
           LISTAGG(IFF(ARRAY_CONTAINS(LOWER(column_name)::VARIANT, :COLS), NULL,
                       'COLUMN ' || column_name || ' UNSET TAG <% database %>.GOVERNANCE.PII_TYPE'), ', ')
      INTO :set_list, :unset_list
      FROM <% database %>.INFORMATION_SCHEMA.COLUMNS
     WHERE table_schema = 'MDM_ANALYTICS' AND table_name = :obj AND data_type = 'TEXT';
    IF (unset_list IS NOT NULL AND unset_list <> '') THEN
      EXECUTE IMMEDIATE 'ALTER ' || kind || ' <% database %>.MDM_ANALYTICS.' || obj || ' MODIFY ' || unset_list;
    END IF;
    IF (set_list IS NOT NULL AND set_list <> '') THEN
      EXECUTE IMMEDIATE 'ALTER ' || kind || ' <% database %>.MDM_ANALYTICS.' || obj || ' MODIFY ' || set_list;
    END IF;
    done := done || obj || ' ';
  END FOR;
  RETURN 'tagged: ' || done;
END;
$$;
GRANT USAGE ON PROCEDURE <% database %>.GOVERNANCE.SET_PII_COLUMNS(STRING, ARRAY) TO ROLE MDM_SERVICE_ROLE;
