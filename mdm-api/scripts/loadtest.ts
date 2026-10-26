// Load test: disposable database with N synthetic customers, then times list paging/sort/search,
// a DQ run and a match scan through the real app.   npx tsx scripts/loadtest.ts [rows=50000]
// Uses the same PG_* settings as the tests (needs CREATEDB); the database is dropped at the end.
import crypto from 'crypto';
import pg from 'pg';
import request from 'supertest';
import { migrateUp } from '../src/migrate.js';

const N = Number(process.argv[2] || 50_000);
const ssl = process.env.PG_HOST && process.env.PG_HOST !== 'localhost' ? { rejectUnauthorized: false } : false;
const conn = (database: string) => ({
  host: process.env.PG_HOST || 'localhost', port: Number(process.env.PG_PORT || 5432),
  user: process.env.PG_USER || 'postgres', password: process.env.PG_PASSWORD, database, ssl,
});
const db = `mdm_load_${crypto.randomBytes(4).toString('hex')}`;

const root = new pg.Client(conn(process.env.PG_DATABASE || 'postgres'));
await root.connect();
await root.query(`CREATE DATABASE ${db}`);
const pool = new pg.Pool(conn(db));
try {
  await migrateUp(pool, () => {});
  let t = Date.now();
  // ~2% near-duplicates (same stem, one letter dropped) so matching has work to do
  await pool.query(`
    INSERT INTO mdm.customer (source_system, source_id, legal_name, trade_name, country_code, city, lifecycle_stage, tax_id)
    SELECT 'LOAD', 'L-' || g,
           CASE WHEN g % 50 = 0 THEN 'Company ' || md5((g - 1)::text) || ' SA' ELSE 'Company ' || md5(g::text) || ' SAS' END,
           'Trade ' || g,
           (ARRAY['FRA','BEL','DEU','GBR','ESP','ITA','NLD','POL'])[1 + g % 8],
           (ARRAY['Paris','Brussels','Berlin','London','Madrid','Rome','Amsterdam','Warsaw'])[1 + g % 8],
           (ARRAY['DRAFT','REVIEW','VALIDATED','ACTIVE'])[1 + g % 4],
           CASE WHEN g % 3 = 0 THEN NULL ELSE 'TX' || g END
      FROM generate_series(1, $1) g`, [N]);
  await pool.query('ANALYZE mdm.customer');
  console.log(`seeded ${N} customers in ${Date.now() - t} ms`);

  process.env.PG_DATABASE = db;
  process.env.MDM_DEV_AUTH = '1';
  process.env.LOG_LEVEL = 'silent';
  const { createApp, readiness } = await import('../src/app.js');
  const { initConfigStore, stopConfigListener } = await import('../src/config.js');
  const { initScope } = await import('../src/scope.js');
  const { default: appPool } = await import('../src/db.js');
  await initConfigStore(appPool); readiness.configStore = true; await initScope();
  const app = createApp();
  const admin = (await pool.query(`SELECT email FROM mdm.app_user WHERE role = 'ADMIN' LIMIT 1`)).rows[0].email;
  const steward = (await pool.query(`SELECT email FROM mdm.app_user WHERE role = 'STEWARD' AND cardinality(country_scope) > 0 LIMIT 1`)).rows[0]?.email;

  const timeIt = async (label: string, url: string, user = admin, runs = 10) => {
    const ms: number[] = [];
    let total = 0;
    for (let i = 0; i < runs; i++) {
      const t0 = Date.now();
      const r = await request(app).get(url).set('x-mdm-user', user);
      ms.push(Date.now() - t0);
      if (r.status !== 200) throw new Error(`${url} -> ${r.status} ${JSON.stringify(r.body)}`);
      total = r.body.total ?? r.body.length;
    }
    ms.sort((a, b) => a - b);
    console.log(`${label.padEnd(34)} p50 ${String(ms[Math.floor(runs / 2)]).padStart(5)} ms  p95 ${String(ms[Math.ceil(runs * 0.95) - 1]).padStart(5)} ms  (total ${total})`);
  };

  await timeIt('page 0, default order', '/api/entities/customer?page=0&size=25');
  await timeIt('page 1000, default order', '/api/entities/customer?page=1000&size=25');
  await timeIt('sort legal_name asc', '/api/entities/customer?page=0&size=25&sort=legal_name:asc');
  await timeIt('search q=Company 9ab', '/api/entities/customer?page=0&size=25&q=Company%209ab');
  await timeIt('filter stage + dq range', '/api/entities/customer?page=0&size=25&lifecycle_stage=ACTIVE&dq_min=0&dq_max=100');
  await timeIt('facets', '/api/entities/customer/facets');
  if (steward) await timeIt('steward (RLS) page 0', '/api/entities/customer?page=0&size=25', steward);
  await timeIt('unpaged (full list, legacy)', '/api/entities/customer', admin, 3);

  t = Date.now();
  let r = await request(app).post('/api/dq/run/customer').set('x-mdm-user', admin).send({});
  console.log(`DQ run customer: ${Date.now() - t} ms → ${r.body.results_written} results (${r.body.rules_evaluated} rules)`);

  for (const methods of [['exact_keys'], ['fuzzy'], ['phonetic'], ['composite']]) {
    t = Date.now();
    r = await request(app).post('/api/matches/scan').set('x-mdm-user', admin).send({ entity_type: 'CUSTOMER', methods });
    const res = r.body.results?.[0];
    console.log(`match scan ${methods[0].padEnd(10)}: ${String(Date.now() - t).padStart(6)} ms → ${res ? res[methods[0]] : JSON.stringify(r.body)} new candidates`);
  }
  await stopConfigListener();
  await appPool.end();
} finally {
  await pool.end();
  await root.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
  await root.end();
}
process.exit(0);
