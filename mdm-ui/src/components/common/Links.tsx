import type { ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Link, Chip } from '@mui/material';
import { useBrand } from '../../config/BrandContext';

/** Route of a module's record list: `/customers`, `/products`, `/suppliers`. */
export const modulePath = (moduleId: string) => `/${moduleId}s`;

/** Route of a record, or null when the entity type is not an enabled module. */
export function useRecordPath() {
  const brand = useBrand();
  return (entityType: string | null | undefined, id: string | null | undefined): string | null => {
    if (!entityType || !id) return null;
    const mod = brand.modules.find(m => m.enabled && m.id === entityType.toLowerCase());
    return mod ? `${modulePath(mod.id)}/${id}` : null;
  };
}

const stop = (e: React.MouseEvent) => e.stopPropagation();

/** Link to a record page; plain text when the type is unknown/disabled. */
export function RecordLink({ type, id, children, newTab }: { type: string | null | undefined; id: string | null | undefined; children?: ReactNode; newTab?: boolean }) {
  const path = useRecordPath()(type, id);
  const label = children ?? id;
  if (!path) return <>{label}</>;
  return (
    <Link component={RouterLink} to={path} underline="hover" onClick={stop}
      {...(newTab ? { target: '_blank', rel: 'noopener' } : {})}>{label}</Link>
  );
}

/** Link to the audit trail filtered on a user. */
export function UserLink({ email, children }: { email: string | null | undefined; children?: ReactNode }) {
  if (!email) return <>{children ?? '—'}</>;
  return (
    <Link component={RouterLink} to={`/audit?user=${encodeURIComponent(email)}`} underline="hover" onClick={stop}>
      {children ?? email.split('@')[0]}
    </Link>
  );
}

export function WorkflowLink({ id, children }: { id: number | string; children?: ReactNode }) {
  return <Link component={RouterLink} to={`/workflows/${id}`} underline="hover" onClick={stop}>{children ?? `#${id}`}</Link>;
}

/** Golden ID chip linking to the golden record. */
export function GoldenChip({ goldenId, size = 'small' }: { goldenId: string | null | undefined; size?: 'small' | 'medium' }) {
  if (!goldenId) return null;
  return (
    <Chip component={RouterLink} to={`/golden/${encodeURIComponent(goldenId)}`} clickable onClick={stop}
      label={goldenId} size={size} variant="outlined" sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }} />
  );
}
