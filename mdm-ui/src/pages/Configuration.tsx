import { useState, useEffect, useCallback } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Box, Typography, Card, CardContent, Grid2 as Grid, Chip, alpha, useTheme,
  Alert,
  CircularProgress, LinearProgress, IconButton, Tooltip, TextField, MenuItem, Autocomplete,
  Button, Divider, Table, TableHead, TableBody, TableRow, TableCell, Switch,
  Dialog, DialogTitle, DialogContent, DialogActions, FormControl,
  InputLabel, Select, List, ListItemButton, ListItemIcon, ListItemText, Collapse,
  FormControlLabel, Checkbox, Radio, RadioGroup,
} from '@mui/material';

import VerifiedUserIcon from '@mui/icons-material/VerifiedUser';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import SyncIcon from '@mui/icons-material/Sync';
import RefreshIcon from '@mui/icons-material/Refresh';

import LayersIcon from '@mui/icons-material/Layers';
import TableChartIcon from '@mui/icons-material/TableChart';
import ScheduleIcon from '@mui/icons-material/Schedule';
import ExtensionIcon from '@mui/icons-material/Extension';
import PeopleIcon from '@mui/icons-material/People';
import Inventory2Icon from '@mui/icons-material/Inventory2';
import LocalShippingIcon from '@mui/icons-material/LocalShipping';
import StoreIcon from '@mui/icons-material/Store';
import FactoryIcon from '@mui/icons-material/Factory';
import DevicesIcon from '@mui/icons-material/Devices';
import CategoryIcon from '@mui/icons-material/Category';
import TuneIcon from '@mui/icons-material/Tune';
import JoinInnerIcon from '@mui/icons-material/JoinInner';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import FunctionsIcon from '@mui/icons-material/Functions';
import SaveIcon from '@mui/icons-material/Save';
import RestoreIcon from '@mui/icons-material/Restore';
import { useBrand, BRAND_CONFIG_CHANGED } from '../config/BrandContext';
import SchemaERD from '../components/SchemaERD';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import RuleIcon from '@mui/icons-material/Rule';
import SettingsIcon from '@mui/icons-material/Settings';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import SecurityIcon from '@mui/icons-material/Security';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import PaletteIcon from '@mui/icons-material/Palette';
import BrandingSettings from '../components/configuration/BrandingSettings';
import GridColumnsSettings from '../components/configuration/GridColumnsSettings';
import ViewColumnIcon from '@mui/icons-material/ViewColumn';
import PeopleOutlineIcon from '@mui/icons-material/PeopleOutline';
import VpnKeyIcon from '@mui/icons-material/VpnKey';
import TimelineIcon from '@mui/icons-material/Timeline';
import DeviceHubIcon from '@mui/icons-material/DeviceHub';
import LibraryBooksIcon from '@mui/icons-material/LibraryBooks';
import ListAltIcon from '@mui/icons-material/ListAlt';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import FlagIcon from '@mui/icons-material/Flag';
import TranslateIcon from '@mui/icons-material/Translate';
import PublicIcon from '@mui/icons-material/Public';
import MonitorHeartIcon from '@mui/icons-material/MonitorHeart';
import BuildIcon from '@mui/icons-material/Build';
import { getCurrentUserEmail } from '../context/UserContext';
import DqConfigPanel from '../components/DqConfigPanel';
import PiiMaskingPanel from '../components/PiiMaskingPanel';
import { dqApi } from '../api/client';
import { STAGE_COLORS } from '../types/models';
import type { DqRule } from '../types/models';
import { useToast, type ToastSeverity } from '../components/common/Toast';
import { useAsk } from '../components/common/Confirm';
import { tr, localized } from '../i18n';

import { formatDate } from '../components/common/format';
import { statusColors, seriesColor } from '../theme/brandColors';
// ────────── types ──────────
type HealthData = {
  postgres: { status: string; latency_ms?: number; server_time?: string; error?: string };
  snowflake: { status: string; latency_ms?: number; warehouse?: string; role?: string; error?: string };
  postgres_data?: { entities?: { id: string; label: string; count: number }[]; open_workflows: number; pending_matches: number; audit_entries: number; active_dq_rules: number; codelist_entries: number; codelist_domains: number };
};
type MirrorData = {
  mirror_name: string; status: string; table_count: number; refresh_interval: string;
  last_apply_time: string; current_lag_seconds: number | null; error_message: string | null;
};
type DynamicTable = {
  name: string; rows: number; bytes: number; target_lag: string;
  refresh_mode: string; scheduling_state: string; data_timestamp: string; current_lag_seconds: number | null;
};
type RefreshEntry = {
  NAME: string; STATE: string; REFRESH_START_TIME: string; REFRESH_END_TIME: string; DURATION_MS: number;
};
type DTData = { tables: DynamicTable[]; recent_refreshes: RefreshEntry[] };
type ScdRow = {
  ENTITY: string; RAW_MIRROR: number; SCD1_DEDUP: number; SCD1_ACTIVE: number; SCD2_TOTAL: number; SCD2_CURRENT: number;
};
type ModuleInfo = {
  id: string; label: string; singular: string; icon: string;
  enabled: boolean; allow_create: boolean; order: number; field_count: number; field_total: number;
  country_scoped: boolean; has_matching: boolean; has_hierarchy: boolean; has_workflow: boolean;
};
type FieldInfo = {
  name: string; label: string; type: string; group: string;
  active: boolean; builtin: boolean; required: boolean; unique: boolean;
  searchable: boolean; filterable: boolean; trigram: boolean;
  ref_domain: string | null; ref_table: string | null;
  max_length: number | null; pg_type: string | null; list_display: boolean;
};
type PgFunction = {
  name: string; args: string; return_type: string; definition: string;
};
type LifecycleStage = {
  id: number; entity_type: string; stage_code: string; stage_label: string;
  sort_order: number; is_terminal: boolean; description: string | null;
};
type LifecycleTransition = {
  id: number; entity_type: string; from_stage_code: string; to_stage_code: string;
  required_role: string | null;
};
type MdmRole = {
  role_code: string; role_label: string; description: string | null;
  sort_order: number; is_system: boolean;
};

// ────────── helpers ──────────
const MODULE_ICONS: Record<string, React.ReactNode> = {
  People: <PeopleIcon />,
  Inventory2: <Inventory2Icon />,
  LocalShipping: <LocalShippingIcon />,
  Store: <StoreIcon />,
  Factory: <FactoryIcon />,
  Devices: <DevicesIcon />,
  Category: <CategoryIcon />,
};

function StatusChip({ status }: { status: string }) {
  const ok = status === 'healthy' || status === 'ACTIVE' || status === 'SUCCEEDED';
  const label = tr(`common.statusValue.${String(status).toLowerCase()}`, { defaultValue: status });
  return <Chip icon={ok ? <CheckCircleIcon /> : <ErrorIcon />} label={label} size="small" color={ok ? 'success' : 'error'} variant="outlined" />;
}

