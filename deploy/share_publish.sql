-- ============================================================
-- OPTIONAL — share the PUBLISH layer with other Snowflake accounts
-- ============================================================
-- Not run by setup.sh. Review, then run as ACCOUNTADMIN:
--   snow sql -f deploy/share_publish.sql -D database=MDM -D consumer_accounts=ORG1.ACCOUNT1
--
-- What consumers get: the PUBLISH secure views (golden records + cross-reference).
-- Masking and row access policies are evaluated in the PROVIDER account's context: in a share,
-- CURRENT_ROLE()/IS_ROLE_IN_SESSION() do not match provider roles, so tagged PII is masked and
-- the fail-closed row policies hide rows unless the policies allow shares. To publish all golden
-- records to consumers, add `OR INVOKER_SHARE() IS NOT NULL` (or a specific share name) to
-- COUNTRY_SCOPE_RAP / PRODUCT_SCOPE_RAP / SUPPLIER_SCOPE_RAP in 004_governance.sql.
-- A shared secure view must only reference objects in the shared database, so the policies'
-- mapping views (GOVERNANCE.*) need REFERENCE_USAGE on the mirror database — granted below.
--
-- Later option: export PUBLISH as Iceberg tables (CREATE ICEBERG TABLE … AS SELECT on an
-- external volume) for non-Snowflake consumers; not covered here.
-- ============================================================

USE ROLE ACCOUNTADMIN;

CREATE SHARE IF NOT EXISTS MDM_PUBLISH_SHARE COMMENT = 'MDM golden records and cross-reference';
GRANT USAGE ON DATABASE <% database %> TO SHARE MDM_PUBLISH_SHARE;
GRANT USAGE ON SCHEMA <% database %>.PUBLISH TO SHARE MDM_PUBLISH_SHARE;
GRANT SELECT ON ALL VIEWS IN SCHEMA <% database %>.PUBLISH TO SHARE MDM_PUBLISH_SHARE;
-- The views read the CDC mirror database through MDM_ANALYTICS
GRANT REFERENCE_USAGE ON DATABASE <% mirror_database %> TO SHARE MDM_PUBLISH_SHARE;

ALTER SHARE MDM_PUBLISH_SHARE ADD ACCOUNTS = <% consumer_accounts %>;
SHOW GRANTS TO SHARE MDM_PUBLISH_SHARE;
