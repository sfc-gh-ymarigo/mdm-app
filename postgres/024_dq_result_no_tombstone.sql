-- 024: No tombstones for DQ results. Every DQ run deletes and re-inserts its results, so the 022 trigger
-- added a tombstone per result per run without bound. Snowflake's V_CURRENT_DQ_RESULT keeps the latest
-- result per (rule, record) instead, which needs no tombstones.

DROP TRIGGER IF EXISTS trg_dq_result_tombstone ON mdm.dq_result;
DELETE FROM mdm.deleted_record WHERE table_name = 'dq_result';
