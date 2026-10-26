import { Router } from 'express';
import { asyncHandler } from '../asyncHandler.js';
import { sfQuery, sfFetch } from '../snowflake.js';
import { loadConfig, sfObjects } from '../config.js';
import { getAppUser } from '../db.js';
import { logger } from '../logger.js';

const router = Router();

// Snowflake role used to run Analyst SQL for the caller (row access policies apply):
// app_user.sf_role, else the role mapped in config users, else the viewer role.
async function snowflakeRoleFor(email: string): Promise<string> {
  const user = email ? await getAppUser(email) : null;
  if (user?.sf_role) return user.sf_role;
  const mapped = loadConfig().users.find(u => u.email === email)?.sf_role;
  return mapped || process.env.MDM_VIEWER_SF_ROLE || 'MDM_VIEWER_ROLE';
}

router.post('/message', asyncHandler(async (req, res) => {
  const { messages } = req.body;
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: 'messages array required' });
    return;
  }

  const sfRole = await snowflakeRoleFor(req.headers['x-mdm-user'] as string);

  const analystRes = await sfFetch('/api/v2/cortex/analyst/message', {
    method: 'POST',
    body: JSON.stringify({ messages, semantic_view: sfObjects().semanticView }),
  });

  if (!analystRes.ok) {
    const errText = await analystRes.text();
    logger.error({ status: analystRes.status, body: errText }, 'Cortex Analyst error');
    res.status(analystRes.status).json({ error: `Cortex Analyst error: ${analystRes.status}`, detail: errText });
    return;
  }

  const analystBody = await analystRes.json() as {
    message?: { content: { type: string; statement?: string; text?: string; suggestions?: string[]; results?: unknown; error?: string }[] };
    request_id?: string;
  };

  // Execute generated SQL on a connection opened with the caller's Snowflake role
  if (analystBody.message?.content) {
    for (const block of analystBody.message.content) {
      if (block.type === 'sql' && block.statement) {
        try {
          const rows = await sfQuery(block.statement, sfRole);
          block.results = rows.slice(0, 200);
        } catch (e: unknown) {
          block.error = e instanceof Error ? e.message : String(e);
        }
      }
    }
  }

  (analystBody as Record<string, unknown>).effective_role = sfRole;
  res.json(analystBody);
}));

export default router;
