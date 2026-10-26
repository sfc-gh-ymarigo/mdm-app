-- 016: Entity insert triggers owned by migrations (previously created at runtime / out of band).
-- * Golden IDs: one generator, <PREFIX>-<10-digit sequence>, e.g. GC-0000000042. The prefix is the trigger
--   argument (module golden_prefix: customer GC, product GP, supplier GS). Existing IDs are kept.
-- * Onboarding: an open ONBOARDING workflow per new record, with the entity's start stage in its payload.

CREATE SEQUENCE IF NOT EXISTS mdm.golden_id_seq;

CREATE OR REPLACE FUNCTION mdm.next_golden_id(p_prefix TEXT)
RETURNS TEXT
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = mdm, pg_temp
AS $$ SELECT upper(p_prefix) || '-' || lpad(nextval('mdm.golden_id_seq')::text, 10, '0') $$;

CREATE OR REPLACE FUNCTION mdm.fn_assign_golden_id()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.golden_id IS NULL THEN
        NEW.golden_id := mdm.next_golden_id(TG_ARGV[0]);
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION mdm.fn_auto_onboarding_workflow()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_entity_type TEXT := upper(TG_TABLE_NAME);
    v_user TEXT := COALESCE(NEW.created_by, current_setting('app.current_user', true), 'system');
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM mdm.workflow_instance
         WHERE entity_type = v_entity_type AND entity_id = NEW.id
           AND workflow_type = 'ONBOARDING' AND completed_at IS NULL
    ) THEN
        INSERT INTO mdm.workflow_instance
            (entity_type, entity_id, workflow_type, current_stage, assigned_to, priority, created_by, payload)
        VALUES
            (v_entity_type, NEW.id, 'ONBOARDING', 'DRAFT', v_user, 'MEDIUM', v_user,
             jsonb_build_object('entity_stage_at_start', NEW.lifecycle_stage));
    END IF;
    RETURN NEW;
END;
$$;

DO $$
DECLARE
    t RECORD;
BEGIN
    FOR t IN SELECT * FROM (VALUES ('customer', 'GC'), ('product', 'GP'), ('supplier', 'GS')) AS v(tbl, prefix)
             WHERE to_regclass('mdm.' || v.tbl) IS NOT NULL
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_golden_id ON mdm.%I', t.tbl, t.tbl);
        EXECUTE format('CREATE TRIGGER trg_%s_golden_id BEFORE INSERT ON mdm.%I FOR EACH ROW EXECUTE FUNCTION mdm.fn_assign_golden_id(%L)',
                       t.tbl, t.tbl, t.prefix);
        EXECUTE format('DROP TRIGGER IF EXISTS trg_auto_onboarding ON mdm.%I', t.tbl);
        EXECUTE format('CREATE TRIGGER trg_auto_onboarding AFTER INSERT ON mdm.%I FOR EACH ROW EXECUTE FUNCTION mdm.fn_auto_onboarding_workflow()',
                       t.tbl);
    END LOOP;
END $$;

GRANT USAGE, SELECT ON SEQUENCE mdm.golden_id_seq TO mdm_app;
GRANT EXECUTE ON FUNCTION mdm.next_golden_id(TEXT) TO mdm_app;
