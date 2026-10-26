-- 022: Tombstones for hard deletes, so Snowflake can tell a deleted record from a current one.
--
-- The CDC mirror appends one row per version and its change log is only kept for a short window,
-- so a row deleted in Postgres keeps its last version in Snowflake indefinitely. Each delete on an
-- id-keyed MDM table now writes (table_name, record_id, deleted_at) here; the table is mirrored
-- like the rest of the schema and MDM_ANALYTICS.V_CURRENT_* hide a record whose tombstone is newer
-- than its last version (a record re-inserted with the same id after a delete shows up again).
-- The app soft-deletes (is_deleted); hard deletes come from seeding, tests and admin clean-up.

CREATE TABLE IF NOT EXISTS mdm.deleted_record (
    table_name  VARCHAR(63)  NOT NULL,
    record_id   TEXT         NOT NULL,
    deleted_at  TIMESTAMPTZ  NOT NULL DEFAULT clock_timestamp(),
    deleted_by  TEXT         DEFAULT current_setting('app.current_user', true),
    PRIMARY KEY (table_name, record_id)
);
COMMENT ON TABLE mdm.deleted_record IS 'Tombstones of hard-deleted rows; read by Snowflake current-state views';

-- SECURITY DEFINER: the app role has no grant on the tombstone table and must not need one
CREATE OR REPLACE FUNCTION mdm.fn_record_tombstone() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = mdm, pg_temp AS $$
BEGIN
  INSERT INTO mdm.deleted_record (table_name, record_id)
  VALUES (TG_TABLE_NAME, OLD.id::text)
  ON CONFLICT (table_name, record_id) DO UPDATE
    SET deleted_at = clock_timestamp(), deleted_by = current_setting('app.current_user', true);
  RETURN OLD;
END;
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['customer', 'product', 'supplier', 'match_candidate', 'workflow_instance',
                           'dq_rule', 'dq_result', 'audit_log', 'ref_codelist', 'product_category', 'merge_history']
  LOOP
    IF to_regclass('mdm.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_tombstone ON mdm.%1$I', t);
      EXECUTE format('CREATE TRIGGER trg_%1$s_tombstone AFTER DELETE ON mdm.%1$I
                      FOR EACH ROW EXECUTE FUNCTION mdm.fn_record_tombstone()', t);
    END IF;
  END LOOP;
END $$;
