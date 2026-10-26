import { useCallback, useEffect, useState } from 'react';
import {
  Box, Card, CardContent, Typography, Checkbox, FormControlLabel, Button, Chip, Alert, CircularProgress, Stack,
  Table, TableHead, TableRow, TableCell, TableBody,
} from '@mui/material';
import SecurityIcon from '@mui/icons-material/Security';
import SyncIcon from '@mui/icons-material/Sync';
import LockIcon from '@mui/icons-material/Lock';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import { getCurrentUserEmail } from '../context/UserContext';
import { useToast } from './common/Toast';
import { tr } from '../i18n';

interface PiiEntity { id: string; label: string; fields: { name: string; label: string }[]; selected: string[] }
interface PiiUser { email: string; display_name: string; role: string; sf_role: string | null; pii_clear: boolean }
interface PiiState {
  roles: string[];
  snowflake_roles: string[] | null;
  available: string[];
  in_sync: boolean;
  error?: string;
  entities: PiiEntity[];
  users: PiiUser[];
}

/**
 * Configuration › Security › Data masking. One setting for both surfaces: which columns are personal
 * data, and which Snowflake roles see them in clear. Users see PII in the app exactly when their
 * Snowflake role (Security › Users) does in Cortex Analyst. Saving updates the config, the
 * GOVERNANCE.PII_UNMASK_ROLES table and the PII_TYPE tags on the Snowflake views.
 */
export default function PiiMaskingPanel() {
  const [state, setState] = useState<PiiState | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [fields, setFields] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const call = useCallback(async (method: string, path = '', body?: unknown) => {
    const r = await fetch(`/api/admin/governance/pii${path}`, {
      method,
      headers: { 'x-mdm-user': getCurrentUserEmail(), ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { ok: r.ok, data: await r.json().catch(() => ({})) };
  }, []);

  const load = useCallback(async () => {
    const { data } = await call('GET');
    setState(data);
    setRoles(data.roles ?? []);
    setFields(Object.fromEntries((data.entities ?? []).map((e: PiiEntity) => [e.id, e.selected])));
  }, [call]);

  useEffect(() => { load(); }, [load]);

  const save = async (path = '') => {
    setBusy(true);
    const { ok, data } = await call(path ? 'POST' : 'PUT', path, path ? undefined : { roles, fields });
    setBusy(false);
    toast(ok ? tr('configuration.piiSaved') : (data.error ?? tr('configuration.piiSyncFailed')), ok ? 'success' : 'error');
    load();
  };

  if (!state) return <Box sx={{ p: 4, display: 'flex', justifyContent: 'center' }}><CircularProgress /></Box>;

  // Roles configured but no longer in Snowflake stay visible so they can be removed
  const options = [...new Set([...state.available, ...state.roles])].sort();
  const same = (a: string[], b: string[]) => [...a].sort().join() === [...b].sort().join();
  const dirty = !same(roles, state.roles) || state.entities.some(e => !same(fields[e.id] ?? [], e.selected));
  const toggle = (list: string[], v: string, on: boolean) => on ? [...list, v] : list.filter(x => x !== v);

  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <SecurityIcon color="primary" />
        <Typography variant="h5">{tr('configuration.dataMasking')}</Typography>
        <Box sx={{ flex: 1 }} />
        <Chip size="small" color={state.in_sync ? 'success' : 'warning'}
          label={state.in_sync ? tr('configuration.piiInSync') : tr('configuration.piiOutOfSync')} />
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3, maxWidth: 820 }}>
        {tr('configuration.dataMaskingIntro')}
      </Typography>

      {state.error && <Alert severity="warning" sx={{ mb: 2 }}>{tr('configuration.piiSnowflakeUnavailable')}: {state.error}</Alert>}

      {/* 1. Which columns are PII */}
      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="subtitle1" fontWeight={600}>{tr('configuration.piiMaskedColumns')}</Typography>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>{tr('configuration.piiColumnsHint')}</Typography>
          {state.entities.map(e => (
            <Box key={e.id} sx={{ mb: 1.5 }}>
              <Typography variant="overline" color="text.secondary">{e.label}</Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
                {e.fields.map(f => (
                  <FormControlLabel key={f.name}
                    label={<Typography variant="body2">{f.label} <Typography component="span" variant="caption" color="text.secondary" fontFamily="monospace">{f.name}</Typography></Typography>}
                    control={<Checkbox size="small" checked={(fields[e.id] ?? []).includes(f.name)}
                      onChange={ev => setFields(s => ({ ...s, [e.id]: toggle(s[e.id] ?? [], f.name, ev.target.checked) }))} />} />
                ))}
              </Box>
            </Box>
          ))}
        </CardContent>
      </Card>

      {/* 2. Which Snowflake roles see them in clear */}
      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="subtitle1" fontWeight={600}>{tr('configuration.piiUnmaskRoles')}</Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
            {options.map(role => (
              <FormControlLabel key={role} label={<Typography variant="body2" fontFamily="monospace">{role}</Typography>}
                control={<Checkbox size="small" checked={roles.includes(role)} onChange={e => setRoles(r => toggle(r, role, e.target.checked))} />} />
            ))}
          </Box>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
            {tr('configuration.piiAlwaysClear')}
          </Typography>
        </CardContent>
      </Card>

      <Stack direction="row" spacing={1} sx={{ mb: 3 }}>
        <Button variant="contained" disabled={busy || !dirty} onClick={() => save()}>{tr('common.save')}</Button>
        <Button startIcon={<SyncIcon />} disabled={busy} onClick={() => save('/sync')}>{tr('configuration.piiResync')}</Button>
      </Stack>

      {/* 3. Result per user (saved state) */}
      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle1" fontWeight={600}>{tr('configuration.piiUserAccess')}</Typography>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>{tr('configuration.piiUserAccessHint')}</Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{tr('configuration.users')}</TableCell>
                <TableCell>{tr('configuration.piiAppRole')}</TableCell>
                <TableCell>{tr('configuration.piiSnowflakeRole')}</TableCell>
                <TableCell>{tr('configuration.piiAccess')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {state.users.map(u => (
                <TableRow key={u.email}>
                  <TableCell>{u.display_name}<Typography variant="caption" color="text.secondary" display="block">{u.email}</Typography></TableCell>
                  <TableCell>{u.role}</TableCell>
                  <TableCell sx={{ fontFamily: 'monospace' }}>{u.sf_role ?? '—'}</TableCell>
                  <TableCell>
                    <Chip size="small" variant="outlined" color={u.pii_clear ? 'warning' : 'default'}
                      icon={u.pii_clear ? <LockOpenIcon /> : <LockIcon />}
                      label={u.pii_clear ? tr('configuration.piiClear') : tr('configuration.piiMasked')} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </Box>
  );
}
