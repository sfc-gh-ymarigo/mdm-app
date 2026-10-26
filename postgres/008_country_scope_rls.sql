-- MDM country scope enforcement (idempotent)
--
-- * product.country_code: market country (NULL = all markets, visible to everyone)
-- * mdm.module_scope: mirror of each module's "Country Scope" toggle (synced by the API)
-- * mdm.scope_allows(): single source of truth used by every RLS policy
-- * mdm_app: non-owner, NOBYPASSRLS login role used for user-facing API requests.
--   Its password is set out-of-band (ALTER ROLE mdm_app PASSWORD ...), never in this file.

-- ── Product market country ──────────────────────────────────────────
ALTER TABLE mdm.product ADD COLUMN IF NOT EXISTS country_code VARCHAR(3);
CREATE INDEX IF NOT EXISTS idx_product_country ON mdm.product(country_code);

-- app_user.mdm_roles is used by the API but was missing from 004_rbac.sql.
-- No DEFAULT clause: tables tracked by the snowflake_cdc publication reject ADD COLUMN ... DEFAULT.
ALTER TABLE mdm.app_user ADD COLUMN IF NOT EXISTS mdm_roles TEXT[];
UPDATE mdm.app_user SET mdm_roles = '{}' WHERE mdm_roles IS NULL;

-- ── Module scope toggles ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mdm.module_scope (
    module_id      VARCHAR(50) PRIMARY KEY,
    table_name     VARCHAR(100) NOT NULL,
    country_scoped BOOLEAN NOT NULL DEFAULT false
);

INSERT INTO mdm.module_scope (module_id, table_name, country_scoped) VALUES
    ('customer', 'mdm.customer', true),
    ('product',  'mdm.product',  false),
    ('supplier', 'mdm.supplier', true)
ON CONFLICT (module_id) DO NOTHING;

-- ── Scope check ─────────────────────────────────────────────────────
-- Allowed when: user exists and is active, AND (module not scoped OR user unscoped
-- OR country in user's scope OR (null_ok AND country IS NULL)).
CREATE OR REPLACE FUNCTION mdm.scope_allows(p_module TEXT, p_country TEXT, p_null_ok BOOLEAN DEFAULT false)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = mdm, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1 FROM mdm.app_user u
        WHERE u.email = current_setting('app.current_user', true)
          AND u.is_active
          AND (
                NOT COALESCE((SELECT s.country_scoped FROM mdm.module_scope s WHERE s.module_id = p_module), false)
             OR u.country_scope IS NULL
             OR (p_null_ok AND p_country IS NULL)
             OR p_country = ANY(u.country_scope)
          )
    );
$$;

-- Parent lookup must see out-of-scope parents to build the ltree path.
ALTER FUNCTION mdm.fn_update_hierarchy_path() SECURITY DEFINER;
ALTER FUNCTION mdm.fn_update_hierarchy_path() SET search_path = mdm, public, pg_temp;

-- ── Policies ────────────────────────────────────────────────────────
ALTER TABLE mdm.customer ENABLE ROW LEVEL SECURITY;
ALTER TABLE mdm.customer FORCE ROW LEVEL SECURITY;
ALTER TABLE mdm.product  ENABLE ROW LEVEL SECURITY;
ALTER TABLE mdm.product  FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customer_access ON mdm.customer;
CREATE POLICY customer_access ON mdm.customer FOR ALL
    USING      (mdm.scope_allows('customer', country_code))
    WITH CHECK (mdm.scope_allows('customer', country_code));

DROP POLICY IF EXISTS product_access ON mdm.product;
CREATE POLICY product_access ON mdm.product FOR ALL
    USING      (mdm.scope_allows('product', country_code, true))
    WITH CHECK (mdm.scope_allows('product', country_code, true));

DO $$
BEGIN
    IF to_regclass('mdm.supplier') IS NOT NULL THEN
        EXECUTE 'ALTER TABLE mdm.supplier ENABLE ROW LEVEL SECURITY';
        EXECUTE 'ALTER TABLE mdm.supplier FORCE ROW LEVEL SECURITY';
        EXECUTE 'DROP POLICY IF EXISTS supplier_access ON mdm.supplier';
        EXECUTE 'CREATE POLICY supplier_access ON mdm.supplier FOR ALL
                 USING (mdm.scope_allows(''supplier'', country_code))
                 WITH CHECK (mdm.scope_allows(''supplier'', country_code))';
    END IF;
END $$;

-- ── Application role ────────────────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mdm_app') THEN
        CREATE ROLE mdm_app LOGIN NOBYPASSRLS;
    END IF;
END $$;

GRANT USAGE ON SCHEMA mdm TO mdm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA mdm TO mdm_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA mdm TO mdm_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA mdm TO mdm_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA mdm GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO mdm_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA mdm GRANT USAGE, SELECT ON SEQUENCES TO mdm_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA mdm GRANT EXECUTE ON FUNCTIONS TO mdm_app;
-- The toggle table is managed by the admin pool only.
REVOKE INSERT, UPDATE, DELETE ON mdm.module_scope FROM mdm_app;
