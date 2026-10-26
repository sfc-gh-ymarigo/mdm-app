import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Box, Chip, IconButton, Popover, Tooltip, Typography, alpha, useTheme } from '@mui/material';
import NotificationsIcon from '@mui/icons-material/Notifications';
import CircleIcon from '@mui/icons-material/Circle';
import { useTranslation } from 'react-i18next';
import { useUser } from '../../context/UserContext';
import { formatDate } from './format';
import i18n from '../../i18n';

import { liveColors, statusColors, seriesColor } from '../../theme/brandColors';
interface Notification {
  key: string; type: 'workflow' | 'dq' | 'merge' | 'ops'; text: string; path: string; at: string; read: boolean;
  msg?: { key: string; params: Record<string, unknown> };
}
const TYPE_COLORS = liveColors(['workflow', 'dq', 'merge', 'ops'], k => ({ workflow: statusColors().warning, dq: statusColors().error, merge: statusColors().info } as Record<string, string>)[k] || seriesColor(1));
const POLL_MS = 60_000;

/** Toolbar bell: notifications computed by the API for the current user, polled every minute. */
/** The server sends a message key + params; fall back to its English text for older payloads. */
function message(n: Notification): string {
  if (!n.msg) return n.text;
  const p = { ...n.msg.params };
  if (typeof p.type === 'string') p.type = i18n.t(`workflowTypes.${p.type}`, { defaultValue: p.type });
  if (typeof p.stage_code === 'string') p.stage = i18n.t(`stages.${p.stage_code}`, { defaultValue: p.stage });
  return i18n.t(`notifications.msg.${n.msg.key}`, { ...p, defaultValue: n.text });
}

export default function NotificationBell() {
  const { t } = useTranslation();
  const theme = useTheme();
  const navigate = useNavigate();
  const { currentUser } = useUser();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [items, setItems] = useState<Notification[]>([]);

  const load = useCallback(() => {
    fetch('/api/notifications').then(r => (r.ok ? r.json() : null)).then(d => d && setItems(d.items)).catch(() => {});
  }, []);
  useEffect(() => {
    if (!currentUser) return;
    load();
    const timer = setInterval(() => { if (!document.hidden) load(); }, POLL_MS);
    return () => clearInterval(timer);
  }, [currentUser?.email, load]); // eslint-disable-line react-hooks/exhaustive-deps

  const markRead = async (keys: string[]) => {
    if (!keys.length) return;
    setItems(prev => prev.map(n => (keys.includes(n.key) ? { ...n, read: true } : n)));
    await fetch('/api/notifications/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keys }) }).catch(() => {});
  };
  const unread = items.filter(n => !n.read);

  return (
    <>
      <Tooltip title={t('nav.notifications')}>
        <IconButton size="small" sx={{ color: 'text.secondary' }} onClick={e => { setAnchor(e.currentTarget); load(); }}>
          <Badge badgeContent={unread.length} color="error" sx={{ '& .MuiBadge-badge': { fontSize: '0.6rem', minWidth: 16, height: 16 } }}>
            <NotificationsIcon fontSize="small" />
          </Badge>
        </IconButton>
      </Tooltip>
      <Popover open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
        <Box sx={{ width: 400, maxHeight: 460, overflow: 'auto' }}>
          <Box sx={{ px: 2, py: 1.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: 1, borderColor: 'divider' }}>
            <Typography variant="subtitle2">{t('nav.notifications')}</Typography>
            {unread.length > 0 && (
              <Typography variant="caption" color="primary" sx={{ cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }} onClick={() => markRead(unread.map(n => n.key))}>
                {t('notifications.markAllRead')}
              </Typography>
            )}
          </Box>
          {items.length === 0 && <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>{t('notifications.empty')}</Typography>}
          {items.map(n => (
            <Box key={n.key} onClick={() => { markRead([n.key]); setAnchor(null); navigate(n.path); }}
              sx={{ px: 2, py: 1.5, cursor: 'pointer', display: 'flex', gap: 1.5, alignItems: 'flex-start', borderBottom: 1, borderColor: 'divider',
                bgcolor: n.read ? 'transparent' : alpha(theme.palette.primary.main, 0.04), '&:hover': { bgcolor: alpha(theme.palette.text.primary, 0.04) } }}>
              <CircleIcon sx={{ fontSize: 8, mt: 0.8, color: n.read ? 'transparent' : TYPE_COLORS[n.type] }} />
              <Box sx={{ flex: 1 }}>
                <Typography variant="body2" sx={{ fontSize: '0.8rem', fontWeight: n.read ? 400 : 500 }}>{message(n)}</Typography>
                <Box sx={{ display: 'flex', gap: 1, mt: 0.3, alignItems: 'center' }}>
                  <Chip label={t(`notifications.types.${n.type}`)} size="small" sx={{ fontSize: '0.6rem', height: 16, bgcolor: alpha(TYPE_COLORS[n.type], 0.15), color: TYPE_COLORS[n.type] }} />
                  <Typography variant="caption" color="text.secondary">{formatDate(n.at, true)}</Typography>
                </Box>
              </Box>
            </Box>
          ))}
        </Box>
      </Popover>
    </>
  );
}
