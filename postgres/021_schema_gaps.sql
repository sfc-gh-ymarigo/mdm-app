-- 021: Objects that early instances created outside the migration files. Idempotent: a no-op where
-- they already exist, and makes fresh databases (tests, new installs) match.

CREATE TABLE IF NOT EXISTS mdm.dq_run_history (
    id           BIGSERIAL PRIMARY KEY,
    rule_id      INT NOT NULL REFERENCES mdm.dq_rule(id) ON DELETE CASCADE,
    entity_type  VARCHAR(20) NOT NULL,
    total        INT NOT NULL,
    passed       INT NOT NULL,
    failed       INT NOT NULL,
    pass_rate    NUMERIC(5,2) NOT NULL,
    run_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dq_run_history_rule ON mdm.dq_run_history (rule_id, run_at);

CREATE TABLE IF NOT EXISTS mdm.ref_mdm_role (
    role_code    VARCHAR(50) PRIMARY KEY,
    role_label   VARCHAR(100) NOT NULL,
    description  TEXT,
    sort_order   INT NOT NULL DEFAULT 99,
    is_system    BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO mdm.ref_mdm_role (role_code, role_label, description, sort_order, is_system) VALUES
  ('DATA_STEWARD', 'Data Steward', 'Reviews, validates and enriches master data records', 10, true),
  ('DATA_MANAGER', 'Data Manager', 'Approves and publishes master data, manages lifecycle', 20, true),
  ('DATA_OWNER', 'Data Owner', 'Business owner responsible for data domain quality and policies', 30, true),
  ('DATA_ANALYST', 'Data Analyst', 'Read-only access with analytics and reporting capabilities', 40, true),
  ('DATA_CONSUMER', 'Data Consumer', 'Read-only access to published master data', 50, true),
  ('PRODUCT_MANAGER', 'Product Manager', 'Manages product data lifecycle and approvals', 60, true),
  ('COMPLIANCE_OFFICER', 'Compliance Officer', 'Oversees data governance, privacy and regulatory compliance', 70, true),
  ('MDM_ADMIN', 'MDM Administrator', 'Full system administration and configuration access', 80, true)
ON CONFLICT (role_code) DO NOTHING;

ALTER TABLE mdm.ref_lifecycle_stage ADD COLUMN IF NOT EXISTS description TEXT;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mdm_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON mdm.dq_run_history, mdm.ref_mdm_role TO mdm_app;
    GRANT USAGE, SELECT ON SEQUENCE mdm.dq_run_history_id_seq TO mdm_app;
  END IF;
END $$;
