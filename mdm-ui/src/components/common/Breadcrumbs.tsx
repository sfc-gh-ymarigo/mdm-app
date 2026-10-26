import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import { Breadcrumbs as MuiBreadcrumbs, Link, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useBrand } from '../../config/BrandContext';
import { localized } from '../../i18n';

const Ctx = createContext<{ label: string | null; setLabel: (l: string | null) => void }>({ label: null, setLabel: () => {} });

export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [label, setLabel] = useState<string | null>(null);
  return <Ctx.Provider value={{ label, setLabel }}>{children}</Ctx.Provider>;
}

/** A page names its last breadcrumb (e.g. the record's name) while it is mounted. */
export function useBreadcrumbLabel(label: string | null | undefined) {
  const { setLabel } = useContext(Ctx);
  useEffect(() => { setLabel(label ?? null); return () => setLabel(null); }, [label, setLabel]);
}

const STATIC: Record<string, string> = {
  'data-quality': 'nav.dataQuality', profiling: 'nav.profiling', workflows: 'nav.workflows', 'match-merge': 'nav.matchMerge',
  audit: 'nav.audit', hierarchy: 'nav.hierarchy', golden: 'nav.golden', analyst: 'nav.analyst', stewardship: 'nav.stewardship',
  'reference-data': 'nav.referenceData', configuration: 'nav.configuration', rules: 'nav.rules',
};

// Segments below /configuration: the tree's sections and module tabs
const CONFIG: Record<string, string> = {
  modules: 'configuration.modules', shared: 'configuration.sharedCapabilities', 'reference-data': 'configuration.referenceData',
  'dq-library': 'configuration.dqRuleLibrary', localization: 'configuration.localization', branding: 'configuration.branding', integrations: 'configuration.integrations',
  replication: 'configuration.replication', security: 'configuration.security', users: 'configuration.users', roles: 'configuration.roles',
  'data-masking': 'configuration.dataMasking', system: 'configuration.system', health: 'configuration.health',
  general: 'configuration.general', 'data-model': 'configuration.dataModel', 'data-quality': 'configuration.dataQuality',
  matching: 'configuration.matching', hierarchy: 'configuration.hierarchy', workflows: 'configuration.workflows',
};

/** Crumbs from the current path: Dashboard › Customers › Siemens AG */
export default function Breadcrumbs() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const brand = useBrand();
  const { label } = useContext(Ctx);
  const parts = pathname.split('/').filter(Boolean);
  if (!parts.length) return null;

  const inConfig = parts[0] === 'configuration';
  const crumbs = parts.map((seg, i) => {
    const to = '/' + parts.slice(0, i + 1).join('/');
    // Module crumbs: /customers at the top level, /configuration/modules/customer below
    const mod = i === 0 ? brand.modules.find(m => `${m.id}s` === seg)
      : inConfig && parts[i - 1] === 'modules' ? brand.moduleLabels?.[seg] : undefined;
    const isLast = i === parts.length - 1;
    const key = inConfig && i > 0 ? CONFIG[seg] : STATIC[seg];
    const text = isLast && label ? label
      : mod ? localized(mod.label, mod.labels)
        : key ? t(key)
          : decodeURIComponent(seg).replace(/-/g, ' ');
    return { to, text, isLast };
  });

  return (
    <MuiBreadcrumbs sx={{ fontSize: '0.8rem' }}>
      <Link component={RouterLink} to="/" underline="hover" color="text.secondary">{t('nav.dashboard')}</Link>
      {crumbs.map(c => c.isLast
        ? <Typography key={c.to} variant="body2" color="text.primary" sx={{ fontSize: '0.8rem', maxWidth: 320 }} noWrap>{c.text}</Typography>
        : <Link key={c.to} component={RouterLink} to={c.to} underline="hover" color="text.secondary">{c.text}</Link>)}
    </MuiBreadcrumbs>
  );
}
