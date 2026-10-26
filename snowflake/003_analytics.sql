-- ============================================================
-- 003 — Analytical views over the current-state layer (002)
-- ============================================================
-- DQ scorecard. The per-module views (V_<TABLE>_360, V_MDM_KPIS, V_WORKFLOW_QUEUE) are generated
-- by MDM_ANALYTICS.SYNC_MODULES (008) from the module configuration.
-- ============================================================

USE DATABASE <% database %>;
USE SCHEMA MDM_ANALYTICS;

CREATE OR REPLACE VIEW v_dq_scorecard AS
SELECT
    r.entity_type,
    r.rule_type,
    r.severity,
    r.rule_code,
    r.rule_name,
    COUNT(dr.id) AS total_evaluated,
    COUNT_IF(dr.passed) AS passed,
    COUNT_IF(NOT dr.passed) AS failed,
    ROUND(100.0 * COUNT_IF(dr.passed) / NULLIF(COUNT(dr.id), 0), 2) AS pass_rate
FROM MDM_ANALYTICS.V_CURRENT_dq_rule r
LEFT JOIN MDM_ANALYTICS.V_CURRENT_dq_result dr ON dr.rule_id = r.id
WHERE r.is_active = TRUE
GROUP BY r.entity_type, r.rule_type, r.severity, r.rule_code, r.rule_name;
