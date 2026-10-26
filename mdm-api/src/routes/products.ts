import { Router } from 'express';
import { withUser } from '../db.js';
import { asyncHandler } from '../asyncHandler.js';
import { parsePaging, pagedSql, pagedResult, moduleSortMap } from '../lib/paging.js';
import { getModule } from '../config.js';
import { scopeClause } from '../scope.js';

// Product list with category names (the product page); writes go through the generic /api/entities/product
const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  const { lifecycle_stage, category_id, brand, country_code } = req.query;
  const fields = (getModule('product')?.fields || []).map(f => f.name);
  const p = parsePaging(req, moduleSortMap(fields, 'p', { category_name: 'c.name', parent_category_name: 'pc.name' }), 'p.updated_at DESC, p.id');
  const search = p.q;
  const user = req.headers['x-mdm-user'] as string;
  const result = await withUser(user, async (client, appUser) => {
    let sql = `SELECT p.*,
      c.name AS category_name, c.code AS category_code,
      pc.name AS parent_category_name, pc.code AS parent_category_code
      FROM mdm.product p
      LEFT JOIN mdm.product_category c ON c.id = p.category_id
      LEFT JOIN mdm.product_category pc ON pc.id = c.parent_id
      WHERE p.is_deleted = false`;
    const params: unknown[] = [];
    const scope = scopeClause(appUser, 'product', 'p.country_code', params);
    if (scope) sql += ` AND ${scope}`;
    let idx = params.length + 1;
    if (country_code) { sql += ` AND p.country_code = $${idx++}`; params.push(country_code); }
    if (lifecycle_stage) { sql += ` AND p.lifecycle_stage = $${idx++}`; params.push(lifecycle_stage); }
    if (category_id) { sql += ` AND p.category_id = $${idx++}`; params.push(category_id); }
    if (brand) { sql += ` AND p.brand = $${idx++}`; params.push(brand); }
    if (search) { sql += ` AND (p.name ILIKE $${idx} OR p.sku ILIKE $${idx} OR p.ean ILIKE $${idx})`; params.push(`%${search}%`); idx++; }
    for (const [k, op] of [['dq_min', '>='], ['dq_max', '<=']] as const) {
      const v = Number(req.query[k]);
      if (req.query[k] !== undefined && Number.isFinite(v)) { sql += ` AND COALESCE(p.dq_score, 0) ${op} $${idx++}`; params.push(v); }
    }
    sql = pagedSql(sql, p, params);
    return client.query(sql, params);
  });
  res.json(pagedResult(result.rows, p));
}));


export default router;
