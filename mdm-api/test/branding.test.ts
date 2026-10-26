// Branding: admin-only, validated, persisted to app_config and served by /api/config.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Express } from 'express';
import request from 'supertest';
import { getApp, users, as, type TestUser } from './helpers.js';
import { sanitizeSvg } from '../src/config.js';

let app: Express;
let admin: TestUser;
let steward: TestUser;
let original: Record<string, unknown>;

beforeAll(async () => {
  app = await getApp();
  const u = await users();
  admin = u.admin;
  steward = u.steward!;
  original = (await as(app, admin.email).get('/api/admin/branding')).body.branding;
});

afterAll(async () => {
  await as(app, admin.email).put('/api/admin/branding', original);
});

describe('branding', () => {
  it('is admin-only', async () => {
    const r = await as(app, steward.email).put('/api/admin/branding', { name: 'X' });
    expect(r.status).toBe(403);
  });

  it('updates the palette and serves it in /api/config', async () => {
    const r = await as(app, admin.email).put('/api/admin/branding', { name: 'Test MDM', palette: { primary: '#123456' } });
    expect(r.status).toBe(200);
    expect(r.body.branding.palette.primary).toBe('#123456');
    const cfg = await request(app).get('/api/config');
    expect(cfg.body.name).toBe('Test MDM');
    expect(cfg.body.palette.primary).toBe('#123456');
  });

  it('rejects invalid colors, gradients, unknown fields and logos', async () => {
    for (const body of [
      { palette: { primary: 'red' } },
      { palette: { nope: '#123456' } },
      { darkBackground: { sidebarGradient: 'url(javascript:alert(1))' } },
      { color: '#123456' },
      { logo: 'http://insecure.example.com/logo.png' },
      { logo: 'data:text/html;base64,PHNjcmlwdD4=' },
      { name: '' },
    ]) {
      const r = await as(app, admin.email).put('/api/admin/branding', body);
      expect(r.status, JSON.stringify(body)).toBe(400);
    }
  });

  it('validates status, chart palettes and typography', async () => {
    const ok = await as(app, admin.email).put('/api/admin/branding', {
      status: { success: '#00AA00' },
      charts: { mode: 'monochrome', base: '#11567F', colors: Array.from({ length: 20 }, () => '#123456') },
      typography: { font: 'serif', light: { primary: '#000000' } },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.branding.charts.colors).toHaveLength(20);
    expect(ok.body.branding.typography.font).toBe('serif');
    expect(ok.body.branding.typography.dark.primary).toBe('#FFFFFF');
    const cfg = await as(app, admin.email).get('/api/config');
    expect(cfg.body.charts.mode).toBe('monochrome');
    expect(cfg.body.status.success).toBe('#00AA00');
    for (const body of [
      { charts: { mode: 'rainbow' } },
      { charts: { colors: ['#123456'] } },
      { charts: { colors: Array.from({ length: 25 }, () => '#123456') } },
      { typography: { font: 'comic' } },
      { status: { success: 'green' } },
    ]) {
      const r = await as(app, admin.email).put('/api/admin/branding', body);
      expect(r.status, JSON.stringify(body)).toBe(400);
    }
  });

  it('sanitizes SVG logos', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><a href="javascript:x"><rect/></a></svg>';
    const r = await as(app, admin.email)
      .put('/api/admin/branding', { logo: 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64') });
    expect(r.status).toBe(200);
    const stored = Buffer.from(r.body.branding.logo.split(',')[1], 'base64').toString();
    expect(stored).not.toMatch(/script|onload|javascript/i);
    expect(sanitizeSvg('<html></html>')).toBeNull();
  });

  it('resets to the Snowflake defaults', async () => {
    const r = await as(app, admin.email).post('/api/admin/branding/reset');
    expect(r.status).toBe(200);
    expect(r.body.branding.palette.primary).toBe('#29B5E8');
    expect(r.body.branding.logo).toBe('');
  });
});
