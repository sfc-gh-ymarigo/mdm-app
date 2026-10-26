// Rebuilds the Snowflake module objects (views, history, policies, PUBLISH, semantic
// view) after a module or field change, by calling MDM_ANALYTICS.SYNC_MODULES
// (snowflake/008). The procedure reads the configuration from the CDC mirror, so it
// returns "pending" until the mirror holds the saved version; we retry until then.
import { sfQuery } from './snowflake.js';
import { sfObjects, configVersion, flushConfig } from './config.js';
import { logger } from './logger.js';

const OPS_ROLE = process.env.MDM_SF_OPS_ROLE || undefined;
const debounceMs = () => Number(process.env.MDM_SYNC_DEBOUNCE_MS || 2_000);
const retryMs = () => Number(process.env.MDM_SYNC_RETRY_MS || 30_000);
const MAX_ATTEMPTS = 12;

export interface SyncState {
  state: 'idle' | 'scheduled' | 'running' | 'pending' | 'ok' | 'error';
  targetVersion: number | null;
  attempts: number;
  lastResult: unknown;
  lastError: string | null;
  updatedAt: string | null;
}

const _state: SyncState = { state: 'idle', targetVersion: null, attempts: 0, lastResult: null, lastError: null, updatedAt: null };
let _timer: NodeJS.Timeout | null = null;

function set(patch: Partial<SyncState>) { Object.assign(_state, patch, { updatedAt: new Date().toISOString() }); }

export function moduleSyncState(): SyncState { return { ..._state }; }

export async function runModuleSync(minVersion: number): Promise<Record<string, unknown>> {
  const rows = await sfQuery(`CALL ${sfObjects().database}.MDM_ANALYTICS.SYNC_MODULES(?)`, OPS_ROLE, [minVersion]);
  const raw = rows[0]?.SYNC_MODULES;
  return (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, unknown>;
}

async function attempt() {
  _timer = null;
  await flushConfig();
  const target = configVersion();
  set({ state: 'running', targetVersion: target, attempts: _state.attempts + 1 });
  try {
    const result = await runModuleSync(target);
    if (result?.status === 'pending' && _state.attempts < MAX_ATTEMPTS) {
      set({ state: 'pending', lastResult: result });
      _timer = setTimeout(attempt, retryMs());
      return;
    }
    const ok = result?.status === 'ok';
    set({ state: ok ? 'ok' : 'error', lastResult: result, lastError: ok ? null : `status ${String(result?.status)}` });
    logger.info({ result }, 'module sync finished');
  } catch (err) {
    set({ state: 'error', lastError: (err as Error).message });
    logger.error({ err }, 'module sync failed');
  }
}

/** Debounced: several admin edits in a row trigger one sync. */
export function scheduleModuleSync() {
  if (process.env.VITEST && !process.env.MDM_SYNC_IN_TESTS) return;
  if (_timer) clearTimeout(_timer);
  set({ state: 'scheduled', attempts: 0 });
  _timer = setTimeout(attempt, debounceMs());
}
