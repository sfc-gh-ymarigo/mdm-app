-- 018: Per-user read state for computed notifications (workflows, DQ failures, merges).
-- Notifications themselves are derived from live data; only "read" is stored.
CREATE TABLE IF NOT EXISTS mdm.notification_read (
  user_email VARCHAR(200) NOT NULL,
  notif_key  VARCHAR(200) NOT NULL,
  read_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (user_email, notif_key)
);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mdm_app') THEN
    GRANT SELECT, INSERT, DELETE ON mdm.notification_read TO mdm_app;
  END IF;
END $$;
