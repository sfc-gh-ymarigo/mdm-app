import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import crypto from 'crypto';
import { pinoHttp } from 'pino-http';
import { logger } from './logger.js';
import path from 'path';
import { fileURLToPath } from 'url';
import productsRouter from './routes/products.js';
import workflowsRouter from './routes/workflows.js';
import auditRouter from './routes/audit.js';
import dqRouter from './routes/dq.js';
import statsRouter from './routes/stats.js';
import matchesRouter from './routes/matches.js';
import aiRouter from './routes/ai.js';
import hierarchyRouter from './routes/hierarchy.js';
import analystRouter from './routes/analyst.js';
import authRouter from './routes/auth.js';
import goldenRouter from './routes/golden.js';
import profilingRouter from './routes/profiling.js';
import stewardshipRouter from './routes/stewardship.js';
import refdataRouter from './routes/refdata.js';
import { piiGuard } from './pii.js';
import adminRouter from './routes/admin.js';
import recordsRouter from './routes/records.js';
import notificationsRouter from './routes/notifications.js';
import { requireEditor } from './middleware/requireRole.js';
import { loadConfig, getEnabledModules, getModules, getModule, getBranding } from './config.js';
import type { Router } from 'express';
import { createEntityRouter } from './modules/entityRouter.js';
import pool, { getAppUser, userPool } from './db.js';
import { SqlGuardError } from './sqlGuard.js';
import { AiError } from './cortex.js';
import { migrationStatus } from './migrate.js';
import { HttpError } from './modules/entities.js';
import { identity, AUTH_MODE } from './middleware/identity.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Set once startup finished loading configuration (reported by /api/ready). */
export const readiness = { configStore: false };

/** Builds the Express app (routes, middleware, error handling) without listening — used by server.ts and tests. */
export function createApp() {
const demoConfig = loadConfig();
const app = express();

app.disable('x-powered-by');
app.use((req, res, next) => {
  const id = crypto.randomUUID();
  (req as Request & { id?: string }).id = id;
  res.setHeader('X-Request-Id', id);
  next();
});
// One JSON access log line per request, keyed by the same request id; health probes are not logged
app.use(pinoHttp({
  logger,
  genReqId: req => (req as Request & { id?: string }).id ?? crypto.randomUUID(),
  autoLogging: { ignore: req => req.url === '/api/health' || req.url === '/api/ready' },
  customProps: req => ({ user: req.headers['x-mdm-user'] || undefined }),
  serializers: {
    req: r => ({ method: r.method, url: r.url }),
    res: r => ({ status: r.statusCode }),
  },
  customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
}));

// Images may come from the configured CDN (imageCdn.pattern); everything else is same-origin.
const imgHosts = (() => {
  try { const pat = (demoConfig.imageCdn?.pattern || '').replace(/\{[^}]*\}/g, 'x'); return pat ? [new URL(pat).origin] : []; }
  catch { return []; }
})();
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      'default-src': ["'self'"],
      'img-src': ["'self'", 'data:', 'blob:', ...imgHosts],
      'style-src': ["'self'", "'unsafe-inline'"],   // MUI emotion injects styles at runtime
      'connect-src': ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// The UI is served from the same origin in SPCS; cross-origin callers must be listed explicitly.
const allowedOrigins = (process.env.MDM_ALLOWED_ORIGINS
  ?? (process.env.MDM_DEV_AUTH === '1' ? 'http://localhost:3000' : ''))
  .split(',').map(o => o.trim()).filter(Boolean);
app.use(cors({ origin: (origin, cb) => cb(null, !origin || allowedOrigins.includes(origin)) }));
app.use(express.json({ limit: '1mb' }));

// Resolve caller identity (SPCS ingress header, or x-mdm-user in dev) for audit trail + RLS
app.use(identity);

// Mask PII in responses / strip it from writes for users whose Snowflake role sees it masked
app.use('/api', piiGuard);

// Block VIEWER users from all mutation endpoints (POST/PUT/PATCH/DELETE)
// Auth and config routes are exempt; admin routes have their own requireAdmin guard
const WRITE_EXEMPT = ['/api/auth', '/api/config', '/api/health', '/api/ready', '/api/admin'];
app.use('/api', (req, res, next) => {
  if (req.method === 'GET' || req.method === 'OPTIONS') return next();
  if (WRITE_EXEMPT.some(prefix => req.originalUrl.startsWith(prefix))) return next();
  requireEditor(req, res, next);
});

// API routes
app.use('/api/products', productsRouter);
app.use('/api/workflows', workflowsRouter);
app.use('/api/audit', auditRouter);
app.use('/api/dq', dqRouter);
app.use('/api/stats', statsRouter);
app.use('/api/matches', matchesRouter);
app.use('/api/ai', aiRouter);
app.use('/api/hierarchy', hierarchyRouter);
app.use('/api/analyst', analystRouter);
app.use('/api/auth', authRouter);
app.use('/api/golden', goldenRouter);
app.use('/api/profiling', profilingRouter);
app.use('/api/stewardship', stewardshipRouter);
app.use('/api/refdata', refdataRouter);
app.use('/api/admin', adminRouter);
app.use('/api/records', recordsRouter);
app.use('/api/notifications', notificationsRouter);

// Dynamic module entity routing — resolves module config per-request
// so toggling a module in admin takes effect immediately (no restart)
const _entityRouterCache = new Map<string, Router>();
app.use('/api/entities/:moduleId', (req, res, next) => {
  const { moduleId } = req.params;
  const mod = getModule(moduleId);
  if (!mod?.enabled) {
    return res.status(404).json({ error: `Module "${moduleId}" not found or disabled` });
  }
  if (!_entityRouterCache.has(mod.id)) {
    _entityRouterCache.set(mod.id, createEntityRouter(mod.id));
    logger.info({ module: mod.id }, 'module router registered');
  }
  _entityRouterCache.get(mod.id)!(req, res, next);
});

