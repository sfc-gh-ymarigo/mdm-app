import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import type { StatusColors, ChartsConfig, TypographyConfig } from '../theme/brandColors';

export interface ModuleField {
  name: string;
  label: string;
  type: 'text' | 'number' | 'boolean' | 'date' | 'ref' | 'json' | 'uuid';
  group: string;
  required?: boolean;
  searchable?: boolean;
  filterable?: boolean;
  ref_domain?: string;
  ref_table?: string;
  list_display?: boolean;
  list_width?: number;
  card_display?: boolean;
  editable?: boolean;
  max_length?: number;
  active?: boolean;
  /** Translated labels by locale, e.g. { fr: 'Raison sociale' } */
  labels?: Record<string, string>;
}

export interface ModuleConfig {
  id: string;
  label: string;
  singular: string;
  /** Translated labels by locale */
  labels?: Record<string, string>;
  singular_labels?: Record<string, string>;
  icon: string;
  enabled: boolean;
  allow_create?: boolean;
  order: number;
  name_field: string;
  country_scoped?: boolean;
  fields: ModuleField[];
  search: { fields: string[]; fuzzy?: { fields: string[]; threshold?: number } };
  filters: Array<{ field: string; label: string; type: string; options_from?: string }>;
  matching?: {
    enabled: boolean;
    fields: string[];
    methods?: {
      exact_keys?: { enabled: boolean; keys: string[] };
      fuzzy?: { enabled: boolean; threshold: number; name_field: string };
      phonetic?: { enabled: boolean; fields: string[] };
      composite?: { enabled: boolean; threshold: number; rules?: { field: string; weight: number; compare: string; min_sim?: number }[] };
      embedding?: { enabled: boolean; model: string; threshold: number; description_fields: string[] };
      llm_judge?: { enabled: boolean; model: string };
      address?: { enabled: boolean; fields: string[] };
    };
  };
  hierarchy?: { enabled: boolean; parent_field: string; root_label: string; type: string; category_table?: string; max_depth?: number | null; max_parents?: number; allow_root?: boolean; prevent_circular?: boolean; change_mode?: 'immediate' | 'workflow' };
  workflow?: { auto_create_on_insert: boolean; types: string[] };
}

export interface BrandPalette {
  primary: string;
  primaryLight: string;
  primaryDark: string;
  secondary: string;
  secondaryLight: string;
  secondaryDark: string;
  accent: string;
}

export interface BrandConfig {
  id: string;
  name: string;
  fullName: string;
  tagline: string;
  industry: string;
  logo: string;
  palette: BrandPalette;
  darkBackground: {
    default: string;
    paper: string;
    card: string;
    sidebarGradient: string;
  };
  lightBackground: {
    sidebarGradient: string;
  };
  status?: StatusColors;
  workflowTypes?: Record<string, string>;
  matchMethods?: Record<string, string>;
  charts?: ChartsConfig;
  typography?: TypographyConfig;
  users: Array<{
    email: string;
    display_name: string;
    role: string;
    country_scope: string[] | null;
  }>;
  defaultUser: string;
  /** 'spcs' | 'dev' | 'none' — unset until /api/config has loaded */
  authMode?: string;
  hierarchyRoots: {
    productCatalog: string;
    customerTree: string;
  };
  notifications: Array<{
    text: string;
    type: string;
    time: string;
    path: string;
  }>;
  imageCdn: {
    pattern: string;
    fallback: string;
  };
  llmContext: string;
  // `enabled` is omitted when true — treat undefined as active.
  languages?: Array<{ code: string; label: string; default?: boolean; enabled?: boolean }>;
  countries?: Array<{ code: string; label: string; enabled?: boolean }>;
  modules: ModuleConfig[];
  /** Every module's name, including disabled modules */
  moduleLabels?: Record<string, { label: string; labels?: Record<string, string> }>;
  /** Currency used when a record has none (ISO 4217) */
  defaultCurrency?: string;
}

// Generic defaults used before /api/config loads — overwritten once the API responds
const DEFAULT_CONFIG: BrandConfig = {
  hierarchyRoots: { productCatalog: 'Catalog', customerTree: 'Accounts' },
  id: '',
  name: 'MDM',
  fullName: 'MDM',
  tagline: 'Master Data Management — overview & quality insights',
  industry: '',
  logo: 'snowflake-logo.svg',
  palette: {
    primary: '#29B5E8',
    primaryLight: '#56C8EF',
    primaryDark: '#1A8CB8',
    secondary: '#11567F',
    secondaryLight: '#1E7AAD',
    secondaryDark: '#0D3F5E',
    accent: '#49D4A9',
  },
  darkBackground: {
    default: '#040D21',
    paper: '#081A36',
    card: '#0D2847',
    sidebarGradient: 'linear-gradient(180deg, #081A36 0%, #040D21 100%)',
  },
  lightBackground: {
    sidebarGradient: 'linear-gradient(180deg, #11567F 0%, #0D3F5E 100%)',
  },
  users: [],
  defaultUser: '',
  notifications: [],
  imageCdn: { pattern: '', fallback: '/placeholder-product.png' },
  llmContext: '',
  languages: [],
  countries: [],
  modules: [],
};

const BrandContext = createContext<BrandConfig>(DEFAULT_CONFIG);

export function useBrand() { return useContext(BrandContext); }

// Dispatch on window after a config mutation to make BrandProvider reload /api/config.
export const BRAND_CONFIG_CHANGED = 'brand-config-changed';

export function BrandProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<BrandConfig>(DEFAULT_CONFIG);

  useEffect(() => {
    const load = () => fetch('/api/config')
      .then(r => r.json())
      .then((data: BrandConfig) => {
        setConfig(data);
        document.title = `${data.name} MDM`;
      })
      .catch(() => setConfig(c => ({ ...c, authMode: c.authMode || 'none' })));
    load();
    window.addEventListener(BRAND_CONFIG_CHANGED, load);
    return () => window.removeEventListener(BRAND_CONFIG_CHANGED, load);
  }, []);

  return <BrandContext.Provider value={config}>{children}</BrandContext.Provider>;
}
