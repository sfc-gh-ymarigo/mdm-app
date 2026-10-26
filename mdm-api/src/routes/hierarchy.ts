import { Router } from 'express';
import pool, { userDb } from '../db.js';
import { asyncHandler } from '../asyncHandler.js';
import { requireAdmin } from '../middleware/requireRole.js';
import { getModule } from '../config.js';
import { assertIdent } from '../sqlGuard.js';

const router = Router();

// GET /api/hierarchy/product-categories — tree structure
router.get('/product-categories', asyncHandler(async (req, res) => {
  const result = await pool.query(
    'SELECT id, code, name, parent_id, level, is_active FROM mdm.product_category ORDER BY level, name'
  );
  const rows = result.rows;

  // Count products per category and lifecycle stage (only products visible to the caller)
  const counts = await userDb(req.headers['x-mdm-user'] as string).query(
    'SELECT category_id, lifecycle_stage, COUNT(*)::int AS count FROM mdm.product WHERE is_deleted = false AND category_id IS NOT NULL GROUP BY category_id, lifecycle_stage'
  );
  const productCounts: Record<number, number> = {};
  const stageCounts: Record<number, Record<string, number>> = {};
  counts.rows.forEach((r: { category_id: number; lifecycle_stage: string; count: number }) => {
    productCounts[r.category_id] = (productCounts[r.category_id] || 0) + r.count;
    (stageCounts[r.category_id] ??= {})[r.lifecycle_stage] = r.count;
  });

  // Build tree
  type TreeNode = { id: number; code: string; name: string; level: number; productCount: number; stages: Record<string, number>; children: TreeNode[] };
  const nodeMap = new Map<number, TreeNode>();
  const roots: TreeNode[] = [];

  for (const row of rows) {
    const node: TreeNode = { id: row.id, code: row.code, name: row.name, level: row.level, productCount: productCounts[row.id] || 0, stages: { ...stageCounts[row.id] }, children: [] };
    nodeMap.set(row.id, node);
    if (row.parent_id && nodeMap.has(row.parent_id)) {
      nodeMap.get(row.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Aggregate child product counts up to parents
  for (const root of roots) {
    root.productCount += root.children.reduce((s, c) => s + c.productCount, 0);
    for (const c of root.children) for (const [st, n] of Object.entries(c.stages)) root.stages[st] = (root.stages[st] || 0) + n;
  }

  res.json(roots);
}));

// GET /api/hierarchy/product-categories/flat — flat list for dropdowns/panels
router.get('/product-categories/flat', asyncHandler(async (req, res) => {
  const result = await pool.query(
    'SELECT id, code, name, parent_id, level, is_active FROM mdm.product_category ORDER BY level, name'
  );
  const counts = await userDb(req.headers['x-mdm-user'] as string).query(
    'SELECT category_id, COUNT(*)::int AS count FROM mdm.product WHERE is_deleted = false AND category_id IS NOT NULL GROUP BY category_id'
  );
  const productCounts: Record<number, number> = {};
  counts.rows.forEach((r: { category_id: number; count: number }) => { productCounts[r.category_id] = r.count; });
  const flat = result.rows.map((r: { id: number; code: string; name: string; parent_id: number | null; level: number; is_active: boolean }) => ({
    ...r,
    productCount: productCounts[r.id] || 0,
  }));
  // Aggregate child counts to parents
  for (const cat of flat) {
    if (cat.level === 0) {
      cat.productCount += flat.filter((c: { parent_id: number | null; productCount: number }) => c.parent_id === cat.id).reduce((s: number, c: { productCount: number }) => s + c.productCount, 0);
    }
  }
  res.json(flat);
}));

// POST /api/hierarchy/product-categories — create a new category
router.post('/product-categories', requireAdmin, asyncHandler(async (req, res) => {
  const { code, name, parent_id } = req.body;
  if (!code || !name) { res.status(400).json({ error: 'code and name are required' }); return; }
  const level = parent_id ? 1 : 0;
  const result = await pool.query(
    'INSERT INTO mdm.product_category (code, name, parent_id, level) VALUES ($1, $2, $3, $4) RETURNING *',
    [code, name, parent_id || null, level]
  );
  res.status(201).json(result.rows[0]);
}));

// PUT /api/hierarchy/product-categories/:id — update a category
router.put('/product-categories/:id', requireAdmin, asyncHandler(async (req, res) => {
  const { name, code, parent_id, is_active } = req.body;
  const fields: string[] = [];
  const params: unknown[] = [req.params.id];
  let idx = 2;
  if (name !== undefined) { fields.push(`name = $${idx++}`); params.push(name); }
  if (code !== undefined) { fields.push(`code = $${idx++}`); params.push(code); }
  if (parent_id !== undefined) { fields.push(`parent_id = $${idx++}`); params.push(parent_id); fields.push(`level = $${idx++}`); params.push(parent_id ? 1 : 0); }
  if (is_active !== undefined) { fields.push(`is_active = $${idx++}`); params.push(is_active); }
  if (fields.length === 0) { res.status(400).json({ error: 'No fields to update' }); return; }
  const result = await pool.query(
    `UPDATE mdm.product_category SET ${fields.join(', ')} WHERE id = $1 RETURNING *`, params
  );
  if (result.rows.length === 0) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(result.rows[0]);
}));

// DELETE /api/hierarchy/product-categories/:id — delete (only if no products assigned)
router.delete('/product-categories/:id', requireAdmin, asyncHandler(async (req, res) => {
  // Admin pool on purpose: the category must be empty across all countries, not just the caller's.
  const prodCheck = await pool.query(
    'SELECT COUNT(*)::int AS count FROM mdm.product WHERE category_id = $1 AND is_deleted = false', [req.params.id]
  );
  if (prodCheck.rows[0].count > 0) {
    res.status(409).json({ error: `Cannot delete: ${prodCheck.rows[0].count} product(s) assigned to this category` });
    return;
  }
  const childCheck = await pool.query(
    'SELECT COUNT(*)::int AS count FROM mdm.product_category WHERE parent_id = $1', [req.params.id]
  );
  if (childCheck.rows[0].count > 0) {
    res.status(409).json({ error: `Cannot delete: ${childCheck.rows[0].count} sub-categories exist under this category` });
    return;
  }
  const result = await pool.query('DELETE FROM mdm.product_category WHERE id = $1 RETURNING id', [req.params.id]);
  if (result.rows.length === 0) { res.status(404).json({ error: 'Not found' }); return; }
  res.json({ deleted: true });
}));

// GET /api/hierarchy/customers — customer parent-child tree
router.get('/customers', asyncHandler(async (req, res) => {
  const result = await userDb(req.headers['x-mdm-user'] as string).query(
    `SELECT id, legal_name, trade_name, parent_id, country_code, customer_type, lifecycle_stage, dq_score
     FROM mdm.customer WHERE is_deleted = false ORDER BY legal_name`
  );
  const rows = result.rows;

  type CustNode = { id: string; name: string; tradeName: string | null; country: string | null; type: string | null; stage: string; dqScore: number | null; parentId: string | null; children: CustNode[] };
  const nodeMap = new Map<string, CustNode>();
  const roots: CustNode[] = [];

  // First pass: create all nodes
  for (const row of rows) {
    nodeMap.set(row.id, {
      id: row.id, name: row.legal_name, tradeName: row.trade_name,
      country: row.country_code, type: row.customer_type, stage: row.lifecycle_stage,
      dqScore: row.dq_score ? parseFloat(row.dq_score) : null, parentId: row.parent_id || null, children: [],
    });
  }

  // Second pass: link parent-child
  for (const row of rows) {
    const node = nodeMap.get(row.id)!;
    if (row.parent_id && nodeMap.has(row.parent_id)) {
      nodeMap.get(row.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  res.json(roots);
}));

// GET /api/hierarchy/module/:moduleId — parent-child tree for any module with a 'self' hierarchy
// (suppliers, …). Same node shape as /customers; `type` is unused (no grouping level).
router.get('/module/:moduleId', asyncHandler(async (req, res) => {
  const mod = getModule(String(req.params.moduleId));
  if (!mod || !mod.enabled) { res.status(404).json({ error: 'Unknown module' }); return; }
  const h = mod.hierarchy;
  if (!h?.enabled || h.type !== 'self') { res.status(400).json({ error: 'Module has no parent-child hierarchy' }); return; }
  const [schema, table] = mod.table.split('.');
  const tbl = `${assertIdent(schema, 'schema')}.${assertIdent(table, 'table')}`;
  const nameCol = assertIdent(mod.name_field, 'name field');
  const parentCol = assertIdent(h.parent_field, 'parent field');
  const hasCountry = mod.fields.some(f => f.name === 'country_code' && f.active !== false);
  const result = await userDb(req.headers['x-mdm-user'] as string).query(
    `SELECT id, ${nameCol} AS name, ${parentCol} AS parent_id, ${hasCountry ? 'country_code' : 'NULL'} AS country_code, lifecycle_stage, dq_score
       FROM ${tbl} WHERE is_deleted = false ORDER BY ${nameCol}`
  );
  type Node = { id: string; name: string; tradeName: null; country: string | null; type: null; stage: string; dqScore: number | null; parentId: string | null; children: Node[] };
  const nodeMap = new Map<string, Node>();
  for (const r of result.rows) {
    nodeMap.set(r.id, { id: r.id, name: r.name ?? r.id, tradeName: null, country: r.country_code, type: null, stage: r.lifecycle_stage,
      dqScore: r.dq_score != null ? parseFloat(r.dq_score) : null, parentId: r.parent_id || null, children: [] });
  }
  const roots: Node[] = [];
  for (const n of nodeMap.values()) {
    if (n.parentId && nodeMap.has(n.parentId)) nodeMap.get(n.parentId)!.children.push(n);
    else roots.push(n);
  }
  res.json(roots);
}));

export default router;
