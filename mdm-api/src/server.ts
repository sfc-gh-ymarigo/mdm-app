import pool from './db.js';
import { createApp, readiness } from './app.js';
import { initConfigStore, loadConfig } from './config.js';
import { initScope } from './scope.js';
import { migrateUp, migrationStatus } from './migrate.js';
import { AUTH_MODE } from './middleware/identity.js';
import { logger } from './logger.js';

const PORT = parseInt(process.env.PORT || '3001');
// BIND_HOST, not HOSTNAME: container runtimes set HOSTNAME to the container id
const HOSTNAME = process.env.BIND_HOST || 'localhost';

const app = createApp();

app.listen(PORT, HOSTNAME, async () => {
  // Configuration lives in Postgres (mdm.app_config); the JSON file only seeds it
  try { await initConfigStore(pool); readiness.configStore = true; }
  catch (err) { logger.warn({ err }, 'config store unavailable, using file config'); }
  // Mirror module Country Scope toggles into Postgres (read by RLS policies)
  try { await initScope(); } catch (err) { logger.warn({ err }, 'country scope sync failed'); }
  // Schema changes live in versioned migrations (postgres/NNN_*.sql, see migrate.ts)
  try {
    if (process.env.MDM_AUTO_MIGRATE === '1') {
      const done = await migrateUp(pool);
      if (done.length) logger.info({ migrations: done }, 'applied migrations');
    } else {
      const pending = (await migrationStatus(pool)).filter(m => !m.applied_at);
      if (pending.length) logger.warn({ pending: pending.map(m => m.file) }, 'pending migrations — run "npm run migrate -- up"');
    }
  } catch (e) { logger.error({ err: e }, 'migration check failed'); }
  logger.info({ host: HOSTNAME, port: PORT, auth: AUTH_MODE }, `${loadConfig().name} MDM running on http://${HOSTNAME}:${PORT}`);
});
