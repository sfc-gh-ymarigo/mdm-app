import { useSearchParams } from 'react-router-dom';
import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Box, Typography, Card, Chip, alpha, CircularProgress, TextField, useTheme,
  InputAdornment, FormControl, InputLabel, Select, MenuItem, Button,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import EditIcon from '@mui/icons-material/Edit';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import FilterListIcon from '@mui/icons-material/FilterList';
import ClearIcon from '@mui/icons-material/Clear';
import { auditApi } from '../api/client';
import type { AuditEntry } from '../types/models';
import { useBrand } from '../config/BrandContext';
import { RecordLink, UserLink } from '../components/common/Links';
import { useDebounced } from '../components/common/useServerList';
import { tr, localized } from '../i18n';

import { formatDate } from '../components/common/format';
import { statusColors, seriesColor } from '../theme/brandColors';
const PAGE = 50;

const langNames: Record<string, string> = { fr: tr('auditTrail.french'), de: tr('auditTrail.german'), pl: tr('auditTrail.polish'), es: tr('auditTrail.spanish'), it: tr('auditTrail.italian'), nl: tr('auditTrail.dutch'), en: tr('auditTrail.english') };

function formatTranslations(obj: Record<string, Record<string, string>>): React.ReactNode {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      {Object.entries(obj).map(([lang, fields]) => (
        <Box key={lang} sx={{ display: 'flex', gap: 1, alignItems: 'baseline' }}>
          <Typography variant="caption" sx={{ fontWeight: 700, minWidth: 50, color: 'text.secondary' }}>{langNames[lang] || lang.toUpperCase()}</Typography>
          <Typography variant="caption" sx={{ color: alpha('#fff', 0.6) }}>
            {Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join(' · ')}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

function isTranslationObj(v: unknown): v is Record<string, Record<string, string>> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  return Object.values(v as Record<string, unknown>).every(inner => inner && typeof inner === 'object' && !Array.isArray(inner));
}

const ISO_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function formatValue(value: unknown): React.ReactNode {
  if (value === null || value === undefined) return '—';
  if (isTranslationObj(value)) return formatTranslations(value);
  if (typeof value === 'string' && ISO_TS.test(value)) return formatDate(value, true);
  if (typeof value === 'boolean') return value ? tr('common.yes') : tr('common.no');
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  return s.length > 80 ? s.slice(0, 80) + '\u2026' : s;
}

const actionConfig: Record<string, { icon: typeof EditIcon; color: string }> = {
  INSERT: { icon: AddIcon, get color() { return statusColors().success; } },
  UPDATE: { icon: EditIcon, get color() { return seriesColor(5); } },
  DELETE: { icon: DeleteIcon, get color() { return statusColors().error; } },
};

export default function AuditTrail() {
  const theme = useTheme();
  const brand = useBrand();
  // Field label: the module's configured label, else a known system field, else the name in sentence case
  const fieldLabel = (entityType: string, field: string) => {
    const f = brand.modules.find(m => m.id.toUpperCase() === entityType)?.fields.find(x => x.name === field);
    if (f) return localized(f.label, f.labels);
    const plain = field.replace(/_/g, ' ');
    return tr(`fields.system.${field}`, { defaultValue: plain.charAt(0).toUpperCase() + plain.slice(1) });
  };
  const entityLabel = (entityType: string) => {
    const m = brand.modules.find(x => x.id.toUpperCase() === entityType);
    return m ? localized(m.singular, m.singular_labels) : entityType;
  };
  const fgMuted = theme.palette.text.secondary;
  const dividerColor = theme.palette.divider;
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch] = useState('');
  // Deep-link filters: /audit?user=…&entity_type=…&entity_id=…&action=…
  const [params, setParams] = useSearchParams();
  const userFilter = params.get('user');
  const entityIdFilter = params.get('entity_id');
  const [actionFilter, setActionFilter] = useState(params.get('action')?.toUpperCase() || 'ALL');
  const [entityTypeFilter, setEntityTypeFilter] = useState(params.get('entity_type')?.toUpperCase() || 'ALL');
  const clearParam = (k: string) => setParams(prev => { const n = new URLSearchParams(prev); n.delete(k); return n; }, { replace: true });
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const debouncedSearch = useDebounced(search);
  // Filters are applied by the API; the timeline loads pages of PAGE entries ("Load more")
  const query = useMemo(() => {
    const q = new URLSearchParams();
    if (userFilter) q.set('user', userFilter);
    if (entityIdFilter) q.set('entity_id', entityIdFilter);
    if (actionFilter !== 'ALL') q.set('action', actionFilter);
    if (entityTypeFilter !== 'ALL') q.set('entity_type', entityTypeFilter);
    if (dateFrom) q.set('from', dateFrom);
    if (dateTo) q.set('to', dateTo);
    if (debouncedSearch.trim()) q.set('q', debouncedSearch.trim());
    return q;
  }, [userFilter, entityIdFilter, actionFilter, entityTypeFilter, dateFrom, dateTo, debouncedSearch]);
  const loadedFor = useRef('');

  const loadPage = async (page: number) => {
    const p = new URLSearchParams(query); p.set('page', String(page)); p.set('size', String(PAGE));
    const key = query.toString();
    const r = await auditApi.page(p);
    if (key !== loadedFor.current) return; // filters changed meanwhile
    setTotal(r.total);
    setEntries(prev => (page === 0 ? r.rows : [...prev, ...r.rows]));
  };

  useEffect(() => {
    loadedFor.current = query.toString();
    setLoading(true);
    loadPage(0).catch(console.error).finally(() => setLoading(false));
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadMore = () => {
    setLoadingMore(true);
    loadPage(Math.ceil(entries.length / PAGE)).catch(console.error).finally(() => setLoadingMore(false));
  };

  const entityTypes = useMemo(() => brand.modules.filter(m => m.enabled).map(m => m.id.toUpperCase()).sort(), [brand.modules]);
  const actions = ['INSERT', 'UPDATE', 'DELETE'];
  const filtered = entries;

  const activeFilters = [actionFilter !== 'ALL', entityTypeFilter !== 'ALL', !!dateFrom, !!dateTo, !!search].filter(Boolean).length;

  const clearFilters = () => { setSearch(''); setActionFilter('ALL'); setEntityTypeFilter('ALL'); setDateFrom(''); setDateTo(''); };

  if (loading && entries.length === 0) return <Box sx={{ display: 'flex', justifyContent: 'center', mt: 10 }}><CircularProgress /></Box>;

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" gutterBottom>{tr('auditTrail.auditTrail')}</Typography>
        <Typography variant="subtitle1">{tr('auditTrail.lengthEntriesCompleteChangeHistory', { length: total })}</Typography>
        {(userFilter || entityIdFilter) && (
          <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
            {userFilter && <Chip size="small" label={tr('auditTrail.userChip', { user: userFilter })} onDelete={() => clearParam('user')} />}
            {entityIdFilter && <Chip size="small" label={tr('auditTrail.recordChip', { name: entries[0]?.entity_name ?? entityIdFilter })} onDelete={() => clearParam('entity_id')} />}
          </Box>
        )}
      </Box>

      {/* Filters */}
      <Card sx={{ mb: 2, p: 2 }}>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
          <TextField
            placeholder={tr('auditTrail.searchByNameUserOr')}
            size="small"
            value={search}
            onChange={e => setSearch(e.target.value)}
            sx={{ minWidth: 260 }}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon sx={{ color: fgMuted, fontSize: 18 }} /></InputAdornment> }}
          />
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <InputLabel>{tr('auditTrail.action')}</InputLabel>
            <Select value={actionFilter} label={tr('auditTrail.action')} onChange={e => setActionFilter(e.target.value)}>
              <MenuItem value="ALL">{tr('auditTrail.all')}</MenuItem>
              {actions.map(a => <MenuItem key={a} value={a}>{a}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel>{tr('auditTrail.entityType')}</InputLabel>
            <Select value={entityTypeFilter} label={tr('auditTrail.entityType')} onChange={e => setEntityTypeFilter(e.target.value)}>
              <MenuItem value="ALL">{tr('auditTrail.all')}</MenuItem>
              {entityTypes.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
            </Select>
          </FormControl>
          <TextField
            size="small" type="date" label={tr('auditTrail.from')} value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            InputLabelProps={{ shrink: true }} sx={{ width: 150 }}
          />
          <TextField
            size="small" type="date" label={tr('auditTrail.to')} value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            InputLabelProps={{ shrink: true }} sx={{ width: 150 }}
          />
          {activeFilters > 0 && (
            <Button size="small" startIcon={<ClearIcon />} onClick={clearFilters} sx={{ color: fgMuted }}>
              {tr('auditTrail.clearFilters')}{activeFilters > 1 ? ` (${activeFilters})` : ''}
            </Button>
          )}
          <Typography variant="caption" sx={{ ml: 'auto', color: fgMuted }}>
            <FilterListIcon sx={{ fontSize: 14, verticalAlign: 'middle', mr: 0.5 }} />
            {loading && <CircularProgress size={12} sx={{ mr: 1 }} />}
            {filtered.length} of {total}
          </Typography>
        </Box>
      </Card>

      {/* Timeline */}
      <Card sx={{ p: 2 }}>
        {filtered.length === 0 && (
          <Box sx={{ textAlign: 'center', py: 6 }}>
            <Typography variant="body2" sx={{ color: fgMuted }}>{tr('auditTrail.noAuditEntriesMatchYour')}</Typography>
            <Button size="small" onClick={clearFilters} sx={{ mt: 1, color: brand.palette.accent }}>{tr('auditTrail.clearFilters')}</Button>
          </Box>
        )}
        {filtered.map((entry, idx) => {
          const config = actionConfig[entry.action] || actionConfig.UPDATE;
          const Icon = config.icon;
          return (
            <Box key={entry.id} sx={{ display: 'flex', gap: 2, position: 'relative' }}>
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 40 }}>
                <Box sx={{ width: 32, height: 32, borderRadius: '50%', bgcolor: alpha(config.color, 0.15), border: `2px solid ${config.color}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon sx={{ fontSize: 16, color: config.color }} /></Box>
                {idx < filtered.length - 1 && <Box sx={{ width: 2, flex: 1, bgcolor: dividerColor, my: 0.5 }} />}
              </Box>
              <Box sx={{ flex: 1, pb: 3 }}>
                <Typography variant="caption" sx={{ color: fgMuted, display: 'block', mb: 0.5 }}>{formatDate(entry.performed_at, true)}</Typography>
                <Card sx={{ bgcolor: alpha(theme.palette.text.primary, 0.02), p: 2 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                    <Chip label={entry.action} size="small" sx={{ fontSize: '0.65rem', bgcolor: alpha(config.color, 0.15), color: config.color }} />
                    <Chip label={entityLabel(entry.entity_type)} size="small" variant="outlined" sx={{ fontSize: '0.65rem' }} />
                    <Typography variant="body2" sx={{ fontWeight: 600 }}><RecordLink type={entry.entity_type} id={entry.entity_id}>{entry.entity_name || entry.entity_id}</RecordLink></Typography>
                  </Box>
                  <Typography variant="caption" sx={{ color: fgMuted, display: 'block', mb: 1 }}>by <UserLink email={entry.performed_by}>{entry.performed_by}</UserLink></Typography>
                  {entry.changed_fields && (
                    <Box sx={{ mt: 1 }}>
                      {Object.entries(entry.changed_fields).map(([field, change]) => (
                        <Box key={field} sx={{ display: 'flex', gap: 1, alignItems: field === 'translations' ? 'flex-start' : 'center', py: 0.5, borderBottom: `1px solid ${dividerColor}` }}>
                          <Typography variant="caption" sx={{ color: fgMuted, minWidth: 120, pt: field === 'translations' ? 0.5 : 0 }}>{fieldLabel(entry.entity_type, field)}</Typography>
                          {field === 'translations' ? (
                            <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', flex: 1 }}>
                              <Box sx={{ flex: 1, p: 1, borderRadius: 1, bgcolor: alpha(statusColors().error, 0.06), border: `1px solid ${alpha(statusColors().error, 0.15)}` }}>{formatValue(change.old)}</Box>
                              <Typography variant="caption" sx={{ color: fgMuted, mt: 1 }}>{'\u2192'}</Typography>
                              <Box sx={{ flex: 1, p: 1, borderRadius: 1, bgcolor: alpha(statusColors().success, 0.06), border: `1px solid ${alpha(statusColors().success, 0.15)}` }}>{formatValue(change.new)}</Box>
                            </Box>
                          ) : (
                            <>
                              <Chip label={String(formatValue(change.old))} size="small" sx={{ fontSize: '0.6rem', bgcolor: alpha(statusColors().error, 0.1), color: statusColors().error, textDecoration: 'line-through', maxWidth: 300 }} />
                              <Typography variant="caption" sx={{ color: fgMuted }}>{'\u2192'}</Typography>
                              <Chip label={String(formatValue(change.new))} size="small" sx={{ fontSize: '0.6rem', bgcolor: alpha(statusColors().success, 0.1), color: statusColors().success, maxWidth: 300 }} />
                            </>
                          )}
                        </Box>
                      ))}
                    </Box>
                  )}
                </Card>
              </Box>
            </Box>
          );
        })}
        {entries.length < total && (
          <Box sx={{ textAlign: 'center', pt: 1 }}>
            <Button size="small" variant="outlined" onClick={loadMore} disabled={loadingMore} startIcon={loadingMore ? <CircularProgress size={14} /> : undefined}>
              {tr('common.loadMore', { count: total - entries.length })}
            </Button>
          </Box>
        )}
      </Card>
    </Box>
  );
}
