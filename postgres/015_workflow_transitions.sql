-- 015: Workflow paths as data.
-- * ref_lifecycle_transition.workflow_type: rows for a specific workflow type (NULL = generic lifecycle rows,
--   used by workflow types that have no rows of their own).
-- * ref_lifecycle_transition.entity_stage: entity lifecycle stage set when the transition is taken
--   (NULL = entity unchanged). Generic rows move the entity to to_stage_code.
-- * workflow_instance.payload.entity_stage_at_start: restored on REJECT (back-filled for open workflows).
-- No DEFAULT clauses: tables in the CDC publication reject ADD COLUMN ... DEFAULT.

-- payload predates the migration runner on early instances; declared here so fresh databases build.
ALTER TABLE mdm.workflow_instance ADD COLUMN IF NOT EXISTS payload JSONB;
ALTER TABLE mdm.ref_lifecycle_transition ADD COLUMN IF NOT EXISTS workflow_type VARCHAR(40);
ALTER TABLE mdm.ref_lifecycle_transition ADD COLUMN IF NOT EXISTS entity_stage VARCHAR(30);

ALTER TABLE mdm.ref_lifecycle_transition
  DROP CONSTRAINT IF EXISTS ref_lifecycle_transition_entity_type_from_stage_code_to_sta_key;
CREATE UNIQUE INDEX IF NOT EXISTS ux_lifecycle_transition
  ON mdm.ref_lifecycle_transition (entity_type, COALESCE(workflow_type, ''), from_stage_code, to_stage_code);

INSERT INTO mdm.ref_lifecycle_transition (entity_type, workflow_type, from_stage_code, to_stage_code, required_role, entity_stage)
VALUES
  -- Onboarding: up to the first operational stage
  ('CUSTOMER', 'ONBOARDING',       'DRAFT',      'REVIEW',       'DATA_STEWARD',    'REVIEW'),
  ('CUSTOMER', 'ONBOARDING',       'REVIEW',     'VALIDATED',    'DATA_STEWARD',    'VALIDATED'),
  ('CUSTOMER', 'ONBOARDING',       'VALIDATED',  'ACTIVE',       'DATA_MANAGER',    'ACTIVE'),
  ('PRODUCT',  'ONBOARDING',       'DRAFT',      'ENRICHMENT',   'DATA_STEWARD',    'ENRICHMENT'),
  ('PRODUCT',  'ONBOARDING',       'ENRICHMENT', 'REVIEW',       'DATA_STEWARD',    'REVIEW'),
  ('PRODUCT',  'ONBOARDING',       'REVIEW',     'APPROVED',     'PRODUCT_MANAGER', 'APPROVED'),
  ('PRODUCT',  'ONBOARDING',       'APPROVED',   'PUBLISHED',    'DATA_MANAGER',    'PUBLISHED'),
  -- Enrichment: complete once handed to review
  ('PRODUCT',  'ENRICHMENT',       'DRAFT',      'ENRICHMENT',   'DATA_STEWARD',    'ENRICHMENT'),
  ('PRODUCT',  'ENRICHMENT',       'ENRICHMENT', 'REVIEW',       'DATA_STEWARD',    'REVIEW'),
  -- Deactivation: workflow-only stages, entity archived/discontinued on approval
  ('CUSTOMER', 'DEACTIVATION',     'DRAFT',      'REVIEW',       'DATA_STEWARD',    NULL),
  ('CUSTOMER', 'DEACTIVATION',     'REVIEW',     'ARCHIVED',     'DATA_MANAGER',    'ARCHIVED'),
  ('PRODUCT',  'DEACTIVATION',     'DRAFT',      'REVIEW',       'DATA_STEWARD',    NULL),
  ('PRODUCT',  'DEACTIVATION',     'REVIEW',     'DISCONTINUED', 'DATA_MANAGER',    'DISCONTINUED'),
  -- Hierarchy change: entity stage untouched, parent change applied on approval
  ('CUSTOMER', 'HIERARCHY_CHANGE', 'DRAFT',      'REVIEW',       'DATA_STEWARD',    NULL),
  ('CUSTOMER', 'HIERARCHY_CHANGE', 'REVIEW',     'APPROVED',     'DATA_MANAGER',    NULL),
  ('PRODUCT',  'HIERARCHY_CHANGE', 'DRAFT',      'REVIEW',       'DATA_STEWARD',    NULL),
  ('PRODUCT',  'HIERARCHY_CHANGE', 'REVIEW',     'APPROVED',     'DATA_MANAGER',    NULL),
  ('SUPPLIER', 'HIERARCHY_CHANGE', 'DRAFT',      'REVIEW',       'DATA_STEWARD',    NULL),
  ('SUPPLIER', 'HIERARCHY_CHANGE', 'REVIEW',     'APPROVED',     'DATA_MANAGER',    NULL)
ON CONFLICT DO NOTHING;

-- Start stage for open workflows (best effort: the entity's current stage)
UPDATE mdm.workflow_instance w
   SET payload = COALESCE(w.payload, '{}'::jsonb) || jsonb_build_object('entity_stage_at_start', e.stage)
  FROM (
    SELECT id, lifecycle_stage AS stage, 'CUSTOMER' AS t FROM mdm.customer
    UNION ALL SELECT id, lifecycle_stage, 'PRODUCT' FROM mdm.product
    UNION ALL SELECT id, lifecycle_stage, 'SUPPLIER' FROM mdm.supplier
  ) e
 WHERE w.completed_at IS NULL AND e.id = w.entity_id AND e.t = w.entity_type
   AND NOT (COALESCE(w.payload, '{}'::jsonb) ? 'entity_stage_at_start');
