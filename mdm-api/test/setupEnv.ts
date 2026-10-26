// Runs in each test worker before test files: point the app's pools at the disposable database.
import { inject } from 'vitest';

process.env.PG_DATABASE = inject('pgDatabase');
process.env.MDM_DEV_AUTH = '1';          // tests authenticate with the x-mdm-user header
process.env.NODE_ENV = 'test';
// No Snowflake: tests must not depend on (or change) a live account, as in CI
for (const k of ['SF_PRIVATE_KEY_PATH', 'SF_PRIVATE_KEY', 'SF_PAT', 'SF_PASSWORD']) delete process.env[k];
