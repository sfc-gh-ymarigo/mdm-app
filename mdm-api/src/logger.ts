// Structured JSON logs (pino). Pretty-printed in dev when pino-pretty is available; LOG_LEVEL overrides.
import pino from 'pino';

const dev = process.env.NODE_ENV !== 'production' && !!process.stdout.isTTY;

export const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
  base: { service: 'mdm-api' },
  redact: { paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.token'], remove: true },
  ...(dev ? { transport: { target: 'pino-pretty', options: { singleLine: true, translateTime: 'HH:MM:ss' } } } : {}),
});
