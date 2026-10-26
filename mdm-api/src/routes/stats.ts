import { Router } from 'express';
import { userDb } from '../db.js';
import { asyncHandler } from '../asyncHandler.js';
import { visibleEntity } from '../scope.js';
import { getModules } from '../config.js';
import { isIdent } from '../sqlGuard.js';
import type { ModuleConfig } from '../modules/types.js';

const router = Router();
const TABLE_RE = /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/;

// Label column for a filter on a foreign key, e.g. product.category_id → product_category.name
function joinedLabel(mod: ModuleConfig, field: string): { join: string; expr: string } | null {
  for (const j of mod.joins || []) {
    const m = j.on.match(/^(\w+)\.id = \{table\}\.(\w+)$/);
    if (!m || m[1] !== j.alias || m[2] !== field || !TABLE_RE.test(j.table) || !isIdent(j.alias)) continue;
    const nameCol = Object.values(j.columns).find(c => /^\w+\.name$/.test(c));
    if (nameCol) return { join: `LEFT JOIN ${j.table} ${j.alias} ON ${j.alias}.id = e.${field}`, expr: nameCol };
  }
  return null;
}

async function moduleStats(pool: ReturnType<typeof userDb>, mod: ModuleConfig) {
  const fields = new Set(mod.fields.filter(f => f.active !== false).map(f => f.name));
  const table = mod.table;
  if (!TABLE_RE.test(table)) throw new Error(`Invalid table for module ${mod.id}`);
  const entity = mod.id.toUpperCase();
  const hasCountry = fields.has('country_code');
  const dims = (mod.filters || [])
    .map(f => f.field)
    .filter(f => isIdent(f) && fields.has(f) && f !== 'lifecycle_stage' && f !== 'country_code');

  const [base, live, ...breakdowns] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS total, AVG(dq_score)::float AS avg_dq, AVG(completeness)::float AS avg_completeness,
                       lifecycle_stage${hasCountry ? ', country_code' : ''}
                FROM ${table} WHERE is_deleted = false GROUP BY lifecycle_stage${hasCountry ? ', country_code' : ''}`),
    // Stage reached at the end of onboarding (ACTIVE, PUBLISHED …), same rule as SYNC_MODULES
    pool.query(`SELECT t.entity_stage FROM mdm.ref_lifecycle_transition t
                JOIN mdm.ref_lifecycle_stage s ON s.entity_type = t.entity_type AND s.stage_code = t.entity_stage
                WHERE t.entity_type = $1 AND t.workflow_type = 'ONBOARDING' ORDER BY s.sort_order DESC LIMIT 1`, [entity]),
    ...dims.map(d => {
      const j = joinedLabel(mod, d);
      return pool.query(`SELECT e.${d}::text AS key, ${j ? j.expr : `e.${d}`}::text AS value, COUNT(*)::int AS count
                         FROM ${table} e ${j ? j.join : ''} WHERE e.is_deleted = false AND e.${d} IS NOT NULL
                         GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 10`);
    }),
  ]);

  const byStage: Record<string, number> = {};
  const byCountry: Record<string, number> = {};
  let total = 0, dqSum = 0, dqN = 0, coSum = 0, coN = 0;
  for (const r of base.rows) {
    byStage[r.lifecycle_stage] = (byStage[r.lifecycle_stage] || 0) + r.total;
    if (r.country_code) byCountry[r.country_code] = (byCountry[r.country_code] || 0) + r.total;
    total += r.total;
    if (r.avg_dq != null) { dqSum += r.avg_dq * r.total; dqN += r.total; }
    if (r.avg_completeness != null) { coSum += r.avg_completeness * r.total; coN += r.total; }
  }
  const liveStage: string = live.rows[0]?.entity_stage || 'ACTIVE';

  return {
    id: mod.id,
    label: mod.label,
    labels: mod.labels || {},
    icon: mod.icon,
    total,
    live_stage: liveStage,
    live: byStage[liveStage] || 0,
    avg_dq_score: dqN ? dqSum / dqN : 0,
    avg_completeness: coN ? coSum / coN : 0,
    by_stage: byStage,
    by_country: hasCountry ? Object.entries(byCountry).map(([country, count]) => ({ country, count })) : null,
    breakdowns: dims.map((d, i) => ({
      field: d,
      label: mod.filters.find(f => f.field === d)?.label || d,
      values: breakdowns[i].rows as { key: string; value: string; count: number }[],
    })),
  };
}

// Every figure is computed under the caller's identity, so scoped users only see their countries.
router.get('/dashboard', asyncHandler(async (req, res) => {
  const pool = userDb(req.headers['x-mdm-user'] as string);
  const mods = getModules().filter(m => m.enabled);
  const [modules, workflows, matches, recentAudit, dqRules] = await Promise.all([
    Promise.all(mods.map(m => moduleStats(pool, m))),
    pool.query(`SELECT COUNT(*)::int AS total FROM mdm.workflow_instance w WHERE w.completed_at IS NULL AND ${visibleEntity('w.entity_type', 'w.entity_id')}`),
    pool.query(`SELECT COUNT(*)::int AS total FROM mdm.match_candidate m WHERE m.status = 'PENDING' AND ${visibleEntity('m.entity_type', 'm.entity_id_a')} AND ${visibleEntity('m.entity_type', 'm.entity_id_b')}`),
    pool.query(`SELECT a.entity_type, a.action, COUNT(*)::int AS cnt FROM mdm.audit_log a WHERE a.performed_at > NOW() - INTERVAL '30 days' AND ${visibleEntity('a.entity_type', 'a.entity_id')} GROUP BY a.entity_type, a.action ORDER BY a.entity_type, a.action`),
    pool.query(`SELECT r.rule_type, COUNT(DISTINCT r.id)::int AS rule_count, COUNT(CASE WHEN d.passed THEN 1 END)::int AS pass_count, COUNT(d.id)::int AS eval_count FROM mdm.dq_rule r LEFT JOIN mdm.dq_result d ON d.rule_id = r.id AND ${visibleEntity('d.entity_type', 'd.entity_id')} WHERE r.is_active = true GROUP BY r.rule_type`),
  ]);

  res.json({
    modules,
    pending_workflows: workflows.rows[0].total,
    pending_matches: matches.rows[0].total,
    dq_by_type: dqRules.rows.map(r => ({
      rule_type: r.rule_type,
      rule_count: r.rule_count,
      pass_rate: r.eval_count > 0 ? Math.round((r.pass_count / r.eval_count) * 100) : 0,
    })),
    activity_summary: recentAudit.rows.map(r => ({ entity_type: r.entity_type, action: r.action, count: r.cnt })),
  });
}));

export default router;
