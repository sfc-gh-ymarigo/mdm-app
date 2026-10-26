import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { Box, Typography, Paper, CircularProgress, Button } from '@mui/material';
import { useBrand } from '../config/BrandContext';
import { tr } from '../i18n';
import { setMaskedFields } from '../components/common/fields';

export interface AppUser {
  email: string;
  display_name: string;
  role: string;
  country_scope: string[] | null;
  mdm_roles: string[];
  is_active: boolean;
  sf_user?: string | null;
  sf_role?: string | null;
  /** False when the user's Snowflake role sees PII masked; the API then masks these fields */
  pii_clear?: boolean;
  pii_masked_fields?: string[];
}

interface UserContextValue {
  currentUser: AppUser | null;
  users: AppUser[];
  switchUser: (email: string) => void;
  /** Header-based dev auth: the user switcher is available */
  devAuth: boolean;
  isAdmin: boolean;
  isViewer: boolean;
  canEdit: boolean;
}

const UserContext = createContext<UserContextValue>({
  currentUser: null,
  users: [],
  switchUser: () => {},
  devAuth: false,
  isAdmin: false,
  isViewer: false,
  canEdit: false,
});

export function useUser() { return useContext(UserContext); }

const STORAGE_KEY = 'mdm_current_user';

interface Unauthenticated { auth_mode?: string; sf_user?: string | null; email?: string | null }

export function UserProvider({ children }: { children: ReactNode }) {
  const brand = useBrand() as ReturnType<typeof useBrand>;
  const devAuth = brand.authMode === 'dev';
  const [users, setUsers] = useState<AppUser[]>([]);
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const [denied, setDenied] = useState<Unauthenticated | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);

  // Dev auth: the acting user is whichever switcher entry is stored; drop stale entries.
  useEffect(() => {
    if (!devAuth || !brand.users?.length) return;
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored || !brand.users.some(u => u.email === stored)) {
      if (brand.defaultUser) localStorage.setItem(STORAGE_KEY, brand.defaultUser);
    }
  }, [devAuth, brand.users, brand.defaultUser]);

  useEffect(() => {
    if (!brand.authMode) return; // config not loaded yet
    let cancelled = false;
    (async () => {
      const r = await fetch('/api/auth/me');
      const body = await r.json().catch(() => ({}));
      if (cancelled) return;
      if (r.ok) {
        setCurrentUser(body);
        setMaskedFields(body.pii_masked_fields ?? []);
        setDenied(null);
        setUnavailable(false);
        fetch('/api/auth/users').then(u => u.ok ? u.json() : []).then(setUsers).catch(() => {});
      } else if (r.status === 401) {
        setDenied(body);
      } else {
        // API down / proxy error: not an access decision
        setUnavailable(true);
      }
      setLoading(false);
    })().catch(() => { if (!cancelled) { setUnavailable(true); setLoading(false); } });
    return () => { cancelled = true; };
  }, [brand.authMode, attempt]);

  const switchUser = useCallback((email: string) => {
    localStorage.setItem(STORAGE_KEY, email);
    window.location.reload();
  }, []);

  if (loading) {
    return <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}><CircularProgress /></Box>;
  }
  if (unavailable) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', p: 3 }}>
        <Paper sx={{ p: 4, maxWidth: 520 }}>
          <Typography variant="h5" gutterBottom>MDM service unavailable</Typography>
          <Typography color="text.secondary" paragraph>The API did not respond. It may be restarting or unable to reach the database.</Typography>
          <Button variant="contained" onClick={() => { setLoading(true); setUnavailable(false); setAttempt(a => a + 1); }}>Retry</Button>
        </Paper>
      </Box>
    );
  }
  if (denied) return <NotProvisioned info={denied} />;

  const role = currentUser?.role || 'VIEWER';
  return (
    <UserContext.Provider value={{
      currentUser,
      users,
      switchUser,
      devAuth,
      isAdmin: role === 'ADMIN',
      isViewer: role === 'VIEWER',
      canEdit: role === 'ADMIN' || role === 'STEWARD',
    }}>
      {children}
    </UserContext.Provider>
  );
}

function NotProvisioned({ info }: { info: Unauthenticated }) {
  const who = info.sf_user || info.email;
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', p: 3 }}>
      <Paper sx={{ p: 4, maxWidth: 520 }}>
        <Typography variant="h5" gutterBottom>{tr('access.title')}</Typography>
        <Typography color="text.secondary" paragraph>
          {who
            ? <>{tr('access.signedInAs')} <b>{who}</b>{tr('access.notMapped')}</>
            : <>{info.auth_mode === 'none' ? tr('access.noIdentityNoAuth') : tr('access.noIdentity')}</>}
        </Typography>
        <Typography color="text.secondary">
          {info.sf_user ? tr('access.askAdminWithUser', { user: info.sf_user }) : tr('access.askAdmin')}
        </Typography>
      </Paper>
    </Box>
  );
}

/** Email sent as x-mdm-user. Only honoured by the API in dev auth mode. */
export function getCurrentUserEmail(): string {
  return localStorage.getItem(STORAGE_KEY) || '';
}
