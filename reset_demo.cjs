// Reset MDM demo — run: source mdm-api/.env && node reset_demo.cjs
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

if (!process.env.PG_HOST || !process.env.PG_PASSWORD) {
  console.error('Missing PG_HOST or PG_PASSWORD. Run: source mdm-api/.env && node reset_demo.cjs');
  process.exit(1);
}

const client = new Client({
  host: process.env.PG_HOST,
  port: parseInt(process.env.PG_PORT || '5432'),
  database: process.env.PG_DATABASE || 'postgres',
  user: process.env.PG_USER || 'snowflake_admin',
  password: process.env.PG_PASSWORD,
  ssl: { rejectUnauthorized: false }
});

(async () => {
  const sqlFile = path.resolve(__dirname, 'postgres', 'seed', 'demo_data.sql');
  if (!fs.existsSync(sqlFile)) {
    console.error('Seed file not found:', sqlFile);
    process.exit(1);
  }
  const sql = fs.readFileSync(sqlFile, 'utf-8');
  console.log('Connecting to Postgres...');
  await client.connect();
  console.log('Running postgres/seed/demo_data.sql ...');
  await client.query(sql);
  console.log('Demo reset complete — 14 customers, 14+ products, workflows, comments, audit trail restored.');
  await client.end();
})().catch(e => { console.error('RESET FAILED:', e.message); process.exit(1); });
