-- 017: Merge history keeps enough to undo a merge.
-- No DEFAULT clauses: tables in the CDC publication reject ADD COLUMN ... DEFAULT.
ALTER TABLE mdm.merge_history ADD COLUMN IF NOT EXISTS survivor_snapshot JSONB;
ALTER TABLE mdm.merge_history ADD COLUMN IF NOT EXISTS loser_snapshot    JSONB;
ALTER TABLE mdm.merge_history ADD COLUMN IF NOT EXISTS repointed         JSONB;
ALTER TABLE mdm.merge_history ADD COLUMN IF NOT EXISTS unmerged_at       TIMESTAMPTZ;
ALTER TABLE mdm.merge_history ADD COLUMN IF NOT EXISTS unmerged_by       VARCHAR(200);
CREATE INDEX IF NOT EXISTS idx_merge_history_survivor ON mdm.merge_history (entity_type, survivor_id);
CREATE INDEX IF NOT EXISTS idx_merge_history_merged   ON mdm.merge_history (entity_type, merged_id);