function LagDisplay({ seconds, label }: { seconds: number | null | undefined; label?: string }) {
  if (seconds == null || !Number.isFinite(seconds)) return <Typography variant="body2" color="text.secondary">N/A</Typography>;
  const color = seconds < 120 ? 'success.main' : seconds < 600 ? 'warning.main' : 'error.main';
  const display = seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.round(seconds / 60)}m ${seconds % 60}s` : `${Math.round(seconds / 3600)}h`;
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <ScheduleIcon sx={{ fontSize: 16, color }} />
      <Typography variant="body2" sx={{ color, fontWeight: 600 }}>{display}</Typography>
      {label && <Typography variant="caption" color="text.secondary">{label}</Typography>}
    </Box>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

const LAG_OPTIONS = ['1 minute', '2 minutes', '5 minutes', '10 minutes', '15 minutes', '30 minutes', '1 hour'];
const RULE_TYPES = ['COMPLETENESS', 'VALIDITY', 'CONSISTENCY', 'UNIQUENESS', 'TIMELINESS'];
const SEVERITIES = ['ERROR', 'WARNING', 'INFO'];
const ruleTypeColor = (t: string) => {
  switch (t) {
    case 'COMPLETENESS': return statusColors().info;
    case 'VALIDITY': return statusColors().success;
    case 'CONSISTENCY': return statusColors().warning;
    case 'UNIQUENESS': return seriesColor(1);
    case 'TIMELINESS': return statusColors().neutral;
    default: return statusColors().neutral;
  }
};

// ────────── tree nav definition ──────────
interface TreeItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  children?: TreeItem[];
  dynamic?: boolean; // built from modules
}

// Functions, not constants: labels must follow the language chosen after the module was loaded
const staticTree = (): TreeItem[] => [
  {
    id: 'modules',
    label: tr('configuration.modules'),
    icon: <ExtensionIcon />,
    dynamic: true,
    children: [], // filled at runtime from modules
  },
  {
    id: 'shared',
    label: tr('configuration.sharedCapabilities'),
    icon: <LibraryBooksIcon />,
    children: [
      { id: 'shared/reference-data', label: tr('configuration.referenceData'), icon: <ListAltIcon /> },
      { id: 'shared/dq-library', label: tr('configuration.dqRuleLibrary'), icon: <RuleIcon /> },
      { id: 'shared/localization', label: tr('configuration.localization'), icon: <TranslateIcon /> },
      { id: 'shared/branding', label: tr('configuration.branding'), icon: <PaletteIcon /> },
    ],
  },
  {
    id: 'integrations',
    label: tr('configuration.integrations'),
    icon: <SyncIcon />,
    children: [
      { id: 'integrations/replication', label: tr('configuration.replication'), icon: <SyncIcon /> },
    ],
  },
  {
    id: 'security',
    label: tr('configuration.security'),
    icon: <SecurityIcon />,
    children: [
      { id: 'security/users', label: tr('configuration.users'), icon: <PeopleOutlineIcon /> },
      { id: 'security/roles', label: tr('configuration.roles'), icon: <VpnKeyIcon /> },
      { id: 'security/data-masking', label: tr('configuration.dataMasking'), icon: <VisibilityOffIcon /> },
    ],
  },
  {
    id: 'system',
    label: tr('configuration.system'),
    icon: <BuildIcon />,
    children: [
      { id: 'system/health', label: tr('configuration.health'), icon: <MonitorHeartIcon /> },
    ],
  },
];

const moduleSubItems = () => [
  { suffix: 'general', label: tr('configuration.general'), icon: <InfoOutlinedIcon /> },
  { suffix: 'data-model', label: tr('configuration.dataModel'), icon: <AccountTreeIcon /> },
  { suffix: 'grid', label: tr('configuration.gridColumns'), icon: <ViewColumnIcon /> },
  { suffix: 'data-quality', label: tr('configuration.dataQuality'), icon: <VerifiedUserIcon /> },
  { suffix: 'matching', label: tr('configuration.matching'), icon: <JoinInnerIcon /> },
  { suffix: 'hierarchy', label: tr('configuration.hierarchy'), icon: <DeviceHubIcon /> },
  { suffix: 'workflows', label: tr('configuration.workflows'), icon: <TimelineIcon /> },
];

const NAV_WIDTH = 250;

// ────────── main component ──────────
export default function Configuration() {
  const ask = useAsk();
  const { section, subsection, tab: tabParam } = useParams<{ section?: string; subsection?: string; tab?: string }>();
  const navigate = useNavigate();
  const theme = useTheme();
  const brand = useBrand();
  const isDark = theme.palette.mode === 'dark';
  const accent = brand.palette?.primary || seriesColor(0);

  // current selection


  // expanded tree nodes
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    initial.add('modules');
    if (section) initial.add(section);
    return initial;
  });

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const [searchParams, setSearchParams] = useSearchParams();
  const [moduleSubTab, setModuleSubTab] = useState<string>(() => tabParam || searchParams.get('tab') || 'general');
  // Module sub-tabs are addressable: /configuration/modules/<module>/<tab>
  const openModuleTab = (moduleId: string, tab: string) => {
    setModuleSubTab(tab);
    navigate(`/configuration/modules/${moduleId}/${tab}`, { replace: true });
  };
  useEffect(() => { if (tabParam) setModuleSubTab(tabParam); }, [tabParam]);

  const goTo = (id: string) => {
    const parts = id.split('/');
    if (parts.length === 1) navigate(`/configuration/${parts[0]}`);
    else if (parts.length >= 3 && parts[0] === 'modules') openModuleTab(parts[1], parts[2]);
    else navigate(`/configuration/${parts[0]}/${parts[1]}`);
  };

  // ── data state ──
  const [health, setHealth] = useState<HealthData | null>(null);
  const [mirror, setMirror] = useState<MirrorData | null>(null);
  const [dtData, setDtData] = useState<DTData | null>(null);
  const [scdStats, setScdStats] = useState<ScdRow[]>([]);
  const [moduleSync, setModuleSync] = useState<{ state: string; targetVersion: number | null; lastError: string | null; updatedAt: string | null;
    log: { SYNCED_AT: string; CONFIG_VERSION: number; MODULE: string; STATUS: string; DETAIL: string | null }[] } | null>(null);
  const [modules, setModules] = useState<ModuleInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState<string | null>(null);

  // field management
  const [expandedModule, setExpandedModule] = useState<string | null>(null);
  const [moduleFields, setModuleFields] = useState<FieldInfo[]>([]);
  const [fieldsLoading, setFieldsLoading] = useState(false);
  const [showAddField, setShowAddField] = useState(false);
  const [newField, setNewField] = useState({ name: '', label: '', type: 'text', group: '', max_length: 200 });

  // validation functions
  const [pgFunctions, setPgFunctions] = useState<PgFunction[]>([]);
  const [expandedFn, setExpandedFn] = useState<string | null>(null);
  const [fnEdits, setFnEdits] = useState<Map<string, string>>(new Map());
  const [fnSaving, setFnSaving] = useState<string | null>(null);
  const toast = useToast();
  const setSnack = (s: { msg: string; severity: ToastSeverity } | null) => { if (s) toast(s.msg, s.severity); };

  // lifecycle (workflow) configuration
  const [lifecycleData, setLifecycleData] = useState<Record<string, { stages: LifecycleStage[]; transitions: LifecycleTransition[] }>>({});
  const [editingStageId, setEditingStageId] = useState<number | null>(null);
  const [editStageLabel, setEditStageLabel] = useState('');
  const [editStageOrder, setEditStageOrder] = useState(0);
  const [editStageTerminal, setEditStageTerminal] = useState(false);
  const [editStageDesc, setEditStageDesc] = useState('');
  const [addingStage, setAddingStage] = useState(false);
  const [newStage, setNewStage] = useState({ code: '', label: '', sort_order: 99, is_terminal: false, description: '' });
  const [addingTransition, setAddingTransition] = useState(false);
  const [newTransition, setNewTransition] = useState({ from: '', to: '', role: '' });

  // Localization — seeded from /api/config, then kept in sync by the mutators below.
  // `enabled` is omitted when true, so treat undefined as active.
  const [languages, setLanguages] = useState<Array<{ code: string; label: string; default?: boolean; enabled?: boolean }>>([]);
  const [countries, setCountries] = useState<Array<{ code: string; label: string; enabled?: boolean }>>([]);
  const [newLang, setNewLang] = useState({ code: '', label: '' });
  const [newCountry, setNewCountry] = useState({ code: '', label: '' });
  const [locBusy, setLocBusy] = useState(false);

  // MDM roles
  const [mdmRoles, setMdmRoles] = useState<MdmRole[]>([]);
  const [editingRoleCode, setEditingRoleCode] = useState<string | null>(null);
  const [editRoleLabel, setEditRoleLabel] = useState('');
  const [editRoleDesc, setEditRoleDesc] = useState('');
  const [editRoleOrder, setEditRoleOrder] = useState(0);
  const [addingRole, setAddingRole] = useState(false);
  const [newRole, setNewRole] = useState({ code: '', label: '', description: '', sort_order: 99 });

  // User management
  interface MdmUser { email: string; display_name: string; role: string; country_scope: string[] | null; entity_scope: string[] | null; mdm_roles: string[] | null; is_active: boolean; created_at: string; sf_user?: string | null }
  const [mdmUsers, setMdmUsers] = useState<MdmUser[]>([]);
  const [editingUserEmail, setEditingUserEmail] = useState<string | null>(null);
  const [editUserForm, setEditUserForm] = useState({ display_name: '', role: '', country_scope: '' as string, mdm_roles: [] as string[], is_active: true, sf_user: '' });
  const [addingUser, setAddingUser] = useState(false);
  const [newUser, setNewUser] = useState({ email: '', display_name: '', role: 'VIEWER', country_scope: '', mdm_roles: [] as string[], sf_user: '' });

  // DQ rules
  const [dqRules, setDqRules] = useState<DqRule[]>([]);
  const [dqConfigOpen, setDqConfigOpen] = useState<string | null>(null);
  const [createRuleOpen, setCreateRuleOpen] = useState(false);
  const [createRuleEntity, setCreateRuleEntity] = useState('');
  const [newDqRule, setNewDqRule] = useState({ entity_type: '', rule_code: '', rule_name: '', rule_type: 'COMPLETENESS', severity: 'WARNING', sql_expression: '' });
  const [dqCreating, setDqCreating] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<number | null>(null);
  const [editRuleSql, setEditRuleSql] = useState('');
  const [editRuleType, setEditRuleType] = useState('');
  const [editRuleSeverity, setEditRuleSeverity] = useState('');
  const [dqTemplateSummary, setDqTemplateSummary] = useState<Record<string, { total: number; covered: number; custom: number }>>({});

  const userHeaders = () => ({ 'Content-Type': 'application/json', 'x-mdm-user': getCurrentUserEmail() });

  const fetchRoles = useCallback(async () => {
    const hdrs = { 'x-mdm-user': getCurrentUserEmail() };
    const data = await fetch('/api/admin/roles', { headers: hdrs }).then(r => r.json()).catch(() => []);
    if (Array.isArray(data)) setMdmRoles(data);
  }, []);

  const fetchUsers = useCallback(async () => {
    const hdrs = { 'x-mdm-user': getCurrentUserEmail() };
    const data = await fetch('/api/auth/users', { headers: hdrs }).then(r => r.json()).catch(() => []);
    if (Array.isArray(data)) setMdmUsers(data);
  }, []);

  const fetchLifecycle = useCallback(async (entityType: string) => {
    const hdrs = { 'x-mdm-user': getCurrentUserEmail() };
    const data = await fetch(`/api/admin/lifecycle/${entityType}`, { headers: hdrs }).then(r => r.json()).catch(() => null);
    if (data) setLifecycleData(prev => ({ ...prev, [entityType.toUpperCase()]: data }));
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const hdrs = { 'x-mdm-user': getCurrentUserEmail() };
    const safeFetch = (url: string) => fetch(url, { headers: hdrs }).then(r => r.json()).catch(() => null);
    const [h, m, dt, scd, mods, fns, rules, sync] = await Promise.all([
      safeFetch('/api/admin/health'),
      safeFetch('/api/admin/mirror'),
      safeFetch('/api/admin/dynamic-tables'),
      safeFetch('/api/admin/scd-stats'),
      safeFetch('/api/admin/modules'),
      safeFetch('/api/admin/functions'),
      safeFetch('/api/dq/rules'),
      safeFetch('/api/admin/modules/sync'),
    ]);
    if (h) setHealth(h);
    if (m) setMirror(m);
    if (dt) setDtData(dt?.tables ? dt : { tables: [], recent_refreshes: [] });
    if (scd) setScdStats(Array.isArray(scd) ? scd : []);
    if (mods) setModules(Array.isArray(mods) ? mods : []);
    if (fns) setPgFunctions(Array.isArray(fns) ? fns : []);
    if (rules) setDqRules(Array.isArray(rules) ? rules : []);
    if (sync && !sync.error) setModuleSync(sync);
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);
  useEffect(() => { const interval = setInterval(fetchAll, 30000); return () => clearInterval(interval); }, [fetchAll]);

  // DQ template summary
  useEffect(() => {
    if (modules.length === 0) return;
    const load = async () => {
      const hdrs = { 'x-mdm-user': getCurrentUserEmail() };
      const summaries: Record<string, { total: number; covered: number; custom: number }> = {};
      // All modules, enabled or not: a disabled module can still be configured before it goes live
      for (const m of modules) {
        try {
          const res = await fetch(`/api/dq/templates/${m.id.toUpperCase()}`, { headers: hdrs });
          const d = await res.json();
          summaries[m.id] = { total: d.totalFields ?? 0, covered: d.coveredFields ?? 0, custom: d.customRuleCount ?? 0 };
        } catch { summaries[m.id] = { total: 0, covered: 0, custom: 0 }; }
      }
      setDqTemplateSummary(summaries);
    };
    load();
  }, [modules]);

  // Function-to-entity mapping
  const FN_ENTITY_MAP: Record<string, string> = {
    fn_validate_customer: 'customer', fn_validate_address: 'customer',
    fn_validate_email: 'customer', fn_validate_phone_e164: 'customer',
    fn_validate_siret: 'customer', fn_validate_tax_id: 'customer',
  };
  const TRIGGER_FNS = new Set(['fn_audit_trigger', 'fn_set_updated_at', 'fn_assign_golden_id', 'fn_update_hierarchy_path']);
  const fnsByEntity = (entityId: string) => pgFunctions.filter(f => FN_ENTITY_MAP[f.name] === entityId);
  const commonFns = pgFunctions.filter(f => !FN_ENTITY_MAP[f.name]);
  const triggerFns = commonFns.filter(f => TRIGGER_FNS.has(f.name));
  const utilityFns = commonFns.filter(f => !TRIGGER_FNS.has(f.name));

  // ── module / field / fn actions ──
  const updateDtLag = async (name: string, lag: string) => {
    setRefreshing(name);
    await fetch(`/api/admin/dynamic-tables/${name}/lag`, { method: 'PUT', headers: userHeaders(), body: JSON.stringify({ target_lag: lag }) });
    setTimeout(fetchAll, 1000);
    setRefreshing(null);
  };
  const triggerRefresh = async (name: string) => {
    setRefreshing(name);
    await fetch(`/api/admin/dynamic-tables/${name}/refresh`, { method: 'POST', headers: userHeaders() });
    setTimeout(fetchAll, 2000);
    setRefreshing(null);
  };
  const updateMirrorLag = async (interval: string) => {
    setRefreshing('mirror');
    await fetch('/api/admin/mirror/lag', { method: 'PUT', headers: userHeaders(), body: JSON.stringify({ refresh_interval: interval }) });
    setTimeout(fetchAll, 1000);
    setRefreshing(null);
  };
  const toggleModule = async (id: string, enabled: boolean) => {
    await fetch(`/api/admin/modules/${id}`, { method: 'PUT', headers: userHeaders(), body: JSON.stringify({ enabled }) });
    setModules(prev => prev.map(m => m.id === id ? { ...m, enabled } : m));
    setTimeout(() => window.location.reload(), 400);
  };
  const toggleModuleProp = async (id: string, prop: 'allow_create' | 'country_scoped', value: boolean) => {
    await fetch(`/api/admin/modules/${id}`, { method: 'PUT', headers: userHeaders(), body: JSON.stringify({ [prop]: value }) });
    setModules(prev => prev.map(m => m.id === id ? { ...m, [prop]: value } : m));
    window.dispatchEvent(new Event(BRAND_CONFIG_CHANGED));
  };

  // ── Localization handlers ──
  // Seed local state once the brand config arrives from /api/config.
  useEffect(() => {
    setLanguages(brand.languages || []);
    setCountries(brand.countries || []);
  }, [brand.languages, brand.countries]);

  // Shared request wrapper: surfaces the API's error message in the snackbar and
  // applies the authoritative list the server returns.
  const locRequest = async (
    url: string,
    init: RequestInit,
    onOk: (body: Record<string, unknown>) => void,
    okMsg: string,
  ) => {
    setLocBusy(true);
    try {
      const res = await fetch(url, { headers: userHeaders(), ...init });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSnack({ msg: (body as { error?: string }).error || `Request failed (${res.status})`, severity: 'error' });
        return false;
      }
      onOk(body as Record<string, unknown>);
      // Let BrandProvider refetch so other pages (e.g. product translate buttons) see the change.
      window.dispatchEvent(new Event(BRAND_CONFIG_CHANGED));
      setSnack({ msg: okMsg, severity: 'success' });
      return true;
    } catch {
      setSnack({ msg: tr('configuration.networkErrorIsTheApi'), severity: 'error' });
      return false;
    } finally {
      setLocBusy(false);
    }
  };

  const addLanguage = async () => {
    const code = newLang.code.trim().toLowerCase();
    const label = newLang.label.trim();
    if (!code || !label) return;
    const ok = await locRequest(
      '/api/admin/localization/languages',
      { method: 'POST', body: JSON.stringify({ code, label }) },
      () => setLanguages(prev => (prev.length === 0 ? [{ code, label, default: true }] : [...prev, { code, label }])),
      `Language "${label}" added`,
    );
    if (ok) setNewLang({ code: '', label: '' });
  };

  const toggleLanguageEnabled = (code: string, enabled: boolean) => locRequest(
    `/api/admin/localization/languages/${encodeURIComponent(code)}/enabled`,
    { method: 'PUT', body: JSON.stringify({ enabled }) },
    body => setLanguages((body.languages as Array<{ code: string; label: string; default?: boolean; enabled?: boolean }>) || []),
    `Language "${code}" ${enabled ? 'activated' : 'deactivated'}`,
  );

  const makeDefaultLanguage = (code: string) => locRequest(
    `/api/admin/localization/languages/${encodeURIComponent(code)}/default`,
    { method: 'PUT' },
    body => setLanguages((body.languages as Array<{ code: string; label: string; default?: boolean }>) || []),
    tr('configuration.defaultLanguageSet', { code }),
  );

  const addCountry = async () => {
    const code = newCountry.code.trim().toUpperCase();
    const label = newCountry.label.trim();
    if (!code || !label) return;
    const ok = await locRequest(
      '/api/admin/localization/countries',
      { method: 'POST', body: JSON.stringify({ code, label }) },
      () => setCountries(prev => [...prev, { code, label }]),
      `Country "${label}" added`,
    );
    if (ok) setNewCountry({ code: '', label: '' });
  };

  const toggleCountryEnabled = (code: string, enabled: boolean) => locRequest(
    `/api/admin/localization/countries/${encodeURIComponent(code)}/enabled`,
    { method: 'PUT', body: JSON.stringify({ enabled }) },
    body => setCountries((body.countries as Array<{ code: string; label: string; enabled?: boolean }>) || []),
    `Country "${code}" ${enabled ? 'activated' : 'deactivated'}`,
  );
  const loadFields = async (moduleId: string) => {
    if (expandedModule === moduleId) { setExpandedModule(null); return; }
    setFieldsLoading(true);
    setExpandedModule(moduleId);
    try {
      const res = await fetch(`/api/admin/modules/${moduleId}/fields`, { headers: { 'x-mdm-user': getCurrentUserEmail() } });
      const data = await res.json();
      setModuleFields(Array.isArray(data) ? data : []);
    } catch { setModuleFields([]); }
    setFieldsLoading(false);
    setShowAddField(false);
  };
  const toggleField = async (moduleId: string, fieldName: string, active: boolean) => {
    await fetch(`/api/admin/modules/${moduleId}/fields/${fieldName}`, { method: 'PUT', headers: userHeaders(), body: JSON.stringify({ active }) });
    setModuleFields(prev => prev.map(f => f.name === fieldName ? { ...f, active } : f));
    setModules(prev => prev.map(m => m.id === moduleId ? { ...m, field_count: m.field_count + (active ? 1 : -1) } : m));
  };
  const addField = async (moduleId: string) => {
    if (!newField.name || !newField.label || !newField.group) return;
    const res = await fetch(`/api/admin/modules/${moduleId}/fields`, { method: 'POST', headers: userHeaders(), body: JSON.stringify(newField) });
    if (res.ok) {
      await loadFields(moduleId);
      setNewField({ name: '', label: '', type: 'text', group: '', max_length: 200 });
      setShowAddField(false);
    }
  };
  const deleteField = async (moduleId: string, fieldName: string) => {
    await fetch(`/api/admin/modules/${moduleId}/fields/${fieldName}`, { method: 'DELETE', headers: userHeaders() });
    setModuleFields(prev => prev.filter(f => f.name !== fieldName));
  };
  const toggleFn = (name: string) => setExpandedFn(prev => prev === name ? null : name);
  const getFnEdit = (name: string) => { const orig = pgFunctions.find(f => f.name === name); return fnEdits.get(name) ?? orig?.definition ?? ''; };
  const isFnDirty = (name: string) => { const orig = pgFunctions.find(f => f.name === name); return fnEdits.has(name) && fnEdits.get(name) !== orig?.definition; };
  const saveFn = async (name: string) => {
    const definition = getFnEdit(name);
    setFnSaving(name);
    try {
      const res = await fetch(`/api/admin/functions/${name}`, { method: 'PUT', headers: userHeaders(), body: JSON.stringify({ definition }) });
      const data = await res.json();
      if (!res.ok) { setSnack({ msg: data.error || tr('configuration.failedToSave'), severity: 'error' }); }
      else { setPgFunctions(prev => prev.map(f => f.name === name ? data : f)); setFnEdits(prev => { const m = new Map(prev); m.delete(name); return m; }); setSnack({ msg: tr('configuration.nameUpdatedSuccessfully', { name }), severity: 'success' }); }
    } catch (e: any) { setSnack({ msg: e.message, severity: 'error' }); }
    setFnSaving(null);
  };
  const revertFn = (name: string) => setFnEdits(prev => { const m = new Map(prev); m.delete(name); return m; });

  // DQ rule actions
  const handleCreateDqRule = async () => {
    if (!newDqRule.rule_code || !newDqRule.rule_name || !newDqRule.sql_expression) { setSnack({ msg: tr('configuration.codeNameAndSqlExpression'), severity: 'error' }); return; }
    try {
      setDqCreating(true);
      await dqApi.createRule(newDqRule);
      setCreateRuleOpen(false);
      setNewDqRule({ entity_type: '', rule_code: '', rule_name: '', rule_type: 'COMPLETENESS', severity: 'WARNING', sql_expression: '' });
      const rules = await dqApi.listRules();
      setDqRules(rules);
      setSnack({ msg: tr('configuration.ruleRuleCodeCreated', { rule_code: newDqRule.rule_code }), severity: 'success' });
    } catch (e: any) { setSnack({ msg: tr('configuration.createFailedMessage', { message: e.message }), severity: 'error' }); }
    finally { setDqCreating(false); }
  };
  const handleDeleteDqRule = async (id: number) => {
    if (!(await ask(tr('configuration.deleteThisDqRuleAnd')))) return;
    try { await dqApi.deleteRule(id); setDqRules(prev => prev.filter(r => r.id !== id)); setSnack({ msg: tr('configuration.ruleDeleted'), severity: 'success' }); }
    catch (e: any) { setSnack({ msg: tr('configuration.deleteFailedMessage', { message: e.message }), severity: 'error' }); }
  };
  const handleUpdateDqRule = async (id: number, body: Partial<DqRule>) => {
    try { await dqApi.updateRule(id, body); const rules = await dqApi.listRules(); setDqRules(rules); setEditingRuleId(null); setSnack({ msg: tr('configuration.ruleUpdated'), severity: 'success' }); }
    catch (e: any) { setSnack({ msg: tr('configuration.updateFailedMessage', { message: e.message }), severity: 'error' }); }
  };

  // ── build dynamic tree ──
  // Module labels in the current language (the admin module list has no translations; the brand config does)
  const modLabel = (mod: { id: string; label: string }) => {
    const b = brand.moduleLabels?.[mod.id];
    return b ? localized(b.label, b.labels) : mod.label;
  };
  const tree: TreeItem[] = staticTree().map(item => {
    if (item.id === 'modules') {
      return {
        ...item,
        children: modules.map(mod => ({
          id: `modules/${mod.id}`,
          label: modLabel(mod),
          icon: MODULE_ICONS[mod.icon] || <CategoryIcon />,
          children: moduleSubItems()
            .filter(sub => {
              if (sub.suffix === 'hierarchy' && !mod.has_hierarchy) return false;
              if (sub.suffix === 'matching' && !mod.has_matching) return false;
              return true;
            })
            .map(sub => ({
              id: `modules/${mod.id}/${sub.suffix}`,
              label: sub.label,
              icon: sub.icon,
            })),
        })),
      };
    }
    return item;
  });

  // When navigating to a module, auto-expand and default to 'general'
  useEffect(() => {
    if (section === 'modules' && subsection && !subsection.includes('/')) {
      const mod = modules.find(m => m.id === subsection);
      if (mod) {
        setExpanded(prev => { const n = new Set(prev); n.add('modules'); n.add(`modules/${mod.id}`); return n; });
      }
      const tab = searchParams.get('tab');
      if (tab) {
        setModuleSubTab(tab);
        setSearchParams({}, { replace: true });
      }
    }
  }, [section, subsection, modules, searchParams, setSearchParams]);

  const cardSx = {
    bgcolor: isDark ? alpha('#fff', 0.03) : alpha('#000', 0.02),
    border: `1px solid ${isDark ? alpha('#fff', 0.08) : alpha('#000', 0.08)}`,
    borderRadius: 2,
  };



  // Parse the full active path from URL
  const getActivePath = (): string => {
    if (!section) return 'modules';
    if (!subsection) return section;
    return `${section}/${subsection}`;
  };
  const activePath = getActivePath();



  // ────────── render helpers ──────────
  const renderTreeItem = (item: TreeItem, depth: number = 0) => {
    const hasChildren = item.children && item.children.length > 0;
    const isExpanded = expanded.has(item.id);
    const isActive = (item.id.split('/').length === 3 && item.id.startsWith('modules/')
      ? item.id === `${activePath}/${moduleSubTab}`
      : item.id === activePath) || (item.id === 'modules' && section === 'modules' && !subsection);
    const isParentActive = activePath.startsWith(item.id + '/');

    return (
      <Box key={item.id}>
        <ListItemButton
          onClick={() => {
            if (hasChildren) {
              toggleExpand(item.id);
              // For module items at depth 1, navigate to them
              if (depth === 1 && item.id.startsWith('modules/')) {
                goTo(item.id);
              }
            } else {
              goTo(item.id);
            }
          }}
          sx={{
            borderRadius: 1.5,
            mb: 0.3,
            pl: 1.5 + depth * 2,
            py: 0.5,
            minHeight: 36,
            bgcolor: isActive && !hasChildren ? alpha(accent, 0.12) : 'transparent',
            color: (isActive && !hasChildren) || isParentActive ? accent : 'text.primary',
            fontWeight: isActive ? 600 : 400,
            '&:hover': { bgcolor: alpha(accent, 0.06) },
          }}
        >
          <ListItemIcon sx={{ minWidth: 32, color: 'inherit', '& svg': { fontSize: 18 } }}>
            {item.icon}
          </ListItemIcon>
          <ListItemText
            primary={item.label}
            primaryTypographyProps={{ fontSize: '0.82rem', fontWeight: (isActive || isParentActive) ? 600 : 400 }}
          />
          {hasChildren && (
            <Box sx={{ color: 'text.secondary', display: 'flex' }}>
              {isExpanded ? <ExpandLessIcon sx={{ fontSize: 18 }} /> : <ExpandMoreIcon sx={{ fontSize: 18 }} />}
            </Box>
          )}
        </ListItemButton>
        {hasChildren && (
          <Collapse in={isExpanded} timeout="auto">
            {item.children!.map(child => renderTreeItem(child, depth + 1))}
          </Collapse>
        )}
      </Box>
    );
  };

  // ── function editor card (reused) ──
  const renderFnCard = (fn: PgFunction) => (
    <Card key={fn.name} sx={{ bgcolor: 'transparent', border: `1px solid ${isDark ? alpha('#fff', 0.06) : alpha('#000', 0.06)}`, borderRadius: 1, mb: 1 }}>
      <CardContent sx={{ pb: expandedFn === fn.name ? 2 : '8px !important', pt: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }} onClick={() => toggleFn(fn.name)}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <FunctionsIcon sx={{ color: accent, fontSize: 16 }} />
            <Typography variant="body2" fontWeight={600} sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{fn.name}</Typography>
            <Typography variant="caption" color="text.secondary">({fn.args}) &rarr; {fn.return_type}</Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            {isFnDirty(fn.name) && <Chip label="modified" size="small" color="warning" variant="outlined" sx={{ fontSize: '0.55rem', height: 16 }} />}
            {expandedFn === fn.name ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
          </Box>
        </Box>
        {expandedFn === fn.name && (
          <Box sx={{ mt: 1.5 }}>
            <TextField multiline fullWidth minRows={6} maxRows={25} value={getFnEdit(fn.name)}
              onChange={(e) => setFnEdits(prev => new Map(prev).set(fn.name, e.target.value))}
              sx={{ '& .MuiInputBase-input': { fontFamily: '"JetBrains Mono", "Fira Code", monospace', fontSize: '0.75rem', lineHeight: 1.5 }, '& .MuiOutlinedInput-root': { bgcolor: isDark ? alpha('#000', 0.3) : alpha('#f5f5f5', 1) } }}
            />
            <Box sx={{ display: 'flex', gap: 1, mt: 1, justifyContent: 'flex-end' }}>
              <Button size="small" startIcon={<RestoreIcon />} disabled={!isFnDirty(fn.name)} onClick={() => revertFn(fn.name)}>{tr('configuration.revert')}</Button>
              <Button size="small" variant="contained" startIcon={<SaveIcon />} disabled={!isFnDirty(fn.name) || fnSaving === fn.name}
                onClick={() => saveFn(fn.name)} sx={{ bgcolor: accent, '&:hover': { bgcolor: accent } }}>
                {fnSaving === fn.name ? tr('configuration.saving') : 'Save'}
              </Button>
            </Box>
          </Box>
        )}
      </CardContent>
    </Card>
  );

  // ────────── content panels ──────────

  const renderModulesOverview = () => (
    <>
      <Typography variant="h5" fontWeight={700} sx={{ mb: 0.5 }}>{tr('configuration.modules')}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        {tr('configuration.activateOrDeactivateMdmEntity')}
      </Typography>
      <Grid container spacing={2}>
        {modules.map(mod => (
          <Grid key={mod.id} size={{ xs: 12, sm: 6, md: 4 }}>
            <Card sx={{
              ...cardSx,
              borderLeft: `4px solid ${mod.enabled ? accent : alpha(statusColors().neutral, 0.3)}`,
              opacity: mod.enabled ? 1 : 0.7,
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              '&:hover': { borderColor: accent },
            }} onClick={() => { goTo(`modules/${mod.id}`); setExpanded(prev => { const n = new Set(prev); n.add('modules'); n.add(`modules/${mod.id}`); return n; }); }}>
              <CardContent sx={{ pb: '12px !important' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <Box sx={{ color: mod.enabled ? accent : 'text.secondary', display: 'flex' }}>
                      {MODULE_ICONS[mod.icon] || <CategoryIcon />}
                    </Box>
                    <Box>
                      <Typography variant="subtitle1" fontWeight={600}>{mod.label}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {mod.field_count} / {mod.field_total} fields active
                      </Typography>
                    </Box>
                  </Box>
                  <Switch checked={mod.enabled}
                    onClick={e => e.stopPropagation()}
                    onChange={(_, checked) => toggleModule(mod.id, checked)}
                    sx={{ '& .MuiSwitch-switchBase.Mui-checked': { color: accent }, '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { backgroundColor: accent } }}
                  />
                </Box>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 1.5 }}>
                  {mod.country_scoped && <Chip label={tr('configuration.countryScope')} size="small" variant="outlined" sx={{ fontSize: '0.65rem', height: 20 }} />}
                  {mod.has_matching && <Chip label={tr('configuration.matching')} size="small" variant="outlined" sx={{ fontSize: '0.65rem', height: 20 }} />}
                  {mod.has_hierarchy && <Chip label={tr('configuration.hierarchy')} size="small" variant="outlined" sx={{ fontSize: '0.65rem', height: 20 }} />}
                  {mod.has_workflow && <Chip label={tr('configuration.workflow')} size="small" variant="outlined" sx={{ fontSize: '0.65rem', height: 20 }} />}
                </Box>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>
    </>
  );

  const renderModuleGeneral = (mod: ModuleInfo) => (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3 }}>
        <Box sx={{ color: accent, display: 'flex' }}>{MODULE_ICONS[mod.icon] || <CategoryIcon />}</Box>
        <Typography variant="h5" fontWeight={700}>{mod.label}</Typography>
        <Chip label={mod.enabled ? tr('configuration.active') : 'Disabled'} size="small" color={mod.enabled ? 'success' : 'default'} />
      </Box>

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 6, md: 3 }}>
          <Card sx={cardSx}><CardContent>
            <Typography variant="overline" color="text.secondary">{tr('configuration.fields')}</Typography>
            <Typography variant="h4" fontWeight={700}>{mod.field_count} <Typography component="span" variant="body2" color="text.secondary">/ {mod.field_total}</Typography></Typography>
          </CardContent></Card>
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <Card sx={cardSx}><CardContent>
            <Typography variant="overline" color="text.secondary">{tr('configuration.dqRules')}</Typography>
            <Typography variant="h4" fontWeight={700}>{dqRules.filter(r => r.entity_type === mod.id.toUpperCase()).length}</Typography>
          </CardContent></Card>
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <Card sx={cardSx}><CardContent>
            <Typography variant="overline" color="text.secondary">{tr('configuration.validationFns')}</Typography>
            <Typography variant="h4" fontWeight={700}>{fnsByEntity(mod.id).length}</Typography>
          </CardContent></Card>
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <Card sx={cardSx}><CardContent>
            <Typography variant="overline" color="text.secondary">{tr('configuration.capabilities')}</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 1 }}>
              {mod.country_scoped && <Chip label={tr('configuration.countryScope')} size="small" variant="outlined" sx={{ fontSize: '0.65rem', height: 20 }} />}
              {mod.has_matching && <Chip label={tr('configuration.matching')} size="small" variant="outlined" sx={{ fontSize: '0.65rem', height: 20 }} />}
              {mod.has_hierarchy && <Chip label={tr('configuration.hierarchy')} size="small" variant="outlined" sx={{ fontSize: '0.65rem', height: 20 }} />}
              {mod.has_workflow && <Chip label={tr('configuration.workflow')} size="small" variant="outlined" sx={{ fontSize: '0.65rem', height: 20 }} />}
            </Box>
          </CardContent></Card>
        </Grid>
      </Grid>

      <Card sx={cardSx}>
        <CardContent>
          <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>{tr('configuration.moduleSettings')}</Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="body2">{tr('configuration.moduleEnabled')}</Typography>
            <Switch checked={mod.enabled} onChange={(_, checked) => toggleModule(mod.id, checked)}
              sx={{ '& .MuiSwitch-switchBase.Mui-checked': { color: accent }, '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { backgroundColor: accent } }} />
          </Box>
          <Divider sx={{ my: 1 }} />
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box>
              <Typography variant="body2">{tr('configuration.allowManualCreation')}</Typography>
              <Typography variant="caption" color="text.secondary">{tr('configuration.showNewSingularButtonIn', { singular: mod.singular })}</Typography>
            </Box>
            <Switch checked={mod.allow_create} onChange={(_, checked) => toggleModuleProp(mod.id, 'allow_create', checked)}
              sx={{ '& .MuiSwitch-switchBase.Mui-checked': { color: accent }, '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { backgroundColor: accent } }} />
          </Box>
          <Divider sx={{ my: 1 }} />
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box>
              <Typography variant="body2">{tr('configuration.countryScoped')}</Typography>
              <Typography variant="caption" color="text.secondary">{tr('configuration.enableCountryFieldRowAccess')}</Typography>
            </Box>
            <Switch checked={mod.country_scoped} onChange={(_, checked) => toggleModuleProp(mod.id, 'country_scoped', checked)}
              sx={{ '& .MuiSwitch-switchBase.Mui-checked': { color: accent }, '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { backgroundColor: accent } }} />
          </Box>
        </CardContent>
      </Card>
    </>
  );

  const renderModuleDataModel = (mod: ModuleInfo) => {
    const isExpanded = expandedModule === mod.id;
    return (
      <>
        <Typography variant="h5" fontWeight={700} sx={{ mb: 0.5 }}>{tr('configuration.labelDataModel', { label: mod.label })}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          {tr('configuration.activateFieldsFromTheBuilt')}
        </Typography>

        {/* Field list */}
        <Card sx={{ ...cardSx, mb: 3 }}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <TuneIcon sx={{ color: accent }} />
                <Typography variant="subtitle1" fontWeight={600}>{tr('configuration.fieldManagement')}</Typography>
                <Chip label={tr('configuration.fieldsActive', { count: mod.field_count })} size="small" color="primary" variant="outlined" sx={{ fontSize: '0.65rem', height: 20 }} />
                <Chip label={tr('configuration.fieldsAvailable', { count: mod.field_total - mod.field_count })} size="small" variant="outlined" sx={{ fontSize: '0.65rem', height: 20, color: 'text.secondary' }} />
              </Box>
              {!isExpanded && (
                <Button size="small" onClick={() => loadFields(mod.id)}>{tr('configuration.expandFields')}</Button>
              )}
            </Box>

            {!isExpanded && !fieldsLoading && (
              <Button variant="outlined" fullWidth onClick={() => loadFields(mod.id)} sx={{ py: 1.5 }}>
                {tr('configuration.loadFieldTotalFields', { field_total: mod.field_total })}
              </Button>
            )}

            {fieldsLoading && <LinearProgress sx={{ my: 2 }} />}

            {isExpanded && (
              <>
                {Array.from(new Set(moduleFields.map(f => f.group))).map(group => (
                  <Box key={group} sx={{ mb: 2 }}>
                    <Typography variant="overline" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 1, fontSize: '0.65rem' }}>
                      {group}
                    </Typography>
                    <Divider sx={{ mb: 0.5 }} />
                    {moduleFields.filter(f => f.group === group).map(field => (
                      <Box key={field.name} sx={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        py: 0.4, px: 1, borderRadius: 1,
                        '&:hover': { bgcolor: isDark ? alpha('#fff', 0.03) : alpha('#000', 0.02) },
                        opacity: field.active ? 1 : 0.55,
                      }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                          <Typography variant="body2" fontWeight={field.active ? 500 : 400} sx={{ minWidth: 140 }}>{field.label}</Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }}>{field.name}</Typography>
                          <Chip label={field.type} size="small" variant="outlined" sx={{ fontSize: '0.6rem', height: 18, ml: 0.5 }} />
                          {field.required && <Chip label="required" size="small" color="error" variant="outlined" sx={{ fontSize: '0.6rem', height: 18 }} />}
                          {field.unique && <Chip label="unique" size="small" color="warning" variant="outlined" sx={{ fontSize: '0.6rem', height: 18 }} />}
                          {field.searchable && <Chip label="search" size="small" color="info" variant="outlined" sx={{ fontSize: '0.6rem', height: 18 }} />}
                          {!field.builtin && <Chip label="custom" size="small" color="secondary" sx={{ fontSize: '0.6rem', height: 18 }} />}
                        </Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          {!field.builtin && (
                            <IconButton size="small" onClick={() => deleteField(mod.id, field.name)} sx={{ color: 'error.main' }}>
                              <DeleteOutlineIcon fontSize="small" />
                            </IconButton>
                          )}
                          <Switch size="small" checked={field.active} disabled={field.required}
                            onChange={(_, checked) => toggleField(mod.id, field.name, checked)}
                            sx={{ '& .MuiSwitch-switchBase.Mui-checked': { color: accent }, '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { backgroundColor: accent } }}
                          />
                        </Box>
                      </Box>
                    ))}
                  </Box>
                ))}

                <Divider sx={{ my: 1.5 }} />
                {!showAddField ? (
                  <Button size="small" startIcon={<AddIcon />} onClick={() => setShowAddField(true)} sx={{ color: accent }}>{tr('configuration.addCustomField')}</Button>
                ) : (
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <TextField size="small" label={tr('configuration.columnName')} value={newField.name} placeholder={tr('configuration.eGCustomCode')}
                      onChange={e => setNewField(p => ({ ...p, name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') }))} sx={{ width: 150 }} />
                    <TextField size="small" label={tr('configuration.label')} value={newField.label} onChange={e => setNewField(p => ({ ...p, label: e.target.value }))} sx={{ width: 150 }} />
                    <TextField select size="small" label={tr('configuration.type')} value={newField.type} onChange={e => setNewField(p => ({ ...p, type: e.target.value }))} sx={{ width: 100 }}>
                      {['text', 'number', 'boolean', 'date', 'ref'].map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                    </TextField>
                    <TextField size="small" label={tr('configuration.group')} value={newField.group} placeholder={tr('configuration.eGCustom')}
                      onChange={e => setNewField(p => ({ ...p, group: e.target.value.toLowerCase() }))} sx={{ width: 120 }} />
                    <Button variant="contained" size="small" onClick={() => addField(mod.id)} disabled={!newField.name || !newField.label || !newField.group}
                      sx={{ bgcolor: accent, '&:hover': { bgcolor: accent } }}>{tr('configuration.add2')}</Button>
                    <Button size="small" onClick={() => setShowAddField(false)}>{tr('configuration.cancel')}</Button>
                  </Box>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* ERD */}
        <Typography variant="h6" fontWeight={600} gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <AccountTreeIcon sx={{ color: accent }} /> Entity Relationship Diagram
        </Typography>
        <Box sx={{ mb: 3 }}>
          <SchemaERD accent={accent} disabledModules={modules.filter(m => !m.enabled).map(m => m.id)} />
        </Box>
      </>
    );
  };

  const renderModuleDataQuality = (mod: ModuleInfo) => {
    const entityType = mod.id.toUpperCase();
    const entityRules = dqRules.filter(r => r.entity_type === entityType);
    const templateRules = entityRules.filter(r => r.rule_code.startsWith('TPL_'));
    const customRules = entityRules.filter(r => !r.rule_code.startsWith('TPL_'));
    const summary = dqTemplateSummary[mod.id];
    const entityFns = fnsByEntity(mod.id);

    return (
      <>
        <Typography variant="h5" fontWeight={700} sx={{ mb: 0.5 }}>{tr('configuration.labelDataQuality', { label: mod.label })}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          {tr('configuration.manageDqTemplateRulesCustom')}
        </Typography>

        {/* Template Config */}
        <Card sx={{ ...cardSx, mb: 2 }}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <SettingsIcon sx={{ fontSize: 18, color: accent }} />
                <Typography variant="subtitle2" fontWeight={600}>{tr('configuration.dqTemplateConfiguration')}</Typography>
              </Box>
              <Button size="small" variant="outlined" startIcon={<SettingsIcon />} onClick={() => setDqConfigOpen(mod.id)}>{tr('configuration.configure')}</Button>
            </Box>
            {summary ? (
              <Typography variant="body2" color="text.secondary" sx={{ ml: 3.5 }}>
                {summary.covered}/{summary.total} fields covered &middot; {templateRules.length} template rules generated
              </Typography>
            ) : (
              <Typography variant="body2" color="text.secondary" sx={{ ml: 3.5 }}>{tr('configuration.loading')}</Typography>
            )}
          </CardContent>
        </Card>

        {/* Custom Rules */}
        <Card sx={{ ...cardSx, mb: 2 }}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <RuleIcon sx={{ fontSize: 18, color: accent }} />
                <Typography variant="subtitle2" fontWeight={600}>{tr('configuration.customRules')}</Typography>
                <Chip label={customRules.length} size="small" sx={{ fontSize: '0.65rem', height: 18 }} />
              </Box>
              <Button size="small" variant="outlined" startIcon={<AddIcon />}
                onClick={() => { setCreateRuleEntity(entityType); setNewDqRule({ entity_type: entityType, rule_code: '', rule_name: '', rule_type: 'COMPLETENESS', severity: 'WARNING', sql_expression: '' }); setCreateRuleOpen(true); }}>
                {tr('configuration.newRule')}
              </Button>
            </Box>
            {customRules.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ ml: 3.5 }}>{tr('configuration.noCustomRules')}</Typography>
            ) : (
              <Table size="small" sx={{ '& td, & th': { borderColor: isDark ? alpha('#fff', 0.06) : alpha('#000', 0.06), py: 0.5 } }}>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600, width: 160 }}>{tr('configuration.code')}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{tr('configuration.name')}</TableCell>
                    <TableCell sx={{ fontWeight: 600, width: 110 }}>{tr('configuration.type')}</TableCell>
                    <TableCell sx={{ fontWeight: 600, width: 90 }}>{tr('configuration.severity')}</TableCell>
                    <TableCell sx={{ fontWeight: 600, width: 60 }} align="center">{tr('configuration.active')}</TableCell>
                    <TableCell sx={{ fontWeight: 600, width: 80 }} align="center">{tr('configuration.actions')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {customRules.map(rule => (
                    <TableRow key={rule.id} hover>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{rule.rule_code}</TableCell>
                      <TableCell>
                        {editingRuleId === rule.id ? (
                          <TextField size="small" fullWidth value={editRuleSql}
                            onChange={e => setEditRuleSql(e.target.value)}
                            sx={{ '& input': { fontFamily: 'monospace', fontSize: '0.8rem' } }} placeholder={tr('configuration.sqlExpression')} />
                        ) : (
                          <Tooltip title={rule.sql_expression} placement="top-start">
                            <Typography variant="body2" sx={{ fontSize: '0.8rem' }}>{rule.rule_name}</Typography>
                          </Tooltip>
                        )}
                      </TableCell>
                      <TableCell>
                        {editingRuleId === rule.id ? (
                          <TextField select size="small" value={editRuleType} onChange={e => setEditRuleType(e.target.value)}
                            sx={{ minWidth: 110, '& .MuiSelect-select': { fontSize: '0.75rem', py: 0.5 } }}>
                            {['COMPLETENESS', 'VALIDITY', 'CONSISTENCY', 'UNIQUENESS'].map(t => (
                              <MenuItem key={t} value={t} sx={{ fontSize: '0.75rem' }}>{t}</MenuItem>
                            ))}
                          </TextField>
                        ) : (
                          <Chip label={rule.rule_type} size="small"
                            sx={{ fontSize: '0.65rem', height: 20, bgcolor: alpha(ruleTypeColor(rule.rule_type), 0.15), color: ruleTypeColor(rule.rule_type), fontWeight: 600 }} />
                        )}
                      </TableCell>
                      <TableCell>
                        {editingRuleId === rule.id ? (
                          <TextField select size="small" value={editRuleSeverity} onChange={e => setEditRuleSeverity(e.target.value)}
                            sx={{ minWidth: 90, '& .MuiSelect-select': { fontSize: '0.75rem', py: 0.5 } }}>
                            {['ERROR', 'WARNING'].map(s => (
                              <MenuItem key={s} value={s} sx={{ fontSize: '0.75rem' }}>{s}</MenuItem>
                            ))}
                          </TextField>
                        ) : (
                          <Chip label={rule.severity} size="small" variant="outlined"
                            color={rule.severity === 'ERROR' ? 'error' : 'warning'} sx={{ fontSize: '0.65rem', height: 20 }} />
                        )}
                      </TableCell>
                      <TableCell align="center">
                        <Switch size="small" checked={rule.is_active} onChange={(_, v) => handleUpdateDqRule(rule.id, { is_active: v })} />
                      </TableCell>
                      <TableCell align="center">
                        <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'center' }}>
                          {editingRuleId === rule.id ? (
                            <Tooltip title={tr('configuration.save')}><IconButton size="small" onClick={() => handleUpdateDqRule(rule.id, { sql_expression: editRuleSql, rule_type: editRuleType, severity: editRuleSeverity })}>
                              <SaveIcon fontSize="small" sx={{ color: accent }} />
                            </IconButton></Tooltip>
                          ) : (
                            <Tooltip title={tr('configuration.edit')}><IconButton size="small" onClick={() => { setEditingRuleId(rule.id); setEditRuleSql(rule.sql_expression); setEditRuleType(rule.rule_type); setEditRuleSeverity(rule.severity); }}>
                              <EditIcon fontSize="small" />
                            </IconButton></Tooltip>
                          )}
                          <Tooltip title={tr('configuration.delete')}><IconButton size="small" onClick={() => handleDeleteDqRule(rule.id)}>
                            <DeleteIcon fontSize="small" color="error" />
                          </IconButton></Tooltip>
                        </Box>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Validation Functions */}
        {entityFns.length > 0 && (
          <Card sx={{ ...cardSx, mb: 2 }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                <FunctionsIcon sx={{ fontSize: 18, color: accent }} />
                <Typography variant="subtitle2" fontWeight={600}>{tr('configuration.validationFunctions')}</Typography>
                <Chip label={entityFns.length} size="small" sx={{ fontSize: '0.65rem', height: 18 }} />
              </Box>
              {entityFns.map(fn => renderFnCard(fn))}
            </CardContent>
          </Card>
        )}

        {/* DQ Config Panel drawer */}
        <DqConfigPanel
          open={dqConfigOpen === mod.id}
          onClose={() => setDqConfigOpen(null)}
          entityType={mod.id.toUpperCase()}
          entityLabel={mod.label}
          onApplied={async () => {
            const rules = await dqApi.listRules();
            setDqRules(rules);
            const hdrs = { 'x-mdm-user': getCurrentUserEmail() };
            try {
              const res = await fetch(`/api/dq/templates/${mod.id.toUpperCase()}`, { headers: hdrs });
              const d = await res.json();
              setDqTemplateSummary(prev => ({ ...prev, [mod.id]: { total: d.totalFields ?? 0, covered: d.coveredFields ?? 0, custom: d.customRuleCount ?? 0 } }));
            } catch { /* keep current list */ }
            setSnack({ msg: tr('configuration.dqTemplatesAppliedRunDq'), severity: 'success' });
          }}
        />
      </>
    );
  };

  const renderReplication = () => (
    <>
      <Typography variant="h5" fontWeight={700} sx={{ mb: 0.5 }}>{tr('configuration.replication')}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        {tr('configuration.configureCdcMirrorAndDynamic')}
      </Typography>

      <Typography variant="h6" fontWeight={600} gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <ScheduleIcon sx={{ color: accent }} /> Lag Configuration
      </Typography>
      <Grid container spacing={2} sx={{ mb: 4 }}>
        <Grid size={{ xs: 12, md: 4 }}>
          <Card sx={cardSx}>
            <CardContent>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>{tr('configuration.cdcMirrorRefreshInterval')}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{tr('configuration.howOftenSnowflakePullsChanges')}</Typography>
              <TextField select size="small" fullWidth value={mirror?.refresh_interval || '1 minute'}
                onChange={e => updateMirrorLag(e.target.value)} disabled={refreshing === 'mirror'}>
                {LAG_OPTIONS.map(o => <MenuItem key={o} value={o}>{o}</MenuItem>)}
              </TextField>
            </CardContent>
          </Card>
        </Grid>
        {dtData?.tables.map(dt => (
          <Grid key={dt.name} size={{ xs: 12, md: 4 }}>
            <Card sx={cardSx}>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                  <Typography variant="subtitle2" color="text.secondary">{dt.name}</Typography>
                  <Tooltip title={tr('configuration.triggerManualRefresh')}>
                    <IconButton size="small" onClick={() => triggerRefresh(dt.name)} disabled={refreshing === dt.name}>
                      <RefreshIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  {tr('configuration.historyTableRows', { rows: dt.rows, size: formatBytes(dt.bytes) })}
                </Typography>
                <TextField select size="small" fullWidth value={dt.target_lag}
                  onChange={e => updateDtLag(dt.name, e.target.value)} disabled={refreshing === dt.name}>
                  {LAG_OPTIONS.map(o => <MenuItem key={o} value={o}>{o}</MenuItem>)}
                </TextField>
                <Box sx={{ mt: 1 }}><LagDisplay seconds={dt.current_lag_seconds} label={tr('configuration.dataFreshness')} /></Box>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Typography variant="h6" fontWeight={600} gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <SyncIcon sx={{ color: accent }} /> {tr('configuration.moduleSyncTitle')}
      </Typography>
      <Card sx={{ ...cardSx, mb: 4 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1, flexWrap: 'wrap' }}>
            <Chip size="small" label={tr(`configuration.syncState.${moduleSync?.state || 'idle'}`)}
              color={moduleSync?.state === 'ok' ? 'success' : moduleSync?.state === 'error' ? 'error' : moduleSync?.state && moduleSync.state !== 'idle' ? 'warning' : 'default'} />
            {moduleSync?.log?.[0] && (
              <Typography variant="body2" color="text.secondary">
                {tr('configuration.lastSync', { date: formatDate(moduleSync.log[0].SYNCED_AT, true), version: moduleSync.log[0].CONFIG_VERSION })}
              </Typography>
            )}
            <Button size="small" variant="outlined" startIcon={<SyncIcon />} sx={{ ml: 'auto' }}
              disabled={moduleSync?.state === 'scheduled' || moduleSync?.state === 'running' || moduleSync?.state === 'pending'}
              onClick={async () => {
                const r = await fetch('/api/admin/modules/sync', { method: 'POST', headers: userHeaders() });
                if (!r.ok) return;
                const state = await r.json();
                setModuleSync(prev => ({ ...(prev || { log: [], targetVersion: null, lastError: null, updatedAt: null }), ...state }));
              }}>
              {tr('configuration.resync')}
            </Button>
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{tr('configuration.moduleSyncHelp')}</Typography>
          {moduleSync?.lastError && <Alert severity="error" sx={{ mb: 1 }}>{moduleSync.lastError}</Alert>}
          {!!moduleSync?.log?.length && (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('configuration.entity')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('configuration.status')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('configuration.syncDetail')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {/* latest run: newest row per module (log is ordered newest first) */}
                {moduleSync.log.filter((l, i, all) => all.findIndex(o => o.MODULE === l.MODULE) === i).map(l => (
                  <TableRow key={l.MODULE}>
                    <TableCell sx={{ fontWeight: 600 }}>{l.MODULE}</TableCell>
                    <TableCell><Chip size="small" variant="outlined" label={l.STATUS} color={l.STATUS === 'OK' ? 'success' : l.STATUS === 'ERROR' ? 'error' : 'default'} /></TableCell>
                    <TableCell sx={{ color: 'text.secondary', fontSize: '0.8rem' }}>{l.DETAIL || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Typography variant="h6" fontWeight={600} gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <LayersIcon sx={{ color: accent }} /> {tr('configuration.scdRowCounts')}
      </Typography>
      <Card sx={{ ...cardSx, mb: 4 }}>
        <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>{tr('configuration.entity')}</TableCell>
                <TableCell align="right" sx={{ fontWeight: 600 }}>{tr('configuration.rawMirror')}</TableCell>
                <TableCell align="right" sx={{ fontWeight: 600 }}>{tr('configuration.scd1Dedup')}</TableCell>
                <TableCell align="right" sx={{ fontWeight: 600 }}>{tr('configuration.scd1Active')}</TableCell>
                <TableCell align="right" sx={{ fontWeight: 600 }}>{tr('configuration.scd2Versions')}</TableCell>
                <TableCell align="right" sx={{ fontWeight: 600 }}>{tr('configuration.scd2Current')}</TableCell>
                <TableCell align="right" sx={{ fontWeight: 600 }}>{tr('configuration.dedupRatio')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {scdStats.map(row => (
                <TableRow key={row.ENTITY}>
                  <TableCell sx={{ fontWeight: 600 }}>{row.ENTITY}</TableCell>
                  <TableCell align="right">{row.RAW_MIRROR}</TableCell>
                  <TableCell align="right">{row.SCD1_DEDUP}</TableCell>
                  <TableCell align="right">{row.SCD1_ACTIVE}</TableCell>
                  <TableCell align="right">{row.SCD2_TOTAL}</TableCell>
                  <TableCell align="right">{row.SCD2_CURRENT}</TableCell>
                  <TableCell align="right">
                    <Chip label={row.RAW_MIRROR > 0 ? `${((row.SCD1_DEDUP / row.RAW_MIRROR) * 100).toFixed(0)}%` : '—'}
                      size="small" color={row.RAW_MIRROR === row.SCD1_DEDUP ? 'success' : 'warning'} variant="outlined" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Typography variant="h6" fontWeight={600} gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <TableChartIcon sx={{ color: accent }} /> {tr('configuration.recentRefreshes')}
      </Typography>
      <Card sx={cardSx}>
        <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>{tr('configuration.table')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{tr('configuration.status')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{tr('configuration.started')}</TableCell>
                <TableCell align="right" sx={{ fontWeight: 600 }}>{tr('configuration.duration')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(dtData?.recent_refreshes || []).map((r, i) => (
                <TableRow key={i}>
                  <TableCell>{r.NAME}</TableCell>
                  <TableCell><StatusChip status={r.STATE} /></TableCell>
                  <TableCell>{formatDate(r.REFRESH_START_TIME, true)}</TableCell>
                  <TableCell align="right">{r.DURATION_MS != null ? `${r.DURATION_MS}ms` : '—'}</TableCell>
                </TableRow>
              ))}
              {(!dtData?.recent_refreshes || dtData.recent_refreshes.length === 0) && (
                <TableRow><TableCell colSpan={4} align="center" sx={{ color: 'text.secondary' }}>{tr('configuration.noRecentRefreshes')}</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );

  const renderHealth = () => (
    <>
      <Typography variant="h5" fontWeight={700} sx={{ mb: 0.5 }}>{tr('configuration.systemHealth')}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        {tr('configuration.monitorConnectivityAndDataStores')}
      </Typography>
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 4 }}>
          <Card sx={cardSx}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <img src="/logos/postgres-icon.svg" alt="Postgres" width={28} height={28} />
                  <Typography variant="subtitle1" fontWeight={600}>{tr('configuration.postgres')}</Typography>
                </Box>
                {health?.postgres && <StatusChip status={health.postgres.status} />}
              </Box>
              {health?.postgres.latency_ms != null && <Typography variant="body2" color="text.secondary">{tr('common.latency', { ms: health.postgres.latency_ms })}</Typography>}
              {health?.postgres.error && <Typography variant="body2" color="error.main">{health.postgres.error}</Typography>}
              {health?.postgres_data && (
                <Box sx={{ mt: 1.5, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                  {health.postgres_data.entities?.map(e => (
                    <Chip key={e.id} label={tr('configuration.healthEntity', { label: localized(e.label, brand.moduleLabels?.[e.id]?.labels), count: e.count })} size="small" />
                  ))}
                  <Chip label={tr('configuration.healthWorkflows', { count: health.postgres_data.open_workflows })} size="small" />
                  <Chip label={tr('configuration.healthRules', { count: health.postgres_data.active_dq_rules })} size="small" />
                  <Chip label={tr('configuration.healthDomains', { count: health.postgres_data.codelist_domains })} size="small" />
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <Card sx={cardSx}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <img src="/logos/snowflake.png" alt="Snowflake" width={28} height={28} />
                  <Typography variant="subtitle1" fontWeight={600}>{tr('configuration.snowflake')}</Typography>
                </Box>
                {health?.snowflake && <StatusChip status={health.snowflake.status} />}
              </Box>
              {health?.snowflake.latency_ms != null && <Typography variant="body2" color="text.secondary">{tr('common.latency', { ms: health.snowflake.latency_ms })}</Typography>}
              {health?.snowflake.warehouse && <Typography variant="body2" color="text.secondary">{tr('configuration.warehouseRole', { warehouse: health.snowflake.warehouse, role: health.snowflake.role })}</Typography>}
              {health?.snowflake.error && <Typography variant="body2" color="error.main">{health.snowflake.error}</Typography>}
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <Card sx={cardSx}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <SyncIcon sx={{ color: brand.palette.accent }} />
                  <Typography variant="subtitle1" fontWeight={600}>{tr('configuration.cdcMirror')}</Typography>
                </Box>
                {mirror && <StatusChip status={mirror.status} />}
              </Box>
              {mirror && (
                <>
                  <Typography variant="body2" color="text.secondary">{tr('configuration.tableCountTablesMirrored', { table_count: mirror.table_count })}</Typography>
                  <LagDisplay seconds={mirror.current_lag_seconds} label={tr('configuration.sinceLastCheck')} />
                  {mirror.error_message && <Typography variant="body2" color="error.main" sx={{ mt: 0.5 }}>{mirror.error_message}</Typography>}
                </>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </>
  );

  const renderSharedDqLibrary = () => (
    <>
      <Typography variant="h5" fontWeight={700} sx={{ mb: 0.5 }}>{tr('configuration.dqRuleLibrary')}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        {tr('configuration.commonFunctionsUsedAcrossAll')}
      </Typography>

      {triggerFns.length > 0 && (
        <Card sx={{ ...cardSx, mb: 2 }}>
          <CardContent>
            <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1.5 }}>{tr('configuration.triggerFunctionsAutoApplied')}</Typography>
            {triggerFns.map(fn => renderFnCard(fn))}
          </CardContent>
        </Card>
      )}

      {utilityFns.length > 0 && (
        <Card sx={{ ...cardSx, mb: 2 }}>
          <CardContent>
            <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1.5 }}>{tr('configuration.utilityFunctions')}</Typography>
            {utilityFns.map(fn => renderFnCard(fn))}
          </CardContent>
        </Card>
      )}
    </>
  );

  // ── MDM Roles config ──
  const renderRoles = () => {
    if (mdmRoles.length === 0) {
      fetchRoles();
      return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
    }

    const hdrs: HeadersInit = { 'x-mdm-user': getCurrentUserEmail(), 'Content-Type': 'application/json' };

    const handleAddRole = async () => {
      if (!newRole.code || !newRole.label) return;
      const resp = await fetch('/api/admin/roles', { method: 'POST', headers: hdrs, body: JSON.stringify({ role_code: newRole.code, role_label: newRole.label, description: newRole.description || null, sort_order: newRole.sort_order }) });
      if (!resp.ok) { const e = await resp.json(); setSnack({ msg: e.error || tr('configuration.failed'), severity: 'error' }); return; }
      setAddingRole(false);
      setNewRole({ code: '', label: '', description: '', sort_order: 99 });
      fetchRoles();
      setSnack({ msg: tr('configuration.roleAdded'), severity: 'success' });
    };

    const handleUpdateRole = async (code: string) => {
      await fetch(`/api/admin/roles/${code}`, { method: 'PUT', headers: hdrs, body: JSON.stringify({ role_label: editRoleLabel, description: editRoleDesc, sort_order: editRoleOrder }) });
      setEditingRoleCode(null);
      fetchRoles();
      setSnack({ msg: tr('configuration.roleUpdated'), severity: 'success' });
    };

    const handleDeleteRole = async (code: string) => {
      if (!(await ask(tr('configuration.deleteRoleCode', { code })))) return;
      const resp = await fetch(`/api/admin/roles/${code}`, { method: 'DELETE', headers: hdrs });
      if (!resp.ok) { const e = await resp.json(); setSnack({ msg: e.error || tr('configuration.failed'), severity: 'error' }); return; }
      fetchRoles();
      setSnack({ msg: tr('configuration.roleDeleted'), severity: 'success' });
    };

    return (
      <Box>
        <Alert severity="info" sx={{ mb: 2 }} action={<Button size="small" onClick={() => goTo('security/data-masking')}>{tr('configuration.dataMasking')}</Button>}>{tr('configuration.piiRolesNote')}</Alert>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <Box>
            <Typography variant="h6" fontWeight={700}>{tr('configuration.mdmRoles')}</Typography>
            <Typography variant="body2" color="text.secondary">{tr('configuration.defineRolesUsedAcrossThe')}</Typography>
          </Box>
          <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={() => {
            setAddingRole(true);
            setNewRole({ code: '', label: '', description: '', sort_order: (mdmRoles.length + 1) * 10 });
          }}>{tr('configuration.addRole')}</Button>
        </Box>

        <Table size="small" sx={{ '& td, & th': { borderColor: isDark ? alpha('#fff', 0.06) : alpha('#000', 0.06), py: 0.75 } }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 600, width: 50 }}>{tr('configuration.order')}</TableCell>
              <TableCell sx={{ fontWeight: 600, width: 180 }}>{tr('configuration.code')}</TableCell>
              <TableCell sx={{ fontWeight: 600, width: 180 }}>{tr('configuration.label')}</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>{tr('configuration.description')}</TableCell>
              <TableCell sx={{ fontWeight: 600, width: 70 }} align="center">{tr('configuration.system')}</TableCell>
              <TableCell sx={{ fontWeight: 600, width: 100 }} align="center">{tr('configuration.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {mdmRoles.map(r => (
              <TableRow key={r.role_code} hover>
                <TableCell>
                  {editingRoleCode === r.role_code
                    ? <TextField size="small" type="number" value={editRoleOrder} onChange={e => setEditRoleOrder(+e.target.value)} sx={{ width: 60, '& input': { py: 0.5, fontSize: '0.8rem' } }} />
                    : <Typography variant="body2" sx={{ fontSize: '0.8rem' }}>{r.sort_order}</Typography>}
                </TableCell>
                <TableCell>
                  <Chip label={r.role_code} size="small" sx={{ fontSize: '0.7rem', height: 22, fontWeight: 600, fontFamily: 'monospace', bgcolor: alpha(accent, 0.1), color: accent }} />
                </TableCell>
                <TableCell>
                  {editingRoleCode === r.role_code
                    ? <TextField size="small" fullWidth value={editRoleLabel} onChange={e => setEditRoleLabel(e.target.value)} sx={{ '& input': { py: 0.5, fontSize: '0.8rem' } }} />
                    : <Typography variant="body2" fontWeight={600} sx={{ fontSize: '0.85rem' }}>{r.role_label}</Typography>}
                </TableCell>
                <TableCell>
                  {editingRoleCode === r.role_code
                    ? <TextField size="small" fullWidth value={editRoleDesc} onChange={e => setEditRoleDesc(e.target.value)} sx={{ '& input': { py: 0.5, fontSize: '0.8rem' } }} />
                    : <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.8rem' }}>{r.description || '—'}</Typography>}
                </TableCell>
                <TableCell align="center">
                  {r.is_system ? <Chip label={tr('configuration.system')} size="small" variant="outlined" sx={{ fontSize: '0.65rem', height: 20 }} /> : <Typography variant="body2" color="text.disabled">{tr('configuration.custom')}</Typography>}
                </TableCell>
                <TableCell align="center">
                  <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'center' }}>
                    {editingRoleCode === r.role_code ? (
                      <>
                        <Tooltip title={tr('configuration.save')}><IconButton size="small" onClick={() => handleUpdateRole(r.role_code)}><SaveIcon fontSize="small" sx={{ color: accent }} /></IconButton></Tooltip>
                        <Tooltip title={tr('configuration.cancel')}><IconButton size="small" onClick={() => setEditingRoleCode(null)}><RestoreIcon fontSize="small" /></IconButton></Tooltip>
                      </>
                    ) : (
                      <>
                        <Tooltip title={tr('configuration.edit')}><IconButton size="small" onClick={() => { setEditingRoleCode(r.role_code); setEditRoleLabel(r.role_label); setEditRoleDesc(r.description || ''); setEditRoleOrder(r.sort_order); }}><EditIcon fontSize="small" /></IconButton></Tooltip>
                        {!r.is_system && <Tooltip title={tr('configuration.delete')}><IconButton size="small" onClick={() => handleDeleteRole(r.role_code)}><DeleteIcon fontSize="small" color="error" /></IconButton></Tooltip>}
                      </>
                    )}
                  </Box>
                </TableCell>
              </TableRow>
            ))}
            {addingRole && (
              <TableRow>
                <TableCell>
                  <TextField size="small" type="number" value={newRole.sort_order} onChange={e => setNewRole(p => ({ ...p, sort_order: +e.target.value }))} sx={{ width: 60, '& input': { py: 0.5, fontSize: '0.8rem' } }} />
                </TableCell>
                <TableCell>
                  <TextField size="small" value={newRole.code} onChange={e => setNewRole(p => ({ ...p, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') }))}
                    placeholder="ROLE_CODE" sx={{ '& input': { py: 0.5, fontSize: '0.8rem', fontFamily: 'monospace' } }} />
                </TableCell>
                <TableCell>
                  <TextField size="small" fullWidth value={newRole.label} onChange={e => setNewRole(p => ({ ...p, label: e.target.value }))}
                    placeholder={tr('configuration.displayLabel')} sx={{ '& input': { py: 0.5, fontSize: '0.8rem' } }} />
                </TableCell>
                <TableCell>
                  <TextField size="small" fullWidth value={newRole.description} onChange={e => setNewRole(p => ({ ...p, description: e.target.value }))}
                    placeholder={tr('configuration.description')} sx={{ '& input': { py: 0.5, fontSize: '0.8rem' } }} />
                </TableCell>
                <TableCell align="center"><Typography variant="body2" color="text.disabled">{tr('configuration.custom')}</Typography></TableCell>
                <TableCell align="center">
                  <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'center' }}>
                    <Tooltip title={tr('configuration.save')}><IconButton size="small" onClick={handleAddRole} disabled={!newRole.code || !newRole.label}><SaveIcon fontSize="small" sx={{ color: accent }} /></IconButton></Tooltip>
                    <Tooltip title={tr('configuration.cancel')}><IconButton size="small" onClick={() => setAddingRole(false)}><RestoreIcon fontSize="small" /></IconButton></Tooltip>
                  </Box>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Box>
    );
  };

  // ── hierarchy config ──
  type HierarchyForm = {
    enabled: boolean; root_label: string; max_depth: number | null;
    max_parents: number; allow_root: boolean; prevent_circular: boolean;
    change_mode: 'immediate' | 'workflow';
  };
  const [hierForm, setHierForm] = useState<HierarchyForm | null>(null);
  const [hierFormModId, setHierFormModId] = useState<string | null>(null);
  const [hierSaving, setHierSaving] = useState(false);

  const initHierForm = (modId: string) => {
    const brandMod = brand.modules?.find(m => m.id === modId);
    const h = brandMod?.hierarchy;
    const form: HierarchyForm = {
      enabled: h?.enabled ?? false,
      root_label: h?.root_label || '',
      max_depth: h?.max_depth ?? null,
      max_parents: h?.max_parents ?? 1,
      allow_root: h?.allow_root ?? true,
      prevent_circular: h?.prevent_circular ?? true,
      change_mode: h?.change_mode ?? 'workflow',
    };
    setHierForm(form);
    setHierFormModId(modId);
  };

  const saveHierarchy = async (modId: string) => {
    if (!hierForm) return;
    setHierSaving(true);
    try {
      const hdrs: HeadersInit = { 'x-mdm-user': getCurrentUserEmail(), 'Content-Type': 'application/json' };
      const resp = await fetch(`/api/admin/modules/${modId}/hierarchy`, {
        method: 'PUT', headers: hdrs, body: JSON.stringify(hierForm),
      });
      if (!resp.ok) { const e = await resp.json(); setSnack({ msg: e.error || tr('configuration.failedToSave'), severity: 'error' }); }
      else { setSnack({ msg: tr('configuration.hierarchyConfigurationSaved'), severity: 'success' }); }
    } catch (e: any) { setSnack({ msg: e.message, severity: 'error' }); }
    setHierSaving(false);
  };

  const renderModuleHierarchy = (mod: ModuleInfo) => {
    const brandMod = brand.modules?.find(m => m.id === mod.id);
    const hCfg = brandMod?.hierarchy;
    const isCategory = hCfg?.type === 'category';
    const hierarchyModel = isCategory ? tr('configuration.categoryTree') : 'Corporate hierarchy';
    const relationship = isCategory ? `Category (${hCfg?.parent_field || 'category_id'})` : `Parent ${mod.singular.toLowerCase()} (${hCfg?.parent_field || 'parent_id'})`;

    // Init form on first render or module change
    if (!hierForm || hierFormModId !== mod.id) {
      setTimeout(() => initHierForm(mod.id), 0);
      return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
    }

    const f = hierForm;
    const upd = (patch: Partial<HierarchyForm>) => setHierForm(prev => prev ? { ...prev, ...patch } : prev);

    return (
      <Box sx={{ maxWidth: 600 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
          <Typography variant="h6" fontWeight={700}>{tr('configuration.hierarchyLabel', { label: mod.label })}</Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button size="small" variant="outlined" startIcon={<RestoreIcon />} onClick={() => initHierForm(mod.id)}
              sx={{ textTransform: 'none' }}>{tr('configuration.reset')}</Button>
            <Button size="small" variant="contained" startIcon={<SaveIcon />} disabled={hierSaving}
              onClick={() => saveHierarchy(mod.id)} sx={{ textTransform: 'none' }}>{tr('configuration.save')}</Button>
          </Box>
        </Box>

        {/* Status */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3 }}>
          <Typography variant="body2" fontWeight={600} sx={{ minWidth: 120, color: 'text.secondary' }}>{tr('configuration.status')}</Typography>
          <Switch checked={f.enabled} onChange={e => upd({ enabled: e.target.checked })} size="small" />
          <Chip
            icon={<CheckCircleIcon sx={{ fontSize: 16 }} />}
            label={f.enabled ? tr('configuration.enabled') : 'Disabled'}
            size="small"
            color={f.enabled ? 'success' : 'default'}
            variant="outlined"
          />
        </Box>

        <Divider sx={{ mb: 3 }} />

        {/* Hierarchy model (read-only — structural) */}
        <Box sx={{ mb: 3 }}>
          <Typography variant="body2" fontWeight={600} sx={{ mb: 1, color: 'text.secondary' }}>{tr('configuration.hierarchyModel')}</Typography>
          <TextField size="small" fullWidth value={hierarchyModel} InputProps={{ readOnly: true }}
            sx={{ '& input': { fontSize: '0.85rem', color: 'text.disabled' } }} />
        </Box>

        {/* Relationship (read-only — structural) */}
        <Box sx={{ mb: 3 }}>
          <Typography variant="body2" fontWeight={600} sx={{ mb: 1, color: 'text.secondary' }}>{tr('configuration.relationship')}</Typography>
          <TextField size="small" fullWidth value={relationship} InputProps={{ readOnly: true }}
            sx={{ '& input': { fontSize: '0.85rem', color: 'text.disabled' } }} />
        </Box>

        {/* Root label (editable) */}
        <Box sx={{ mb: 3 }}>
          <Typography variant="body2" fontWeight={600} sx={{ mb: 1, color: 'text.secondary' }}>{tr('configuration.rootLabel')}</Typography>
          <TextField size="small" fullWidth value={f.root_label} onChange={e => upd({ root_label: e.target.value })}
            placeholder={tr('configuration.allOf', { entity: mod.label })} sx={{ '& input': { fontSize: '0.85rem' } }} />
        </Box>

        {isCategory && hCfg?.category_table && (
          <Box sx={{ mb: 3 }}>
            <Typography variant="body2" fontWeight={600} sx={{ mb: 1, color: 'text.secondary' }}>{tr('configuration.categoryTable')}</Typography>
            <TextField size="small" fullWidth value={hCfg.category_table} InputProps={{ readOnly: true }}
              sx={{ '& input': { fontSize: '0.85rem', fontFamily: 'monospace', color: 'text.disabled' } }} />
          </Box>
        )}

        <Divider sx={{ mb: 3 }} />

        {/* Behavior */}
        <Box sx={{ mb: 3 }}>
          <Typography variant="body2" fontWeight={600} sx={{ mb: 1.5, color: 'text.secondary' }}>{tr('configuration.behavior')}</Typography>
          <FormControlLabel
            control={<Checkbox checked={f.allow_root} onChange={e => upd({ allow_root: e.target.checked })} size="small" />}
            label={<Typography variant="body2">{tr('configuration.allowRoot', { entity: mod.label.toLowerCase() })}</Typography>}
            sx={{ mb: 0.5, ml: 0 }} />
          <FormControlLabel
            control={<Checkbox checked={f.prevent_circular} onChange={e => upd({ prevent_circular: e.target.checked })} size="small" />}
            label={<Typography variant="body2">{tr('configuration.preventCircularRelationships')}</Typography>}
            sx={{ mb: 0.5, ml: 0 }} />
        </Box>

        {/* Maximum parents */}
        <Box sx={{ mb: 3 }}>
          <Typography variant="body2" fontWeight={600} sx={{ mb: 1, color: 'text.secondary' }}>{tr('configuration.maximumParents')}</Typography>
          <TextField size="small" type="number" value={f.max_parents}
            onChange={e => upd({ max_parents: Math.max(1, parseInt(e.target.value) || 1) })}
            inputProps={{ min: 1 }} sx={{ width: 100, '& input': { fontSize: '0.85rem' } }} />
        </Box>

        {/* Maximum depth */}
        <Box sx={{ mb: 3 }}>
          <Typography variant="body2" fontWeight={600} sx={{ mb: 1, color: 'text.secondary' }}>{tr('configuration.maximumDepth')}</Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <TextField size="small" type="number" value={f.max_depth ?? ''}
              onChange={e => upd({ max_depth: e.target.value ? parseInt(e.target.value) || null : null })}
              placeholder={tr('configuration.unlimited')} inputProps={{ min: 1 }}
              sx={{ width: 140, '& input': { fontSize: '0.85rem' } }} />
            <Typography variant="caption" color="text.secondary">{tr('configuration.leaveEmptyForUnlimited')}</Typography>
          </Box>
        </Box>

        <Divider sx={{ mb: 3 }} />

        {/* Changes */}
        <Box sx={{ mb: 2 }}>
          <Typography variant="body2" fontWeight={600} sx={{ mb: 1.5, color: 'text.secondary' }}>{tr('configuration.changes')}</Typography>
          <RadioGroup value={f.change_mode} onChange={e => upd({ change_mode: e.target.value as 'immediate' | 'workflow' })}>
            <FormControlLabel value="immediate" control={<Radio size="small" />} label={<Typography variant="body2">{tr('configuration.applyImmediately')}</Typography>} sx={{ ml: 0 }} />
            <FormControlLabel value="workflow" control={<Radio size="small" />} label={<Typography variant="body2">{tr('configuration.requireWorkflowApproval')}</Typography>} sx={{ ml: 0 }} />
          </RadioGroup>
        </Box>
      </Box>
    );
  };

  // ── matching / dedup config ──
  const renderModuleMatching = (mod: ModuleInfo) => {
    const matchCfg = (brand.modules.find(m => m.id === mod.id)?.matching) ?? { enabled: false, fields: [], methods: {} };
    const methods = matchCfg.methods ?? {};
    const hdrs: HeadersInit = { 'x-mdm-user': getCurrentUserEmail(), 'Content-Type': 'application/json' };

    const updateMethod = async (methodName: string, updates: Record<string, unknown>) => {
      try {
        await fetch(`/api/admin/modules/${mod.id}/matching`, { method: 'PUT', headers: hdrs, body: JSON.stringify({ methods: { [methodName]: updates } }) });
        setSnack({ msg: `${methodName} updated`, severity: 'success' });
        const isNumericOnly = Object.values(updates).every(v => typeof v === 'number');
        if (!isNumericOnly) window.location.reload();
      } catch { setSnack({ msg: tr('configuration.updateFailed'), severity: 'error' }); }
    };

    const methodDefs: { key: string; label: string; desc: string; color: string; params?: { key: string; label: string; type: 'number' | 'chips' | 'rules' }[] }[] = [
      { key: 'exact_keys', label: tr('configuration.exactKeyBlocking'), desc: tr('configuration.deterministicMatchOnUniqueIdentifiers'), color: statusColors().success,
        params: [{ key: 'keys', label: tr('configuration.keyFields'), type: 'chips' }] },
      { key: 'fuzzy', label: tr('configuration.fuzzyPgTrgm'), desc: tr('configuration.trigramBasedNameSimilarityIn'), color: statusColors().success,
        params: [{ key: 'threshold', label: tr('configuration.minSimilarity01'), type: 'number' }] },
      { key: 'phonetic', label: tr('configuration.phoneticDoubleMetaphone'), desc: tr('configuration.catchesSpellingVariationsThatSound'), color: seriesColor(5),
        params: [{ key: 'fields', label: tr('configuration.fieldsToCompare'), type: 'chips' }] },
      { key: 'composite', label: tr('configuration.compositeRules'), desc: tr('configuration.weightedMultiFieldScoringWith'), color: statusColors().warning,
        params: [{ key: 'threshold', label: tr('configuration.minScore0100'), type: 'number' }, { key: 'rules', label: tr('configuration.scoringRules'), type: 'rules' }] },
      { key: 'address', label: tr('configuration.addressNormalization'), desc: tr('configuration.llmNormalizedAddressComparisonUsing'), color: statusColors().info,
        params: [{ key: 'fields', label: tr('configuration.addressFields'), type: 'chips' }] },
      { key: 'embedding', label: tr('configuration.embeddingSimilarity'), desc: tr('configuration.semanticVectorMatchingViaCortex'), color: statusColors().info,
        params: [{ key: 'threshold', label: tr('configuration.minCosineSimilarity01'), type: 'number' }] },
      { key: 'llm_judge', label: tr('configuration.llmJudge'), desc: tr('configuration.cortexCompleteEvaluatesCandidatesWith'), color: seriesColor(1) },
    ];

    return (
      <Box>
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 2 }}>{tr('configuration.matchingMethods')}</Typography>
        <Typography variant="body2" sx={{ color: theme.palette.text.secondary, mb: 3 }}>
          {tr('configuration.enableOrDisableMatchingTechniques')}
        </Typography>

        {methodDefs.map(md => {
          const cfg = (methods as Record<string, Record<string, unknown>>)[md.key] ?? {};
          const isEnabled = cfg.enabled !== false && cfg.enabled !== undefined;
          return (
            <Card key={md.key} sx={{ mb: 2, borderLeft: `3px solid ${isEnabled ? md.color : alpha(md.color, 0.3)}`, opacity: isEnabled ? 1 : 0.6 }}>
              <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Chip label={md.label} size="small" sx={{ bgcolor: alpha(md.color, 0.15), color: md.color, fontWeight: 600, fontSize: '0.75rem' }} />
                    {md.key === 'exact_keys' && <Chip label={tr('configuration.deterministic')} size="small" variant="outlined" sx={{ fontSize: '0.6rem', height: 18 }} />}
                    {(md.key === 'embedding' || md.key === 'llm_judge') && <Chip label="AI" size="small" variant="outlined" sx={{ fontSize: '0.6rem', height: 18, color: seriesColor(1), borderColor: seriesColor(1) }} />}
                    {md.key === 'address' && <Chip label={tr('configuration.cortex')} size="small" variant="outlined" sx={{ fontSize: '0.6rem', height: 18, color: statusColors().info, borderColor: statusColors().info }} />}
                  </Box>
                  <Switch
                    checked={isEnabled}
                    onChange={() => updateMethod(md.key, { enabled: !isEnabled })}
                    size="small"
                    sx={{ '& .MuiSwitch-switchBase.Mui-checked': { color: md.color }, '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { backgroundColor: md.color } }}
                  />
                </Box>
                <Typography variant="caption" sx={{ color: theme.palette.text.secondary, display: 'block', mb: 1 }}>{md.desc}</Typography>
                {isEnabled && md.params && (
                  <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                    {md.params.map(p => {
                      const val = cfg[p.key];
                      if (p.type === 'chips' && Array.isArray(val)) {
                        const current = val as string[];
                        const modCfg = brand.modules.find(m => m.id === mod.id);
                        const allFields = modCfg?.fields?.map(f => f.name) ?? [];
                        const available = allFields.filter(f => !current.includes(f));
                        const removeField = (field: string) => {
                          const updated = current.filter(f => f !== field);
                          updateMethod(md.key, { [p.key]: updated });
                        };
                        const addField = (field: string) => {
                          updateMethod(md.key, { [p.key]: [...current, field] });
                        };
                        return (
                          <Box key={p.key}>
                            <Typography variant="caption" sx={{ color: theme.palette.text.secondary, fontSize: '0.65rem' }}>{p.label}</Typography>
                            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 0.5, alignItems: 'center' }}>
                              {current.map(v => (
                                <Chip key={v} label={v} size="small" variant="outlined"
                                  onDelete={() => removeField(v)}
                                  sx={{ fontSize: '0.65rem', height: 22 }} />
                              ))}
                              {available.length > 0 && (
                                <Autocomplete
                                  size="small"
                                  options={available}
                                  onChange={(_e, v) => { if (v) addField(v); }}
                                  value={null as unknown as string} /* cleared after each pick */
                                  renderInput={(params) => (
                                    <TextField {...params} placeholder={tr('configuration.add')} variant="outlined"
                                      sx={{ '& .MuiOutlinedInput-root': { fontSize: '0.7rem', py: '1px', px: '6px', minHeight: 24 }, width: 120 }} />
                                  )}
                                  disableClearable
                                  blurOnSelect
                                  sx={{ display: 'inline-flex' }}
                                />
                              )}
                            </Box>
                          </Box>
                        );
                      }
                      if (p.type === 'number') {
                        return (
                          <Box key={p.key}>
                            <Typography variant="caption" sx={{ color: theme.palette.text.secondary, fontSize: '0.65rem' }}>{p.label}</Typography>
                            <TextField
                              size="small"
                              type="number"
                              defaultValue={val ?? ''}
                              inputProps={{ step: p.key === 'threshold' && (val as number) <= 1 ? 0.05 : 5, style: { fontSize: '0.8rem', fontWeight: 600, padding: '4px 8px', width: 70 } }}
                              onBlur={(e) => {
                                const v = parseFloat(e.target.value);
                                if (!isNaN(v) && v !== val) updateMethod(md.key, { [p.key]: v });
                              }}
                              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                              sx={{ mt: 0.5, ml: 1 }}
                            />
                          </Box>
                        );
                      }
                      if (p.type === 'rules' && Array.isArray(val)) {
                        const rules = val as { field: string; weight: number; compare: string; min_sim?: number }[];
                        const modCfg = brand.modules.find(m => m.id === mod.id);
                        const allFields = modCfg?.fields?.map(f => f.name) ?? [];
                        const usedFields = rules.map(r => r.field);
                        const available = allFields.filter(f => !usedFields.includes(f));
                        const removeRule = (field: string) => {
                          updateMethod(md.key, { [p.key]: rules.filter(r => r.field !== field) });
                        };
                        const addRule = (field: string) => {
                          updateMethod(md.key, { [p.key]: [...rules, { field, weight: 0.1, compare: 'exact' }] });
                        };
                        const updateRule = (field: string, updates: Record<string, unknown>) => {
                          updateMethod(md.key, { [p.key]: rules.map(r => r.field === field ? { ...r, ...updates } : r) });
                        };
                        return (
                          <Box key={p.key} sx={{ width: '100%', mt: 1 }}>
                            <Typography variant="caption" sx={{ color: theme.palette.text.secondary, fontSize: '0.65rem', mb: 0.5, display: 'block' }}>{p.label}</Typography>
                            <Table size="small" sx={{ '& td, & th': { py: 0.3, px: 1, fontSize: '0.7rem', border: 'none' } }}>
                              <TableHead>
                                <TableRow sx={{ '& th': { color: theme.palette.text.secondary, fontWeight: 600, fontSize: '0.6rem' } }}>
                                  <TableCell>{tr('configuration.field')}</TableCell>
                                  <TableCell>{tr('configuration.weight')}</TableCell>
                                  <TableCell>{tr('configuration.compare')}</TableCell>
                                  <TableCell>{tr('configuration.minSim')}</TableCell>
                                  <TableCell width={32}></TableCell>
                                </TableRow>
                              </TableHead>
                              <TableBody>
                                {rules.map(r => (
                                  <TableRow key={r.field}>
                                    <TableCell sx={{ fontWeight: 600 }}>{r.field}</TableCell>
                                    <TableCell>
                                      <TextField size="small" type="number" defaultValue={r.weight}
                                        inputProps={{ step: 0.05, min: 0, max: 1, style: { fontSize: '0.75rem', fontWeight: 600, padding: '2px 6px', width: 50 } }}
                                        onBlur={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v) && v !== r.weight) updateRule(r.field, { weight: v }); }}
                                        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                                        variant="standard"
                                      />
                                    </TableCell>
                                    <TableCell>
                                      <Select size="small" value={r.compare} variant="standard"
                                        onChange={(e) => updateRule(r.field, { compare: e.target.value })}
                                        sx={{ fontSize: '0.7rem', minWidth: 70 }}>
                                        <MenuItem value="exact" sx={{ fontSize: '0.75rem' }}>exact</MenuItem>
                                        <MenuItem value="trigram" sx={{ fontSize: '0.75rem' }}>trigram</MenuItem>
                                      </Select>
                                    </TableCell>
                                    <TableCell>
                                      {r.compare === 'trigram' ? (
                                        <TextField size="small" type="number" defaultValue={r.min_sim ?? 0.3}
                                          inputProps={{ step: 0.05, min: 0, max: 1, style: { fontSize: '0.75rem', padding: '2px 6px', width: 40 } }}
                                          onBlur={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v) && v !== (r.min_sim ?? 0.3)) updateRule(r.field, { min_sim: v }); }}
                                          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                                          variant="standard"
                                        />
                                      ) : <Typography variant="caption" sx={{ color: theme.palette.text.disabled }}>—</Typography>}
                                    </TableCell>
                                    <TableCell>
                                      <IconButton size="small" onClick={() => removeRule(r.field)}><DeleteIcon sx={{ fontSize: 14 }} color="error" /></IconButton>
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                            {available.length > 0 && (
                              <Autocomplete
                                size="small"
                                options={available}
                                onChange={(_e, v) => { if (v) addRule(v); }}
                                value={null as unknown as string} /* cleared after each pick */
                                renderInput={(params) => (
                                  <TextField {...params} placeholder={tr('configuration.addRule')} variant="outlined"
                                    sx={{ '& .MuiOutlinedInput-root': { fontSize: '0.7rem', py: '1px', px: '6px', minHeight: 24 }, width: 160, mt: 0.5 }} />
                                )}
                                disableClearable
                                blurOnSelect
                                sx={{ display: 'inline-flex' }}
                              />
                            )}
                          </Box>
                        );
                      }
                      return null;
                    })}
                  </Box>
                )}
              </CardContent>
            </Card>
          );
        })}
      </Box>
    );
  };

  // ── workflow / lifecycle config ──
  const renderModuleWorkflows = (mod: ModuleInfo) => {
    const entityType = mod.id.toUpperCase();
    const lc = lifecycleData[entityType];

    // Fetch lifecycle data on first render for this entity
    if (!lc) {
      fetchLifecycle(entityType);
      return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
    }
    // Also ensure roles are loaded for the dropdown
    if (mdmRoles.length === 0) fetchRoles();

    const { stages, transitions } = lc;
    const hdrs: HeadersInit = { 'x-mdm-user': getCurrentUserEmail(), 'Content-Type': 'application/json' };

    const handleAddStage = async () => {
      if (!newStage.code || !newStage.label) return;
      await fetch(`/api/admin/lifecycle/${entityType}/stages`, { method: 'POST', headers: hdrs, body: JSON.stringify({ stage_code: newStage.code, stage_label: newStage.label, sort_order: newStage.sort_order, is_terminal: newStage.is_terminal, description: newStage.description }) });
      setAddingStage(false);
      setNewStage({ code: '', label: '', sort_order: 99, is_terminal: false, description: '' });
      fetchLifecycle(entityType);
      setSnack({ msg: tr('configuration.stageAdded'), severity: 'success' });
    };

    const handleUpdateStage = async (id: number) => {
      await fetch(`/api/admin/lifecycle/${entityType}/stages/${id}`, { method: 'PUT', headers: hdrs, body: JSON.stringify({ stage_label: editStageLabel, sort_order: editStageOrder, is_terminal: editStageTerminal, description: editStageDesc }) });
      setEditingStageId(null);
      fetchLifecycle(entityType);
      setSnack({ msg: tr('configuration.stageUpdated'), severity: 'success' });
    };

    const handleDeleteStage = async (id: number, code: string) => {
      if (!(await ask(tr('configuration.deleteStageCodeThisWill', { code })))) return;
      await fetch(`/api/admin/lifecycle/${entityType}/stages/${id}`, { method: 'DELETE', headers: hdrs });
      fetchLifecycle(entityType);
      setSnack({ msg: tr('configuration.stageDeleted'), severity: 'success' });
    };

    const handleAddTransition = async () => {
      if (!newTransition.from || !newTransition.to) return;
      await fetch(`/api/admin/lifecycle/${entityType}/transitions`, { method: 'POST', headers: hdrs, body: JSON.stringify({ from_stage_code: newTransition.from, to_stage_code: newTransition.to, required_role: newTransition.role || null }) });
      setAddingTransition(false);
      setNewTransition({ from: '', to: '', role: '' });
      fetchLifecycle(entityType);
      setSnack({ msg: tr('configuration.transitionAdded'), severity: 'success' });
    };

    const handleDeleteTransition = async (id: number) => {
      await fetch(`/api/admin/lifecycle/${entityType}/transitions/${id}`, { method: 'DELETE', headers: hdrs });
      fetchLifecycle(entityType);
      setSnack({ msg: tr('configuration.transitionRemoved'), severity: 'success' });
    };

    const getStageColor = (code: string) => (code in STAGE_COLORS ? STAGE_COLORS[code] : accent);

    return (
      <Box>
        {/* ── Visual flow ── */}
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 2 }}>{tr('configuration.lifecycleFlow')}</Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, mb: 4, px: 1 }}>
          {stages.map((s, i) => (
            <Box key={s.id} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Chip
                label={s.stage_label}
                icon={s.is_terminal ? <FlagIcon /> : undefined}
                sx={{
                  bgcolor: alpha(getStageColor(s.stage_code), 0.15),
                  color: getStageColor(s.stage_code),
                  fontWeight: 600, fontSize: '0.8rem',
                  border: `1px solid ${alpha(getStageColor(s.stage_code), 0.3)}`,
                }}
              />
              {i < stages.length - 1 && <ArrowForwardIcon sx={{ color: 'text.disabled', fontSize: 18 }} />}
            </Box>
          ))}
        </Box>

        {/* ── Stages table ── */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
          <Typography variant="subtitle2" fontWeight={700}>{tr('configuration.stages')}</Typography>
          <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={() => {
            setAddingStage(true);
            setNewStage({ code: '', label: '', sort_order: (stages.length + 1) * 10, is_terminal: false, description: '' });
          }}>{tr('configuration.addStage')}</Button>
        </Box>
        <Table size="small" sx={{ '& td, & th': { borderColor: isDark ? alpha('#fff', 0.06) : alpha('#000', 0.06), py: 0.5 }, mb: 4 }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 600, width: 50 }}>{tr('configuration.order')}</TableCell>
              <TableCell sx={{ fontWeight: 600, width: 110 }}>{tr('configuration.code')}</TableCell>
              <TableCell sx={{ fontWeight: 600, width: 110 }}>{tr('configuration.label')}</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>{tr('configuration.description')}</TableCell>
              <TableCell sx={{ fontWeight: 600, width: 80 }} align="center">{tr('configuration.terminal')}</TableCell>
              <TableCell sx={{ fontWeight: 600, width: 100 }} align="center">{tr('configuration.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {stages.map(s => (
              <TableRow key={s.id} hover>
                <TableCell>
                  {editingStageId === s.id
                    ? <TextField size="small" type="number" value={editStageOrder} onChange={e => setEditStageOrder(+e.target.value)} sx={{ width: 60, '& input': { py: 0.5, fontSize: '0.8rem' } }} />
                    : <Typography variant="body2" sx={{ fontSize: '0.8rem' }}>{s.sort_order}</Typography>}
                </TableCell>
                <TableCell>
                  <Chip label={s.stage_code} size="small"
                    sx={{ fontSize: '0.7rem', height: 22, bgcolor: alpha(getStageColor(s.stage_code), 0.15), color: getStageColor(s.stage_code), fontWeight: 600 }} />
                </TableCell>
                <TableCell>
                  {editingStageId === s.id
                    ? <TextField size="small" fullWidth value={editStageLabel} onChange={e => setEditStageLabel(e.target.value)} sx={{ '& input': { py: 0.5, fontSize: '0.8rem' } }} />
                    : <Typography variant="body2" sx={{ fontSize: '0.8rem' }}>{s.stage_label}</Typography>}
                </TableCell>
                <TableCell>
                  {editingStageId === s.id
                    ? <TextField size="small" fullWidth value={editStageDesc} onChange={e => setEditStageDesc(e.target.value)} placeholder={tr('configuration.stageDescription')} sx={{ '& input': { py: 0.5, fontSize: '0.8rem' } }} />
                    : s.description
                      ? <Tooltip title={s.description} placement="top-start"><Typography variant="body2" sx={{ fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{s.description}</Typography></Tooltip>
                      : <Typography variant="body2" sx={{ fontSize: '0.8rem', color: 'text.disabled' }}>—</Typography>}
                </TableCell>
                <TableCell align="center">
                  {editingStageId === s.id
                    ? <Switch size="small" checked={editStageTerminal} onChange={(_, v) => setEditStageTerminal(v)} />
                    : s.is_terminal ? <FlagIcon sx={{ fontSize: 16, color: 'text.secondary' }} /> : <Typography variant="body2" color="text.disabled">—</Typography>}
                </TableCell>
                <TableCell align="center">
                  <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'center' }}>
                    {editingStageId === s.id ? (
                      <>
                        <Tooltip title={tr('configuration.save')}><IconButton size="small" onClick={() => handleUpdateStage(s.id)}><SaveIcon fontSize="small" sx={{ color: accent }} /></IconButton></Tooltip>
                        <Tooltip title={tr('configuration.cancel')}><IconButton size="small" onClick={() => setEditingStageId(null)}><RestoreIcon fontSize="small" /></IconButton></Tooltip>
                      </>
                    ) : (
                      <>
                        <Tooltip title={tr('configuration.edit')}><IconButton size="small" onClick={() => { setEditingStageId(s.id); setEditStageLabel(s.stage_label); setEditStageOrder(s.sort_order); setEditStageTerminal(s.is_terminal); setEditStageDesc(s.description || ''); }}><EditIcon fontSize="small" /></IconButton></Tooltip>
                        <Tooltip title={tr('configuration.delete')}><IconButton size="small" onClick={() => handleDeleteStage(s.id, s.stage_code)}><DeleteIcon fontSize="small" color="error" /></IconButton></Tooltip>
                      </>
                    )}
                  </Box>
                </TableCell>
              </TableRow>
            ))}
            {addingStage && (
              <TableRow>
                <TableCell>
                  <TextField size="small" type="number" value={newStage.sort_order} onChange={e => setNewStage(p => ({ ...p, sort_order: +e.target.value }))} sx={{ width: 60, '& input': { py: 0.5, fontSize: '0.8rem' } }} />
                </TableCell>
                <TableCell>
                  <TextField size="small" value={newStage.code} onChange={e => setNewStage(p => ({ ...p, code: e.target.value.toUpperCase().replace(/[^A-Z_]/g, '') }))}
                    placeholder="STAGE_CODE" sx={{ '& input': { py: 0.5, fontSize: '0.8rem', fontFamily: 'monospace' } }} />
                </TableCell>
                <TableCell>
                  <TextField size="small" fullWidth value={newStage.label} onChange={e => setNewStage(p => ({ ...p, label: e.target.value }))}
                    placeholder={tr('configuration.displayLabel')} sx={{ '& input': { py: 0.5, fontSize: '0.8rem' } }} />
                </TableCell>
                <TableCell>
                  <TextField size="small" fullWidth value={newStage.description} onChange={e => setNewStage(p => ({ ...p, description: e.target.value }))}
                    placeholder={tr('configuration.stageDescription')} sx={{ '& input': { py: 0.5, fontSize: '0.8rem' } }} />
                </TableCell>
                <TableCell align="center">
                  <Switch size="small" checked={newStage.is_terminal} onChange={(_, v) => setNewStage(p => ({ ...p, is_terminal: v }))} />
                </TableCell>
                <TableCell align="center">
                  <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'center' }}>
                    <Tooltip title={tr('configuration.save')}><IconButton size="small" onClick={handleAddStage} disabled={!newStage.code || !newStage.label}><SaveIcon fontSize="small" sx={{ color: accent }} /></IconButton></Tooltip>
                    <Tooltip title={tr('configuration.cancel')}><IconButton size="small" onClick={() => setAddingStage(false)}><RestoreIcon fontSize="small" /></IconButton></Tooltip>
                  </Box>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        {/* ── Transitions table ── */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
          <Typography variant="subtitle2" fontWeight={700}>{tr('configuration.transitions')}</Typography>
          <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={() => {
            setAddingTransition(true);
            setNewTransition({ from: '', to: '', role: '' });
          }}>{tr('configuration.addTransition')}</Button>
        </Box>
        <Table size="small" sx={{ '& td, & th': { borderColor: isDark ? alpha('#fff', 0.06) : alpha('#000', 0.06), py: 0.5 } }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 600 }}>{tr('configuration.from')}</TableCell>
              <TableCell sx={{ fontWeight: 600, width: 40 }} align="center" />
              <TableCell sx={{ fontWeight: 600 }}>{tr('configuration.to')}</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>{tr('configuration.requiredRole')}</TableCell>
              <TableCell sx={{ fontWeight: 600, width: 60 }} align="center">{tr('configuration.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {transitions.map(t => (
              <TableRow key={t.id} hover>
                <TableCell>
                  <Chip label={t.from_stage_code} size="small"
                    sx={{ fontSize: '0.7rem', height: 22, bgcolor: alpha(getStageColor(t.from_stage_code), 0.15), color: getStageColor(t.from_stage_code), fontWeight: 600 }} />
                </TableCell>
                <TableCell align="center"><ArrowForwardIcon sx={{ fontSize: 16, color: 'text.disabled' }} /></TableCell>
                <TableCell>
                  <Chip label={t.to_stage_code} size="small"
                    sx={{ fontSize: '0.7rem', height: 22, bgcolor: alpha(getStageColor(t.to_stage_code), 0.15), color: getStageColor(t.to_stage_code), fontWeight: 600 }} />
                </TableCell>
                <TableCell>
                  <TextField select size="small" value={t.required_role || ''}
                    onChange={async (e) => {
                      const val = e.target.value;
                      await fetch(`/api/admin/lifecycle/${entityType}/transitions/${t.id}`, {
                        method: 'PUT', headers: hdrs, body: JSON.stringify({ required_role: val || null })
                      });
                      fetchLifecycle(entityType);
                    }}
                    sx={{ minWidth: 160, '& .MuiSelect-select': { fontSize: '0.8rem', py: 0.5, fontFamily: 'monospace' } }}
                    SelectProps={{ displayEmpty: true }}>
                    <MenuItem value="" sx={{ fontSize: '0.8rem', color: 'text.secondary' }}><em>{tr('configuration.none')}</em></MenuItem>
                    {mdmRoles.map(r => <MenuItem key={r.role_code} value={r.role_code} sx={{ fontSize: '0.8rem' }}>{r.role_label}</MenuItem>)}
                  </TextField>
                </TableCell>
                <TableCell align="center">
                  <Tooltip title={tr('configuration.remove')}><IconButton size="small" onClick={() => handleDeleteTransition(t.id)}><DeleteIcon fontSize="small" color="error" /></IconButton></Tooltip>
                </TableCell>
              </TableRow>
            ))}
            {addingTransition && (
              <TableRow>
                <TableCell>
                  <TextField select size="small" value={newTransition.from} onChange={e => setNewTransition(p => ({ ...p, from: e.target.value }))}
                    sx={{ minWidth: 130, '& .MuiSelect-select': { fontSize: '0.8rem', py: 0.5 } }}>
                    {stages.map(s => <MenuItem key={s.stage_code} value={s.stage_code} sx={{ fontSize: '0.8rem' }}>{s.stage_label}</MenuItem>)}
                  </TextField>
                </TableCell>
                <TableCell align="center"><ArrowForwardIcon sx={{ fontSize: 16, color: 'text.disabled' }} /></TableCell>
                <TableCell>
                  <TextField select size="small" value={newTransition.to} onChange={e => setNewTransition(p => ({ ...p, to: e.target.value }))}
                    sx={{ minWidth: 130, '& .MuiSelect-select': { fontSize: '0.8rem', py: 0.5 } }}>
                    {stages.map(s => <MenuItem key={s.stage_code} value={s.stage_code} sx={{ fontSize: '0.8rem' }}>{s.stage_label}</MenuItem>)}
                  </TextField>
                </TableCell>
                <TableCell>
                  <TextField select size="small" value={newTransition.role} onChange={e => setNewTransition(p => ({ ...p, role: e.target.value }))}
                    sx={{ minWidth: 160, '& .MuiSelect-select': { fontSize: '0.8rem', py: 0.5, fontFamily: 'monospace' } }}
                    SelectProps={{ displayEmpty: true }}>
                    <MenuItem value="" sx={{ fontSize: '0.8rem', color: 'text.secondary' }}><em>{tr('configuration.noneOptional')}</em></MenuItem>
                    {mdmRoles.map(r => <MenuItem key={r.role_code} value={r.role_code} sx={{ fontSize: '0.8rem' }}>{r.role_label}</MenuItem>)}
                  </TextField>
                </TableCell>
                <TableCell align="center">
                  <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'center' }}>
                    <Tooltip title={tr('configuration.save')}><IconButton size="small" onClick={handleAddTransition} disabled={!newTransition.from || !newTransition.to}><SaveIcon fontSize="small" sx={{ color: accent }} /></IconButton></Tooltip>
                    <Tooltip title={tr('configuration.cancel')}><IconButton size="small" onClick={() => setAddingTransition(false)}><RestoreIcon fontSize="small" /></IconButton></Tooltip>
                  </Box>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Box>
    );
  };

  // ── Users management ──
  const renderUsers = () => {
    if (mdmUsers.length === 0) {
      fetchUsers();
      if (mdmRoles.length === 0) fetchRoles();
      return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
    }
    if (mdmRoles.length === 0) fetchRoles();

    const hdrs: HeadersInit = { 'x-mdm-user': getCurrentUserEmail(), 'Content-Type': 'application/json' };
    const roleColors: Record<string, string> = { ADMIN: statusColors().error, STEWARD: statusColors().info, VIEWER: statusColors().success };

    const parseScope = (s: string): string[] | null => {
      const trimmed = s.trim();
      if (!trimmed) return null;
      return trimmed.split(',').map(c => c.trim().toUpperCase()).filter(Boolean);
    };

    const handleAddUser = async () => {
      if (!newUser.email || !newUser.display_name) return;
      const body = {
        email: newUser.email,
        display_name: newUser.display_name,
        role: newUser.role,
        country_scope: parseScope(newUser.country_scope),
        mdm_roles: newUser.mdm_roles,
        sf_user: newUser.sf_user.trim() || null,
      };
      const resp = await fetch('/api/auth/users', { method: 'POST', headers: hdrs, body: JSON.stringify(body) });
      if (!resp.ok) { const e = await resp.json(); setSnack({ msg: e.error || tr('configuration.failedToCreateUser'), severity: 'error' }); return; }
      setAddingUser(false);
      setNewUser({ email: '', display_name: '', role: 'VIEWER', country_scope: '', mdm_roles: [], sf_user: '' });
      fetchUsers();
      setSnack({ msg: tr('configuration.userCreated'), severity: 'success' });
    };

    const handleUpdateUser = async (email: string) => {
      const body = {
        display_name: editUserForm.display_name,
        role: editUserForm.role,
        country_scope: parseScope(editUserForm.country_scope),
        mdm_roles: editUserForm.mdm_roles,
        is_active: editUserForm.is_active,
        sf_user: editUserForm.sf_user.trim() || null,
      };
      const resp = await fetch(`/api/auth/users/${encodeURIComponent(email)}`, { method: 'PUT', headers: hdrs, body: JSON.stringify(body) });
      if (!resp.ok) { const e = await resp.json(); setSnack({ msg: e.error || tr('configuration.failed'), severity: 'error' }); return; }
      setEditingUserEmail(null);
      fetchUsers();
      setSnack({ msg: tr('configuration.userUpdated'), severity: 'success' });
    };

    const handleDeactivate = async (email: string) => {
      if (!(await ask(tr('configuration.deactivateUserEmailTheyWill', { email })))) return;
      const resp = await fetch(`/api/auth/users/${encodeURIComponent(email)}`, { method: 'DELETE', headers: hdrs });
      if (!resp.ok) { const e = await resp.json(); setSnack({ msg: e.error || tr('configuration.failed'), severity: 'error' }); return; }
      fetchUsers();
      setSnack({ msg: tr('configuration.userDeactivated'), severity: 'info' });
    };

    const handleReactivate = async (email: string) => {
      const resp = await fetch(`/api/auth/users/${encodeURIComponent(email)}`, { method: 'PUT', headers: hdrs, body: JSON.stringify({ is_active: true }) });
      if (!resp.ok) return;
      fetchUsers();
      setSnack({ msg: tr('configuration.userReactivated'), severity: 'success' });
    };

    const startEdit = (u: MdmUser) => {
      setEditingUserEmail(u.email);
      setEditUserForm({
        display_name: u.display_name,
        role: u.role,
        country_scope: u.country_scope ? u.country_scope.join(', ') : '',
        mdm_roles: u.mdm_roles || [],
        is_active: u.is_active,
        sf_user: u.sf_user || '',
      });
    };

    const activeUsers = mdmUsers.filter(u => u.is_active);
    const inactiveUsers = mdmUsers.filter(u => !u.is_active);
    const availableRoles = mdmRoles.map(r => r.role_code);

    return (
      <Box>
        <Alert severity="info" sx={{ mb: 2 }} action={<Button size="small" onClick={() => goTo('security/data-masking')}>{tr('configuration.dataMasking')}</Button>}>{tr('configuration.piiUsersNote')}</Alert>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <Box>
            <Typography variant="h6" fontWeight={700}>{tr('configuration.users')}</Typography>
            <Typography variant="body2" color="text.secondary">
              {tr('configuration.activeUsers', { count: activeUsers.length })}{inactiveUsers.length > 0 ? tr('configuration.inactiveUsers', { count: inactiveUsers.length }) : ''}
            </Typography>
          </Box>
          <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={() => {
            setAddingUser(true);
            setNewUser({ email: '', display_name: '', role: 'VIEWER', country_scope: '', mdm_roles: [], sf_user: '' });
          }}>{tr('configuration.addUser')}</Button>
        </Box>

        <Table size="small" sx={{ '& td, & th': { borderColor: isDark ? alpha('#fff', 0.06) : alpha('#000', 0.06), py: 0.75 } }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 600, width: 200 }}>{tr('configuration.user')}</TableCell>
              <TableCell sx={{ fontWeight: 600, width: 90 }}>{tr('configuration.appRole')}</TableCell>
              <TableCell sx={{ fontWeight: 600, width: 150 }}>{tr('configuration.countryScope')}</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>{tr('configuration.mdmRoles')}</TableCell>
              <TableCell sx={{ fontWeight: 600, width: 70 }} align="center">{tr('configuration.status')}</TableCell>
              <TableCell sx={{ fontWeight: 600, width: 100 }} align="center">{tr('configuration.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {mdmUsers.map(u => {
              const isEditing = editingUserEmail === u.email;
              return (
                <TableRow key={u.email} hover sx={{ opacity: u.is_active ? 1 : 0.5 }}>
                  <TableCell>
                    {isEditing ? (
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                        <TextField size="small" fullWidth value={editUserForm.display_name} onChange={e => setEditUserForm(f => ({ ...f, display_name: e.target.value }))} sx={{ '& input': { py: 0.5, fontSize: '0.8rem' } }} />
                        <TextField size="small" fullWidth placeholder={tr('configuration.snowflakeUserLoginName')} value={editUserForm.sf_user} onChange={e => setEditUserForm(f => ({ ...f, sf_user: e.target.value }))} sx={{ '& input': { py: 0.5, fontSize: '0.75rem', fontFamily: 'monospace' } }} />
                      </Box>
                    ) : (
                      <Box>
                        <Typography variant="body2" fontWeight={600} sx={{ fontSize: '0.85rem' }}>{u.display_name}</Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>{u.email}</Typography>
                        {u.sf_user && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontSize: '0.65rem', fontFamily: 'monospace' }}>Snowflake: {u.sf_user}</Typography>}
                      </Box>
                    )}
                  </TableCell>
                  <TableCell>
                    {isEditing ? (
                      <Select size="small" value={editUserForm.role} onChange={e => setEditUserForm(f => ({ ...f, role: e.target.value }))} sx={{ fontSize: '0.8rem', '& .MuiSelect-select': { py: 0.5 } }}>
                        <MenuItem value="ADMIN">ADMIN</MenuItem>
                        <MenuItem value="STEWARD">STEWARD</MenuItem>
                        <MenuItem value="VIEWER">VIEWER</MenuItem>
                      </Select>
                    ) : (
                      <Chip label={u.role} size="small" sx={{ fontSize: '0.7rem', height: 22, fontWeight: 600, bgcolor: alpha(roleColors[u.role] || statusColors().neutral, 0.15), color: roleColors[u.role] || statusColors().neutral }} />
                    )}
                  </TableCell>
                  <TableCell>
                    {isEditing ? (
                      <TextField size="small" fullWidth value={editUserForm.country_scope} onChange={e => setEditUserForm(f => ({ ...f, country_scope: e.target.value }))} placeholder={tr('configuration.fraBelEmptyAll')} sx={{ '& input': { py: 0.5, fontSize: '0.8rem' } }} />
                    ) : (
                      u.country_scope ? (
                        <Box sx={{ display: 'flex', gap: 0.3, flexWrap: 'wrap' }}>
                          {u.country_scope.map(c => <Chip key={c} label={c} size="small" variant="outlined" sx={{ fontSize: '0.65rem', height: 20 }} />)}
                        </Box>
                      ) : (
                        <Typography variant="caption" color="text.secondary">{tr('configuration.allCountries')}</Typography>
                      )
                    )}
                  </TableCell>
                  <TableCell>
                    {isEditing ? (
                      <Select size="small" multiple value={editUserForm.mdm_roles}
                        onChange={e => setEditUserForm(f => ({ ...f, mdm_roles: typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value as string[] }))}
                        renderValue={(sel) => (sel as string[]).join(', ')}
                        sx={{ fontSize: '0.75rem', minWidth: 200, '& .MuiSelect-select': { py: 0.5 } }}>
                        {availableRoles.map(r => (
                          <MenuItem key={r} value={r}>
                            <Checkbox size="small" checked={editUserForm.mdm_roles.includes(r)} sx={{ py: 0 }} />
                            <Typography variant="body2" sx={{ fontSize: '0.8rem' }}>{r}</Typography>
                          </MenuItem>
                        ))}
                      </Select>
                    ) : (
                      <Box sx={{ display: 'flex', gap: 0.3, flexWrap: 'wrap' }}>
                        {(u.mdm_roles || []).length > 0
                          ? (u.mdm_roles || []).map(r => <Chip key={r} label={r} size="small" sx={{ fontSize: '0.6rem', height: 20, fontFamily: 'monospace', bgcolor: alpha(accent, 0.08), color: accent }} />)
                          : <Typography variant="caption" color="text.disabled">{tr('configuration.none')}</Typography>
                        }
                      </Box>
                    )}
                  </TableCell>
                  <TableCell align="center">
                    {u.is_active
                      ? <Chip label={tr('configuration.active')} size="small" sx={{ fontSize: '0.65rem', height: 20, bgcolor: alpha(statusColors().success, 0.15), color: statusColors().success }} />
                      : <Chip label={tr('configuration.inactive')} size="small" sx={{ fontSize: '0.65rem', height: 20, bgcolor: alpha(statusColors().error, 0.15), color: statusColors().error }} />
                    }
                  </TableCell>
                  <TableCell align="center">
                    <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'center' }}>
                      {isEditing ? (
                        <>
                          <Tooltip title={tr('configuration.save')}><IconButton size="small" onClick={() => handleUpdateUser(u.email)}><SaveIcon fontSize="small" sx={{ color: accent }} /></IconButton></Tooltip>
                          <Tooltip title={tr('configuration.cancel')}><IconButton size="small" onClick={() => setEditingUserEmail(null)}><RestoreIcon fontSize="small" /></IconButton></Tooltip>
                        </>
                      ) : (
                        <>
                          <Tooltip title={tr('configuration.edit')}><IconButton size="small" onClick={() => startEdit(u)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                          {u.is_active
                            ? <Tooltip title={tr('configuration.deactivate')}><IconButton size="small" onClick={() => handleDeactivate(u.email)}><DeleteIcon fontSize="small" color="error" /></IconButton></Tooltip>
                            : <Tooltip title={tr('configuration.reactivate')}><IconButton size="small" onClick={() => handleReactivate(u.email)}><RestoreIcon fontSize="small" sx={{ color: statusColors().success }} /></IconButton></Tooltip>
                          }
                        </>
                      )}
                    </Box>
                  </TableCell>
                </TableRow>
              );
            })}
            {addingUser && (
              <TableRow>
                <TableCell>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                    <TextField size="small" placeholder={tr('configuration.emailCompanyCom')} value={newUser.email} onChange={e => setNewUser(f => ({ ...f, email: e.target.value }))} sx={{ '& input': { py: 0.5, fontSize: '0.8rem' } }} />
                    <TextField size="small" placeholder={tr('configuration.displayName')} value={newUser.display_name} onChange={e => setNewUser(f => ({ ...f, display_name: e.target.value }))} sx={{ '& input': { py: 0.5, fontSize: '0.8rem' } }} />
                    <TextField size="small" placeholder={tr('configuration.snowflakeUserOptional')} value={newUser.sf_user} onChange={e => setNewUser(f => ({ ...f, sf_user: e.target.value }))} sx={{ '& input': { py: 0.5, fontSize: '0.75rem', fontFamily: 'monospace' } }} />
                  </Box>
                </TableCell>
                <TableCell>
                  <Select size="small" value={newUser.role} onChange={e => setNewUser(f => ({ ...f, role: e.target.value }))} sx={{ fontSize: '0.8rem', '& .MuiSelect-select': { py: 0.5 } }}>
                    <MenuItem value="ADMIN">ADMIN</MenuItem>
                    <MenuItem value="STEWARD">STEWARD</MenuItem>
                    <MenuItem value="VIEWER">VIEWER</MenuItem>
                  </Select>
                </TableCell>
                <TableCell>
                  <TextField size="small" fullWidth placeholder={tr('configuration.fraBel')} value={newUser.country_scope} onChange={e => setNewUser(f => ({ ...f, country_scope: e.target.value }))} sx={{ '& input': { py: 0.5, fontSize: '0.8rem' } }} />
                </TableCell>
                <TableCell>
                  <Select size="small" multiple value={newUser.mdm_roles}
                    onChange={e => setNewUser(f => ({ ...f, mdm_roles: typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value as string[] }))}
                    renderValue={(sel) => (sel as string[]).join(', ')}
                    sx={{ fontSize: '0.75rem', minWidth: 200, '& .MuiSelect-select': { py: 0.5 } }}>
                    {availableRoles.map(r => (
                      <MenuItem key={r} value={r}>
                        <Checkbox size="small" checked={newUser.mdm_roles.includes(r)} sx={{ py: 0 }} />
                        <Typography variant="body2" sx={{ fontSize: '0.8rem' }}>{r}</Typography>
                      </MenuItem>
                    ))}
                  </Select>
                </TableCell>
                <TableCell />
                <TableCell align="center">
                  <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'center' }}>
                    <Tooltip title={tr('configuration.create')}><IconButton size="small" onClick={handleAddUser} disabled={!newUser.email || !newUser.display_name}><SaveIcon fontSize="small" sx={{ color: accent }} /></IconButton></Tooltip>
                    <Tooltip title={tr('configuration.cancel')}><IconButton size="small" onClick={() => setAddingUser(false)}><RestoreIcon fontSize="small" /></IconButton></Tooltip>
                  </Box>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Box>
    );
  };

  // ── Localization panel ──
  const renderLocalization = () => (
    <Box>
      <Typography variant="h5" fontWeight={700} sx={{ mb: 3, display: 'flex', alignItems: 'center', gap: 1 }}>
        <TranslateIcon sx={{ color: accent }} /> Localization
      </Typography>

      {/* Languages */}
      <Card variant="outlined" sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" fontWeight={600} gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <TranslateIcon fontSize="small" /> Translation Languages
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {tr('configuration.languagesAvailableForProductEntity')}
          </Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>{tr('configuration.code')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{tr('configuration.language')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{tr('configuration.default')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">{tr('configuration.status')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {languages.map(lang => (
                <TableRow key={lang.code} hover>
                  <TableCell><Chip label={lang.code} size="small" sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }} /></TableCell>
                  <TableCell>{lang.label}</TableCell>
                  <TableCell>
                    {lang.default
                      ? <Chip label={tr('configuration.default')} size="small" color="primary" sx={{ fontSize: '0.7rem' }} />
                      : (
                        <Button size="small" disabled={locBusy} onClick={() => makeDefaultLanguage(lang.code)}
                          sx={{ fontSize: '0.7rem', textTransform: 'none', minWidth: 0, py: 0 }}>
                          {tr('configuration.setDefault')}
                        </Button>
                      )}
                  </TableCell>
                  <TableCell align="right">
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.5 }}>
                      <Typography variant="caption" sx={{ color: lang.enabled === false ? 'text.disabled' : 'success.main' }}>
                        {lang.enabled === false ? tr('configuration.inactive') : 'Active'}
                      </Typography>
                      <Tooltip title={lang.default
                        ? tr('configuration.theDefaultLanguageIsAlways')
                        : lang.enabled === false ? `Activate ${lang.label}` : `Deactivate ${lang.label}`}>
                        <Switch size="small" checked={lang.enabled !== false} disabled={locBusy || !!lang.default}
                          onChange={(_, checked) => toggleLanguageEnabled(lang.code, checked)} />
                      </Tooltip>
                    </Box>
                  </TableCell>
                </TableRow>
              ))}
              {languages.length === 0 && (
                <TableRow><TableCell colSpan={4} sx={{ textAlign: 'center', color: 'text.secondary', py: 3 }}>{tr('configuration.noLanguagesConfiguredAddLanguages')}</TableCell></TableRow>
              )}
              {/* Add row */}
              <TableRow>
                <TableCell>
                  <TextField size="small" placeholder="en" value={newLang.code} inputProps={{ maxLength: 5 }}
                    onChange={e => setNewLang(f => ({ ...f, code: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter') addLanguage(); }}
                    sx={{ width: 80, '& input': { py: 0.5, fontSize: '0.8rem', fontFamily: 'monospace' } }} />
                </TableCell>
                <TableCell colSpan={2}>
                  <TextField size="small" placeholder={tr('configuration.english')} value={newLang.label}
                    onChange={e => setNewLang(f => ({ ...f, label: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter') addLanguage(); }}
                    sx={{ width: 220, '& input': { py: 0.5, fontSize: '0.8rem' } }} />
                </TableCell>
                <TableCell align="right">
                  <Tooltip title={tr('configuration.addLanguage')}>
                    <IconButton size="small" color="primary" disabled={locBusy || !newLang.code.trim() || !newLang.label.trim()} onClick={addLanguage}>
                      <AddIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Countries */}
      <Card variant="outlined" sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" fontWeight={600} gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <PublicIcon fontSize="small" /> Operating Countries
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {tr('configuration.countriesWhereTheOrganizationOperates')}
          </Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>{tr('configuration.code')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{tr('configuration.country')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">{tr('configuration.status')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {countries.map(c => (
                <TableRow key={c.code} hover>
                  <TableCell><Chip label={c.code} size="small" sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }} /></TableCell>
                  <TableCell>{c.label}</TableCell>
                  <TableCell align="right">
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.5 }}>
                      <Typography variant="caption" sx={{ color: c.enabled === false ? 'text.disabled' : 'success.main' }}>
                        {c.enabled === false ? tr('configuration.inactive') : 'Active'}
                      </Typography>
                      <Tooltip title={c.enabled === false ? `Activate ${c.label}` : `Deactivate ${c.label}`}>
                        <Switch size="small" checked={c.enabled !== false} disabled={locBusy}
                          onChange={(_, checked) => toggleCountryEnabled(c.code, checked)} />
                      </Tooltip>
                    </Box>
                  </TableCell>
                </TableRow>
              ))}
              {countries.length === 0 && (
                <TableRow><TableCell colSpan={3} sx={{ textAlign: 'center', color: 'text.secondary', py: 3 }}>{tr('configuration.noCountriesConfiguredSingleCountry')}</TableCell></TableRow>
              )}
              {/* Add row */}
              <TableRow>
                <TableCell>
                  <TextField size="small" placeholder="FRA" value={newCountry.code} inputProps={{ maxLength: 3 }}
                    onChange={e => setNewCountry(f => ({ ...f, code: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter') addCountry(); }}
                    sx={{ width: 80, '& input': { py: 0.5, fontSize: '0.8rem', fontFamily: 'monospace' } }} />
                </TableCell>
                <TableCell>
                  <TextField size="small" placeholder={tr('configuration.france')} value={newCountry.label}
                    onChange={e => setNewCountry(f => ({ ...f, label: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter') addCountry(); }}
                    sx={{ width: 220, '& input': { py: 0.5, fontSize: '0.8rem' } }} />
                </TableCell>
                <TableCell align="right">
                  <Tooltip title={tr('configuration.addCountry')}>
                    <IconButton size="small" color="primary" disabled={locBusy || !newCountry.code.trim() || !newCountry.label.trim()} onClick={addCountry}>
                      <AddIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Country scope per module */}
      <Card variant="outlined">
        <CardContent>
          <Typography variant="h6" fontWeight={600} gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <FlagIcon fontSize="small" /> Country Scope per Module
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {tr('configuration.enableCountryScopingToAdd')}
          </Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>{tr('configuration.module')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{tr('configuration.countryScoped2')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{tr('configuration.effect')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {modules.filter(m => m.enabled).map(mod => (
                <TableRow key={mod.id} hover>
                  <TableCell><Typography variant="body2" fontWeight={500}>{mod.label}</Typography></TableCell>
                  <TableCell>
                    <Switch
                      size="small"
                      checked={!!mod.country_scoped}
                      onChange={(_, checked) => toggleModuleProp(mod.id, 'country_scoped', checked)}
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" color="text.secondary">
                      {mod.country_scoped
                        ? tr('configuration.countryColumnVisibleRowAccess')
                        : 'No country filtering — all records visible to all users'}
                    </Typography>
                  </TableCell>
                </TableRow>
              ))}
              {modules.filter(m => m.enabled).length === 0 && (
                <TableRow><TableCell colSpan={3} sx={{ textAlign: 'center', color: 'text.secondary', py: 3 }}>{tr('configuration.noEnabledModules')}</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </Box>
  );

  // ── route content ──
  const renderContent = () => {
    // Module sub-pages: modules/{id} or modules/{id}/{sub}
    if (section === 'modules') {
      if (!subsection) return renderModulesOverview();

      // Parse subsection — could be "customer" or just moduleId
      const modId = subsection;
      const mod = modules.find(m => m.id === modId);
      if (!mod) return renderModulesOverview();

      // Show module sub-nav tabs + content
      return (
        <>
          {/* Module sub-tab bar */}
          <Box sx={{ display: 'flex', gap: 0.5, mb: 3, borderBottom: `1px solid ${isDark ? alpha('#fff', 0.08) : alpha('#000', 0.08)}`, pb: 0.5, flexWrap: 'wrap' }}>
            {moduleSubItems()
              .filter(sub => {
                if (sub.suffix === 'hierarchy' && !mod.has_hierarchy) return false;
                if (sub.suffix === 'matching' && !mod.has_matching) return false;
                return true;
              })
              .map(sub => (
                <Button
                  key={sub.suffix}
                  size="small"
                  variant={moduleSubTab === sub.suffix ? 'contained' : 'text'}
                  startIcon={sub.icon}
                  onClick={() => subsection && openModuleTab(subsection, sub.suffix)}
                  sx={{
                    textTransform: 'none',
                    fontWeight: moduleSubTab === sub.suffix ? 600 : 400,
                    bgcolor: moduleSubTab === sub.suffix ? alpha(accent, 0.15) : 'transparent',
                    color: moduleSubTab === sub.suffix ? accent : 'text.secondary',
                    '&:hover': { bgcolor: alpha(accent, 0.08) },
                    boxShadow: 'none',
                  }}
                >
                  {sub.label}
                </Button>
              ))}
          </Box>

          {moduleSubTab === 'general' && renderModuleGeneral(mod)}
          {moduleSubTab === 'data-model' && renderModuleDataModel(mod)}
          {moduleSubTab === 'grid' && <GridColumnsSettings key={mod.id} moduleId={mod.id} />}
          {moduleSubTab === 'data-quality' && renderModuleDataQuality(mod)}
          {moduleSubTab === 'matching' && renderModuleMatching(mod)}
          {moduleSubTab === 'hierarchy' && renderModuleHierarchy(mod)}
          {moduleSubTab === 'workflows' && renderModuleWorkflows(mod)}
        </>
      );
    }

    // Shared capabilities
    if (activePath === 'shared/reference-data') return <Navigate to="/reference-data" />;
    if (activePath === 'shared/dq-library') return renderSharedDqLibrary();
    if (activePath === 'shared/localization') return renderLocalization();
    if (activePath === 'shared/branding') return <BrandingSettings />;

    // Integrations
    if (activePath === 'integrations/replication') return renderReplication();

    // Security
    if (activePath === 'security/users') return renderUsers();
    if (activePath === 'security/roles') return renderRoles();
    if (activePath === 'security/data-masking') return <PiiMaskingPanel />;

    // System
    if (activePath === 'system/health') return renderHealth();

    // Default — show modules overview
    return renderModulesOverview();
  };

  if (loading && !health && modules.length === 0) {
    return <Box sx={{ p: 4, display: 'flex', justifyContent: 'center' }}><CircularProgress /></Box>;
  }

  return (
    <Box sx={{ display: 'flex', height: '100%', mx: -3, mt: -3, mb: -3 }}>
      {/* Left tree nav */}
      <Box sx={{
        width: NAV_WIDTH,
        minWidth: NAV_WIDTH,
        borderRight: `1px solid ${isDark ? alpha('#fff', 0.08) : alpha('#000', 0.08)}`,
        overflow: 'auto',
        py: 2,
        px: 1,
        bgcolor: isDark ? alpha('#fff', 0.01) : alpha('#000', 0.01),
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 1.5, mb: 1.5 }}>
          <Typography variant="subtitle2" fontWeight={700} sx={{ fontSize: '0.9rem' }}>{tr('configuration.configuration')}</Typography>
          <Tooltip title={tr('configuration.refreshAll')}>
            <IconButton size="small" onClick={fetchAll} disabled={loading}>
              <RefreshIcon sx={{ fontSize: 18, animation: loading ? 'spin 1s linear infinite' : 'none', '@keyframes spin': { from: { transform: 'rotate(0deg)' }, to: { transform: 'rotate(360deg)' } } }} />
            </IconButton>
          </Tooltip>
        </Box>
        <List dense disablePadding>
          {tree.map(item => renderTreeItem(item))}
        </List>
      </Box>

      {/* Right content */}
      <Box sx={{ flex: 1, overflow: 'auto', p: 3 }}>
        {renderContent()}
      </Box>

      {/* Create Rule Dialog */}
      <Dialog open={createRuleOpen} onClose={() => setCreateRuleOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{tr('configuration.createDqRuleCreateruleentity', { createRuleEntity })}</DialogTitle>
        <DialogContent dividers>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField size="small" label={tr('configuration.ruleCode')} value={newDqRule.rule_code}
                onChange={e => setNewDqRule(p => ({ ...p, rule_code: e.target.value.toUpperCase() }))} sx={{ flex: 1 }} placeholder={tr('configuration.eGCuValidPhone')} />
              <FormControl size="small" sx={{ flex: 1 }}><InputLabel>{tr('configuration.type')}</InputLabel>
                <Select value={newDqRule.rule_type} label={tr('configuration.type')} onChange={e => setNewDqRule(p => ({ ...p, rule_type: e.target.value }))}>
                  {RULE_TYPES.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                </Select>
              </FormControl>
            </Box>
            <TextField size="small" label={tr('configuration.ruleName')} value={newDqRule.rule_name}
              onChange={e => setNewDqRule(p => ({ ...p, rule_name: e.target.value }))} fullWidth placeholder={tr('configuration.eGCustomerPhoneMust')} />
            <FormControl size="small"><InputLabel>{tr('configuration.severity')}</InputLabel>
              <Select value={newDqRule.severity} label={tr('configuration.severity')} onChange={e => setNewDqRule(p => ({ ...p, severity: e.target.value }))}>
                {SEVERITIES.map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
              </Select>
            </FormControl>
            <TextField size="small" label={tr('configuration.sqlExpression2')} value={newDqRule.sql_expression}
              onChange={e => setNewDqRule(p => ({ ...p, sql_expression: e.target.value }))}
              fullWidth multiline rows={3} placeholder={tr('configuration.eGPhoneIsNot')}
              sx={{ '& textarea': { fontFamily: 'monospace', fontSize: '0.8rem' } }} />
            <Typography variant="caption" color="text.secondary">
              {tr('configuration.theSqlExpressionIsEvaluated')}
            </Typography>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateRuleOpen(false)}>{tr('configuration.cancel')}</Button>
          <Button variant="contained" onClick={handleCreateDqRule} disabled={dqCreating}
            startIcon={dqCreating ? <CircularProgress size={14} /> : <AddIcon />}>{tr('configuration.createRule')}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
