-- MDM RBAC: App users + Row Level Security
-- This adds a user directory and Postgres RLS policies so data access
-- is enforced at the database level, not just the application.

-- 1. App user table
CREATE TABLE IF NOT EXISTS mdm.app_user (
    email           VARCHAR(200) PRIMARY KEY,
    display_name    VARCHAR(200) NOT NULL,
    role            VARCHAR(30)  NOT NULL DEFAULT 'VIEWER',  -- ADMIN, STEWARD, VIEWER
    country_scope   VARCHAR(10)[] DEFAULT NULL,               -- NULL = all countries, else only listed
    entity_scope    VARCHAR(20)[] DEFAULT ARRAY['CUSTOMER','PRODUCT'],
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Seed demo users
INSERT INTO mdm.app_user (email, display_name, role, country_scope) VALUES
  ('benoit.declarens@example.com', 'Benoit De Clarens', 'ADMIN', NULL),
  ('alice.martin@example.com',     'Alice Martin',      'STEWARD', ARRAY['FRA', 'BEL']),
  ('hans.mueller@example.com',     'Hans Mueller',      'STEWARD', ARRAY['DEU']),
  ('sarah.jones@example.com',      'Sarah Jones',       'VIEWER', ARRAY['GBR'])
ON CONFLICT (email) DO NOTHING;

-- 3. Enable RLS on customer and product tables
ALTER TABLE mdm.customer ENABLE ROW LEVEL SECURITY;
ALTER TABLE mdm.product  ENABLE ROW LEVEL SECURITY;

-- Force RLS even for table owners (the connection role)
ALTER TABLE mdm.customer FORCE ROW LEVEL SECURITY;
ALTER TABLE mdm.product  FORCE ROW LEVEL SECURITY;

-- 4. RLS policies
-- Drop existing policies if re-running
DROP POLICY IF EXISTS customer_access ON mdm.customer;
DROP POLICY IF EXISTS product_access  ON mdm.product;

-- Customers: filter by country_scope of the current app user
-- If the user has NULL country_scope (ADMIN), they see everything
CREATE POLICY customer_access ON mdm.customer
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM mdm.app_user u
      WHERE u.email = current_setting('app.current_user', true)
        AND u.is_active = true
        AND (u.country_scope IS NULL OR mdm.customer.country_code = ANY(u.country_scope))
    )
  );

-- Products: all users see all products (products aren't country-specific)
-- but VIEWER role can only SELECT, enforced at app level
CREATE POLICY product_access ON mdm.product
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM mdm.app_user u
      WHERE u.email = current_setting('app.current_user', true)
        AND u.is_active = true
    )
  );