// Liveness: the process is up (no dependencies checked)
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), mode: process.env.NODE_ENV || 'development', demo: demoConfig.id });
});

// Readiness: both Postgres pools answer, configuration is loaded and no migration is pending
app.get('/api/ready', async (_req, res) => {
  const check = async (fn: () => Promise<unknown>) => {
    const t0 = Date.now();
    try { await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000))]); return { ok: true, ms: Date.now() - t0 }; }
    catch (e) { return { ok: false, ms: Date.now() - t0, error: (e as Error).message }; }
  };
  const [adminDb, userDb, migrations] = await Promise.all([
    check(() => pool.query('SELECT 1')),
    check(() => userPool.query('SELECT 1')),
    check(async () => { const pending = (await migrationStatus(pool)).filter(m => !m.applied_at); if (pending.length) throw new Error(`${pending.length} pending`); }),
  ]);
  const checks = { admin_db: adminDb, user_db: userDb, migrations, config: { ok: readiness.configStore } };
  const ok = Object.values(checks).every(c => c.ok);
  res.status(ok ? 200 : 503).json({ status: ok ? 'ready' : 'not_ready', checks });
});

// Serve config to the frontend (branding, palette, users, modules). Notifications: /api/notifications
app.get('/api/config', (_req, res) => {
  const { id, name, fullName, tagline, industry, logo, palette, darkBackground, lightBackground,
    users, defaultUser, imageCdn, llmContext, hierarchyRoots, languages, countries, defaultCurrency } = demoConfig;
  const modules = getEnabledModules().map(m => ({
    id: m.id, label: m.label, singular: m.singular, labels: m.labels, singular_labels: m.singular_labels, allow_create: m.allow_create,
    icon: m.icon, enabled: m.enabled, order: m.order,
    name_field: m.name_field, country_scoped: m.country_scoped,
    fields: m.fields, search: m.search, filters: m.filters,
    matching: m.matching, hierarchy: m.hierarchy, workflow: m.workflow,
  }));
  const { status, workflowTypes, matchMethods, charts, typography } = getBranding();
  res.json({ id, name, fullName, tagline, industry, logo, palette, darkBackground, lightBackground, status, workflowTypes, matchMethods, charts, typography,
    // The user switcher list is only exposed when header-based dev auth is on
    users: AUTH_MODE === 'dev' ? users.map(u => ({ email: u.email, display_name: u.display_name, role: u.role, country_scope: u.country_scope })) : [],
    defaultUser: AUTH_MODE === 'dev' ? defaultUser : undefined, authMode: AUTH_MODE, imageCdn, llmContext, hierarchyRoots, defaultCurrency,
    languages: languages || [], countries: countries || [], modules,
    // Names of every module, enabled or not (configuration screens list disabled ones too)
    moduleLabels: Object.fromEntries(getModules().map(m => [m.id, { label: m.label, labels: m.labels }])) });
});

// Global error handler — stable messages for clients; driver/SQL detail is logged with the
// request id and only returned to administrators.
app.use('/api', async (err: unknown, req: Request, res: Response, _next: NextFunction) => {
  const requestId = (req as Request & { id?: string }).id;
  if (err instanceof HttpError) { res.status(err.status).json({ error: err.message, request_id: requestId }); return; }
  if (err instanceof SqlGuardError) { res.status(400).json({ error: err.message, request_id: requestId }); return; }
  if (err instanceof AiError) { res.status(err.status).json({ error: err.message, request_id: requestId }); return; }
  if ((err as { type?: string }).type === 'entity.too.large') { res.status(413).json({ error: 'Request body too large', request_id: requestId }); return; }
  if ((err as { type?: string }).type === 'entity.parse.failed') { res.status(400).json({ error: 'Malformed JSON body', request_id: requestId }); return; }

  const pgErr = err as { code?: string; detail?: string; constraint?: string; message?: string; column?: string };
  const code = pgErr.code || '';
  const map: Array<[boolean, number, string]> = [
    [code === '42501', 403, 'Not allowed: record is outside your country scope'],
    [code === '23505', 409, 'Duplicate record'],
    [code === '23503', 409, 'Referenced record does not exist'],
    [code === '23502', 400, `Required field missing: ${pgErr.column || 'unknown'}`],
    [code === '23514', 400, 'Check constraint violated'],
    [code === '22001', 400, 'Value too long for column'],
    [code === '23000', 409, 'Integrity constraint violated'],
    [code === '42703', 400, 'Unknown field'],
    [code.startsWith('22'), 400, 'Invalid data'],
  ];
  const hit = map.find(([cond]) => cond);
  const status = hit ? hit[1] : 500;
  const message = hit ? hit[2] : 'Internal server error';
  logger[status === 500 ? 'error' : 'warn']({ request_id: requestId, method: req.method, url: req.originalUrl, status, err: status === 500 ? err : undefined, detail: pgErr.detail || pgErr.message }, 'request failed');

  let isAdmin = false;
  try { isAdmin = (await getAppUser(req.headers['x-mdm-user'] as string || '')).role === 'ADMIN'; } catch { /* ignore */ }
  const body: Record<string, unknown> = { error: message, request_id: requestId };
  if (isAdmin) Object.assign(body, { detail: pgErr.detail || pgErr.message, constraint: pgErr.constraint, pg_code: code || undefined });
  if (!res.headersSent) res.status(status).json(body);
});

// Unknown API paths are JSON 404s, not the SPA shell
app.use('/api', (_req, res) => { res.status(404).json({ error: 'Not found' }); });

// Serve React static build (production / SPCS)
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));
app.get('*', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

return app;
}
