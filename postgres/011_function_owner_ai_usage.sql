-- 011: Least-privilege owner for editable validation functions + Cortex usage log.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mdm_fn_owner') THEN
    CREATE ROLE mdm_fn_owner NOLOGIN NOBYPASSRLS;
  END IF;
END $$;

-- The API's admin connection switches to this role (SET LOCAL ROLE) to run function DDL
DO $$ BEGIN EXECUTE format('GRANT mdm_fn_owner TO %I', session_user); END $$;
GRANT USAGE, CREATE ON SCHEMA mdm TO mdm_fn_owner;
GRANT SELECT ON ALL TABLES IN SCHEMA mdm TO mdm_fn_owner;
ALTER DEFAULT PRIVILEGES IN SCHEMA mdm GRANT SELECT ON TABLES TO mdm_fn_owner;

-- Hand over plain validation functions only: not triggers, not SECURITY DEFINER
DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'mdm' AND p.proname LIKE 'fn\_validate%'
       AND NOT p.prosecdef AND p.prorettype <> 'trigger'::regtype
  LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO mdm_fn_owner', f.sig);
  END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS mdm.ai_usage_log (
  id          BIGSERIAL PRIMARY KEY,
  user_email  TEXT,
  endpoint    TEXT NOT NULL,
  model       TEXT,
  input_chars INT,
  duration_ms INT,
  ok          BOOLEAN NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS ai_usage_log_created_idx ON mdm.ai_usage_log (created_at);
