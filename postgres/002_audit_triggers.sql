-- ============================================================
-- MDM - Audit Trail Triggers
-- ============================================================

SET search_path TO mdm, public;

-- Generic audit function (reused across entities)
CREATE OR REPLACE FUNCTION mdm.fn_audit_trigger()
RETURNS TRIGGER AS $$
DECLARE
    v_entity_type VARCHAR(20);
    v_entity_id   UUID;
    v_action      VARCHAR(10);
    v_changes     JSONB := '{}';
    v_old_json    JSONB;
    v_new_json    JSONB;
    col_name      TEXT;
BEGIN
    v_entity_type := TG_ARGV[0];

    IF TG_OP = 'DELETE' THEN
        v_entity_id := OLD.id;
        v_action := 'DELETE';
        v_old_json := to_jsonb(OLD);
        INSERT INTO mdm.audit_log(entity_type, entity_id, action, full_record, performed_by)
        VALUES (v_entity_type, v_entity_id, v_action, v_old_json, COALESCE(current_setting('app.current_user', true), CURRENT_USER));
        RETURN OLD;
    END IF;

    IF TG_OP = 'INSERT' THEN
        v_entity_id := NEW.id;
        v_action := 'INSERT';
        v_new_json := to_jsonb(NEW);
        INSERT INTO mdm.audit_log(entity_type, entity_id, action, full_record, performed_by)
        VALUES (v_entity_type, v_entity_id, v_action, v_new_json, COALESCE(current_setting('app.current_user', true), CURRENT_USER));
        RETURN NEW;
    END IF;

    -- UPDATE: compute field-level diff
    v_entity_id := NEW.id;
    v_action := 'UPDATE';
    v_old_json := to_jsonb(OLD);
    v_new_json := to_jsonb(NEW);

    FOR col_name IN
        SELECT key FROM jsonb_each(v_new_json)
        WHERE key NOT IN ('updated_at', 'updated_by')
    LOOP
        IF (v_old_json ->> col_name) IS DISTINCT FROM (v_new_json ->> col_name) THEN
            v_changes := v_changes || jsonb_build_object(
                col_name, jsonb_build_object(
                    'old', v_old_json -> col_name,
                    'new', v_new_json -> col_name
                )
            );
        END IF;
    END LOOP;

    IF v_changes != '{}' THEN
        INSERT INTO mdm.audit_log(entity_type, entity_id, action, changed_fields, full_record, performed_by)
        VALUES (v_entity_type, v_entity_id, v_action, v_changes, v_new_json, COALESCE(current_setting('app.current_user', true), CURRENT_USER));
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach triggers
CREATE TRIGGER trg_customer_audit
    AFTER INSERT OR UPDATE OR DELETE ON mdm.customer
    FOR EACH ROW EXECUTE FUNCTION mdm.fn_audit_trigger('CUSTOMER');

CREATE TRIGGER trg_product_audit
    AFTER INSERT OR UPDATE OR DELETE ON mdm.product
    FOR EACH ROW EXECUTE FUNCTION mdm.fn_audit_trigger('PRODUCT');

-- ============================================================
-- Auto-update updated_at
-- ============================================================

CREATE OR REPLACE FUNCTION mdm.fn_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_customer_updated
    BEFORE UPDATE ON mdm.customer
    FOR EACH ROW EXECUTE FUNCTION mdm.fn_set_updated_at();

CREATE TRIGGER trg_product_updated
    BEFORE UPDATE ON mdm.product
    FOR EACH ROW EXECUTE FUNCTION mdm.fn_set_updated_at();

-- ============================================================
-- Hierarchy path auto-maintenance
-- ============================================================

CREATE OR REPLACE FUNCTION mdm.fn_update_hierarchy_path()
RETURNS TRIGGER AS $$
DECLARE
    v_parent_path LTREE;
    v_has_level BOOLEAN;
BEGIN
    -- Check if the table has hierarchy_level column
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = TG_TABLE_SCHEMA AND table_name = TG_TABLE_NAME AND column_name = 'hierarchy_level'
    ) INTO v_has_level;

    IF NEW.parent_id IS NULL THEN
        NEW.hierarchy_path := text2ltree(replace(NEW.id::text, '-', '_'));
        IF v_has_level THEN
            NEW.hierarchy_level := 0;
        END IF;
    ELSE
        SELECT hierarchy_path INTO v_parent_path
        FROM mdm.customer WHERE id = NEW.parent_id;

        IF v_parent_path IS NULL THEN
            SELECT hierarchy_path INTO v_parent_path
            FROM mdm.product WHERE id = NEW.parent_id;
        END IF;

        NEW.hierarchy_path := v_parent_path || text2ltree(replace(NEW.id::text, '-', '_'));
        IF v_has_level THEN
            NEW.hierarchy_level := nlevel(NEW.hierarchy_path) - 1;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_customer_hierarchy
    BEFORE INSERT OR UPDATE OF parent_id ON mdm.customer
    FOR EACH ROW EXECUTE FUNCTION mdm.fn_update_hierarchy_path();

CREATE TRIGGER trg_product_hierarchy
    BEFORE INSERT OR UPDATE OF parent_id ON mdm.product
    FOR EACH ROW EXECUTE FUNCTION mdm.fn_update_hierarchy_path();

-- (completeness functions removed — now computed dynamically by the DQ template engine)
