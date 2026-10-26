import { describe, it, expect, beforeAll } from 'vitest';
import type { Express } from 'express';
import { getApp, users, as, adminPool, type TestUser } from './helpers.js';
import { validateRuleExpression, SqlGuardError } from '../src/sqlGuard.js';

let app: Express;
let admin: TestUser;

beforeAll(async () => {
  app = await getApp();
  ({ admin } = await users());
});

const resultCount = async () => Number((await (await adminPool()).query(`SELECT COUNT(*) AS n FROM mdm.dq_result WHERE entity_type = 'CUSTOMER'`)).rows[0].n);

describe('data quality runs', () => {
  it('writes one result per active rule and live record', async () => {
    const r = await as(app, admin.email).post('/api/dq/run/customer');
    expect(r.status).toBe(200);
    if (r.body.status === 'no_rules') return;
    const evaluated = r.body.rules_evaluated - r.body.skipped_rules.length;
    expect(r.body.results_written).toBe(evaluated * r.body.entities_checked);
    expect(await resultCount()).toBe(r.body.results_written);
  });

  it('a failing rule rolls the whole run back', async () => {
    await as(app, admin.email).post('/api/dq/run/customer');
    const before = await resultCount();
    // Valid expression that fails at run time (division by zero)
    const rule = await as(app, admin.email).post('/api/dq/rules', {
      entity_type: 'CUSTOMER', rule_code: `T_DIV0_${Date.now()}`, rule_name: 'Test division by zero', rule_type: 'VALIDITY',
      severity: 'INFO', sql_expression: '1 / (length(legal_name) - length(legal_name)) = 1',
    });
    expect(rule.status).toBe(201);
    try {
      const r = await as(app, admin.email).post('/api/dq/run/customer');
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(await resultCount()).toBe(before);
    } finally {
      await (await adminPool()).query('DELETE FROM mdm.dq_rule WHERE id = $1', [rule.body.id]);
    }
  });
});

describe('matching', () => {
  it('finds a seeded near-duplicate with the fuzzy stage, once', async () => {
    const pool = await adminPool();
    const tag = Date.now();
    const ids = (await pool.query(
      `INSERT INTO mdm.customer (source_system, source_id, legal_name, country_code)
       VALUES ('TEST', $1, $3, 'FRA'), ('TEST', $2, $4, 'FRA') RETURNING id`,
      [`DUP-A-${tag}`, `DUP-B-${tag}`, `Zyxwv Quantum Widgets ${tag} SARL`, `Zyxwv Quantum Widget ${tag} SARL`])).rows.map(r => r.id);
    const pairCount = async () => Number((await pool.query(
      `SELECT COUNT(*) AS n FROM mdm.match_candidate WHERE status = 'PENDING' AND entity_id_a = ANY($1) AND entity_id_b = ANY($1)`, [ids])).rows[0].n);

    const scan = await as(app, admin.email).post('/api/matches/scan', { entity_type: 'CUSTOMER', methods: ['fuzzy'] });
    expect(scan.status).toBe(200);
    expect(scan.body.results[0].timings_ms.fuzzy).toBeGreaterThanOrEqual(0);
    expect(await pairCount()).toBe(1);

    // A second scan does not duplicate the pending pair (unique index + ON CONFLICT)
    await as(app, admin.email).post('/api/matches/scan', { entity_type: 'CUSTOMER', methods: ['fuzzy'] });
    expect(await pairCount()).toBe(1);

    // The paged list carries both records of the pair
    const list = await as(app, admin.email).get(`/api/matches?page=0&size=10&entity_type=CUSTOMER&q=${encodeURIComponent(`Zyxwv Quantum Widgets ${tag}`)}`);
    expect(list.body.total).toBe(1);
    expect(Object.keys(list.body.records).sort()).toEqual([...ids].sort());
  });

  it('phonetic and composite stages run as SQL without errors', async () => {
    const r = await as(app, admin.email).post('/api/matches/scan', { entity_type: 'CUSTOMER', methods: ['exact_keys', 'phonetic', 'composite'] });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('complete');
  });
});

describe('SQL guard', () => {
  const cols = new Set(['legal_name', 'country_code']);
  it('rejects statements and unknown identifiers', () => {
    expect(() => validateRuleExpression('legal_name IS NOT NULL; DROP TABLE mdm.customer', cols, new Set())).toThrow(SqlGuardError);
    expect(() => validateRuleExpression('password IS NOT NULL', cols, new Set())).toThrow(SqlGuardError);
    expect(() => validateRuleExpression('(SELECT 1) = 1', cols, new Set())).toThrow(SqlGuardError);
  });
  it('accepts simple boolean expressions over known columns', () => {
    expect(validateRuleExpression("legal_name IS NOT NULL AND country_code <> ''", cols, new Set())).toContain('legal_name');
  });
});
