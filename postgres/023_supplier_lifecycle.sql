-- 023: Lifecycle for the supplier module. 013 created the table and 015 seeded only its
-- hierarchy-change transitions, so the supplier workflow configuration had no stages.
-- Suppliers get the customer lifecycle (DRAFT → REVIEW → VALIDATED → ACTIVE, suspend/archive)
-- and its onboarding / deactivation workflows; skipped where supplier stages already exist.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM mdm.ref_lifecycle_stage WHERE entity_type = 'SUPPLIER') THEN
    RETURN;
  END IF;

  INSERT INTO mdm.ref_lifecycle_stage (entity_type, stage_code, stage_label, sort_order, is_terminal, description)
  SELECT 'SUPPLIER', stage_code, stage_label, sort_order, is_terminal, description
    FROM mdm.ref_lifecycle_stage WHERE entity_type = 'CUSTOMER';

  INSERT INTO mdm.ref_lifecycle_transition (entity_type, from_stage_code, to_stage_code, required_role, workflow_type, entity_stage)
  SELECT 'SUPPLIER', from_stage_code, to_stage_code, required_role, workflow_type, entity_stage
    FROM mdm.ref_lifecycle_transition
   WHERE entity_type = 'CUSTOMER' AND (workflow_type IS NULL OR workflow_type IN ('ONBOARDING', 'DEACTIVATION'));
END $$;
