-- 019: Scale — list indexes, candidate pair uniqueness, embedding cache.

-- Default list order (updated_at DESC) and common filters on entity tables
CREATE INDEX IF NOT EXISTS idx_customer_list ON mdm.customer (updated_at DESC) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_customer_stage ON mdm.customer (lifecycle_stage) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_customer_country ON mdm.customer (country_code) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_customer_golden ON mdm.customer (golden_id);
CREATE INDEX IF NOT EXISTS idx_product_list ON mdm.product (updated_at DESC) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_product_stage ON mdm.product (lifecycle_stage) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_product_golden ON mdm.product (golden_id);
CREATE INDEX IF NOT EXISTS idx_supplier_list ON mdm.supplier (updated_at DESC) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_supplier_golden ON mdm.supplier (golden_id);
CREATE INDEX IF NOT EXISTS idx_workflow_open ON mdm.workflow_instance (created_at) WHERE completed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_dq_result_rule_entity ON mdm.dq_result (rule_id, entity_id);

-- One PENDING candidate per unordered pair; lets scans insert with ON CONFLICT instead of
-- loading every existing pair into memory. Remove any duplicates first (keep the best score).
DELETE FROM mdm.match_candidate m
 USING mdm.match_candidate k
 WHERE m.status = 'PENDING' AND k.status = 'PENDING'
   AND m.entity_type = k.entity_type
   AND LEAST(m.entity_id_a, m.entity_id_b) = LEAST(k.entity_id_a, k.entity_id_b)
   AND GREATEST(m.entity_id_a, m.entity_id_b) = GREATEST(k.entity_id_a, k.entity_id_b)
   AND (m.match_score, m.id) < (k.match_score, k.id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_match_candidate_pending_pair
  ON mdm.match_candidate (entity_type, LEAST(entity_id_a, entity_id_b), GREATEST(entity_id_a, entity_id_b))
  WHERE status = 'PENDING';

-- Embedding vectors, reused while the embedded text (content_hash) is unchanged
CREATE TABLE IF NOT EXISTS mdm.embedding_cache (
    entity_type   VARCHAR(20) NOT NULL,
    entity_id     UUID NOT NULL,
    model         VARCHAR(60) NOT NULL,
    content_hash  CHAR(64) NOT NULL,
    vector        REAL[] NOT NULL,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (entity_type, entity_id, model)
);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mdm_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON mdm.embedding_cache TO mdm_app;
  END IF;
END $$;
