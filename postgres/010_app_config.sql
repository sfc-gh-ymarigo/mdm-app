-- 010: Application configuration stored in Postgres (versioned, with history + NOTIFY).

CREATE TABLE IF NOT EXISTS mdm.app_config (
  id         TEXT PRIMARY KEY,
  version    INT  NOT NULL,
  doc        JSONB NOT NULL,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS mdm.app_config_history (
  id         TEXT NOT NULL,
  version    INT  NOT NULL,
  doc        JSONB NOT NULL,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (id, version)
);

CREATE OR REPLACE FUNCTION mdm.fn_app_config_changed() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO mdm.app_config_history (id, version, doc, updated_by, updated_at)
  VALUES (NEW.id, NEW.version, NEW.doc, NEW.updated_by, NEW.updated_at)
  ON CONFLICT DO NOTHING;
  PERFORM pg_notify('mdm_config', json_build_object('id', NEW.id, 'version', NEW.version)::text);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_app_config_changed ON mdm.app_config;
CREATE TRIGGER trg_app_config_changed AFTER INSERT OR UPDATE ON mdm.app_config
  FOR EACH ROW EXECUTE FUNCTION mdm.fn_app_config_changed();

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mdm_app') THEN
    GRANT SELECT ON mdm.app_config, mdm.app_config_history TO mdm_app;
  END IF;
END $$;
