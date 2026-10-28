import { useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { Box, Card, CardContent, Typography, alpha, List, ListItem, ListItemButton, ListItemText, Chip, Grid2 as Grid, CircularProgress, LinearProgress, Button } from '@mui/material';
import VerifiedIcon from '@mui/icons-material/VerifiedUser';
import TimelineIcon from '@mui/icons-material/Timeline';
import JoinInnerIcon from '@mui/icons-material/JoinInner';
import CategoryIcon from '@mui/icons-material/Category';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Legend } from 'recharts';
import KpiCard from '../components/KpiCard';
import { MODULE_ICONS } from '../components/Layout';
import { statsApi, auditApi } from '../api/client';
import type { DashboardStats, ModuleStats } from '../api/client';
import type { AuditEntry } from '../types/models';
import { useChartColors } from '../theme/useChartColors';
import { useBrand } from '../config/BrandContext';
import { RecordLink, UserLink } from '../components/common/Links';
import { tr, localized } from '../i18n';

import { formatDate } from '../components/common/format';
import { chartsConfig, statusColors, stageColor, qualityColor, priorityColor, workflowTypeColor } from '../theme/brandColors';
/** Recharts passes the clicked bar's datum in `payload`. */
type BarClick = { payload?: Record<string, string | number> };

const actionColor = (a: string) => (a === 'INSERT' ? statusColors().success : a === 'DELETE' ? statusColors().error : statusColors().info);
const actionChipSx = (a: string) => ({ fontSize: '0.65rem', height: 20, bgcolor: alpha(actionColor(a), 0.15), color: actionColor(a) });


type ChartRow = { label: string; count: number; link: string; fill: string };

export default function Dashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const cc = useChartColors();
  const brand = useBrand();
  const COLORS = cc.series(chartsConfig().mode === 'monochrome' ? Math.max(stats?.modules?.length || 0, 3) : chartsConfig().colors.length);

  useEffect(() => {
    Promise.all([statsApi.dashboard(), auditApi.list()])
      .then(([s, a]) => { setStats(s); setAudit(a); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading || !stats) return <Box sx={{ display: 'flex', justifyContent: 'center', mt: 10 }}><CircularProgress /></Box>;

  const mods = stats.modules;
  const colorOf = (i: number) => COLORS[i % COLORS.length];
  const nameOf = (m: ModuleStats) => localized(m.label, m.labels);
  const pct = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 100) : 0);
  const totalRecords = mods.reduce((a, m) => a + m.total, 0);
  const avgDq = totalRecords > 0 ? mods.reduce((a, m) => a + m.avg_dq_score * m.total, 0) / totalRecords : 0;
  const { my_work: work, trends } = stats;
  const dqDelta = trends.dq_pass_rate_delta;
  const hasActivity = trends.activity.some(d => d.INSERT || d.UPDATE || d.DELETE);

  // One chart card per module: lifecycle (stage colors), country, then each configured filter (module color)
  const charts: { key: string; title: string; icon: React.ReactNode; color: string; rows: ChartRow[] }[] = [];
  mods.forEach((m, i) => {
    const base = `/${m.id}s`;
    charts.push({
      key: `${m.id}-stage`, title: tr('dashboard.lifecycleOf', { module: nameOf(m) }), icon: MODULE_ICONS[m.icon] || <CategoryIcon />, color: colorOf(i),
      rows: Object.entries(m.by_stage).filter(([, v]) => v > 0)
        .map(([stage, count]) => ({ label: stage, count, link: `${base}?stage=${encodeURIComponent(stage)}`, fill: stageColor(stage) })),
    });
    if (m.by_country?.length) charts.push({
      key: `${m.id}-country`, title: tr('dashboard.byCountryOf', { module: nameOf(m) }), icon: null, color: colorOf(i),
      rows: [...m.by_country].sort((a, b) => b.count - a.count)
        .map(c => ({ label: c.country, count: c.count, link: `${base}?country_code=${encodeURIComponent(c.country)}`, fill: colorOf(i) })),
    });
    for (const b of m.breakdowns) if (b.values.length) charts.push({
      key: `${m.id}-${b.field}`, title: tr('dashboard.byFieldOf', { module: nameOf(m), field: b.label.toLowerCase() }), icon: null, color: colorOf(i),
      rows: b.values.map(v => ({ label: v.value, count: v.count, link: `${base}?${b.field}=${encodeURIComponent(v.key)}`, fill: colorOf(i) })),
    });
  });

  const workRows = [
    { label: tr('dashboard.assignedToMe'), value: work.mine, color: statusColors().info, to: '/stewardship' },
    { label: tr('dashboard.highPriority'), value: work.mine_high, color: statusColors().error, to: '/stewardship' },
    { label: tr('dashboard.overdue'), value: work.overdue, color: statusColors().warning, to: '/workflows' },
    { label: tr('dashboard.unassigned'), value: work.unassigned, color: statusColors().neutral, to: '/workflows' },
    { label: tr('dashboard.duplicatesToReview'), value: stats.pending_matches, color: statusColors().warning, to: '/match-merge' },
  ];

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" gutterBottom>{tr('dashboard.mdmCommandCenter')}</Typography>
        <Typography variant="subtitle1">{brand.tagline}</Typography>
      </Box>

      {/* Row 1: one KPI per enabled module + shared KPIs */}
      <Grid container spacing={2.5} sx={{ mb: 3, '& > .MuiGrid2-root': { display: 'flex' } }}>
        {mods.map((m, i) => (
          <Grid key={m.id} size={{ xs: 12, sm: 6, md: 'grow' }}>
            <KpiCard to={`/${m.id}s`} title={nameOf(m)} value={m.total} icon={MODULE_ICONS[m.icon] || <CategoryIcon />} color={colorOf(i)}
              subtitle={tr('dashboard.liveOfTotal', { stage: m.live_stage, live: m.live, total: m.total })}
              trend={m.created_30d ? tr('dashboard.newIn30d', { count: m.created_30d }) : undefined} />
          </Grid>
        ))}
        <Grid size={{ xs: 12, sm: 6, md: 'grow' }}><KpiCard to="/data-quality" title={tr('dashboard.avgDqScore')} value={`${avgDq.toFixed(1)}%`} icon={<VerifiedIcon />} color={qualityColor(avgDq)} subtitle={tr('dashboard.acrossAllRecords')}
          trend={dqDelta != null ? tr('dashboard.dqDelta', { delta: `${dqDelta >= 0 ? '+' : ''}${dqDelta}` }) : undefined} /></Grid>
        <Grid size={{ xs: 12, sm: 6, md: 'grow' }}><KpiCard to="/workflows" title={tr('dashboard.pendingWorkflows')} value={stats.pending_workflows} icon={<TimelineIcon />} color={statusColors().warning} subtitle={tr('dashboard.awaitingAction')}
          trend={tr('dashboard.wfFlow', { opened: trends.workflows_opened_30d, closed: trends.workflows_closed_30d })}
          trendColor={trends.workflows_closed_30d >= trends.workflows_opened_30d ? statusColors().success : statusColors().warning} /></Grid>
        <Grid size={{ xs: 12, sm: 6, md: 'grow' }}><KpiCard to="/match-merge" title={tr('dashboard.matchCandidates')} value={stats.pending_matches} icon={<JoinInnerIcon />} color={statusColors().error} subtitle={tr('dashboard.potentialDuplicates')} /></Grid>
      </Grid>

      {/* Row 2: caller's work, then quality, completeness and live rate per module */}
      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, md: 4 }}>
          <Card sx={{ height: '100%' }}><CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="h6" sx={{ fontSize: '0.95rem' }}>{tr('dashboard.myWork')}</Typography>
              <Button size="small" onClick={() => navigate('/stewardship')}>{tr('dashboard.openStewardship')}</Button>
            </Box>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1.5 }}>
              {workRows.map(r => (
                <Chip key={r.label} clickable onClick={() => navigate(r.to)} size="small" label={`${r.label} · ${r.value}`}
                  sx={{ fontSize: '0.7rem', fontWeight: 600, bgcolor: alpha(r.color, r.value ? 0.15 : 0.05), color: r.value ? r.color : cc.fgMuted }} />
              ))}
            </Box>
            {work.top.length === 0 ? (
              <Typography variant="body2" sx={{ color: cc.fgMuted }}>{tr('dashboard.nothingAssigned')}</Typography>
            ) : (
              <List disablePadding dense>
                {work.top.map(w => (
                  <ListItemButton key={w.id} onClick={() => navigate(`/workflows/${w.id}`)} sx={{ px: 1, borderRadius: 1 }}>
                    <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: priorityColor(w.priority), mr: 1.5, flexShrink: 0 }} />
                    <ListItemText
                      primary={<Typography variant="body2" sx={{ color: cc.fg, fontSize: '0.8rem', fontWeight: 500 }} noWrap>{w.entity_name || w.entity_id}</Typography>}
                      secondary={<Typography variant="caption" sx={{ color: cc.fgMuted }}>
                        <Box component="span" sx={{ color: workflowTypeColor(w.workflow_type), fontWeight: 600 }}>{w.workflow_type}</Box> · {w.current_stage}
                        {w.due_date ? ` · ${tr('dashboard.dueOn', { date: formatDate(w.due_date) })}` : ''}
                      </Typography>} />
                  </ListItemButton>
                ))}
              </List>
            )}
          </CardContent></Card>
        </Grid>
        {mods.map((m, i) => {
          const live = pct(m.live, m.total);
          const bar = (value: number) => (
            <LinearProgress variant="determinate" value={value} sx={{ height: 8, borderRadius: 4, bgcolor: alpha(colorOf(i), 0.15), '& .MuiLinearProgress-bar': { bgcolor: colorOf(i), borderRadius: 4 } }} />
          );
          return (
            <Grid key={m.id} size={{ xs: 12, md: Math.max(3, Math.floor(8 / mods.length)) }}>
              <Card sx={{ height: '100%' }}><CardContent>
                <Typography variant="body2" sx={{ color: cc.fgMuted, fontSize: '0.75rem', mb: 1 }}>{tr('dashboard.qualityOf', { module: nameOf(m) })}</Typography>
                <Typography variant="h4" sx={{ color: cc.fg, mb: 0.5 }}>{m.avg_dq_score.toFixed(1)}%</Typography>
                {bar(m.avg_dq_score)}
                <Typography variant="caption" sx={{ color: cc.fgMuted, mt: 1, mb: 1.5, display: 'block' }}>{tr('dashboard.completenessV0', { v0: m.avg_completeness.toFixed(1) })}</Typography>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                  <Typography variant="body2" sx={{ fontSize: '0.8rem', color: cc.fg }}>{tr('dashboard.liveRate', { stage: m.live_stage })}</Typography>
                  <Typography variant="body2" sx={{ fontSize: '0.8rem', fontWeight: 600, color: cc.fg }}>{live}%</Typography>
                </Box>
                {bar(live)}
              </CardContent></Card>
            </Grid>
          );
        })}
      </Grid>

      {/* Row 3: charts driven by each module's lifecycle, country and filters */}
      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        {charts.map(c => (
          <Grid key={c.key} size={{ xs: 12, md: 6, lg: 4 }}>
            <Card sx={{ height: '100%' }}><CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, '& svg': { color: c.color, fontSize: 20 } }}>
                {c.icon}
                <Typography variant="h6" sx={{ fontSize: '0.95rem' }}>{c.title}</Typography>
              </Box>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={c.rows} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke={cc.gridStroke} />
                  <XAxis type="number" stroke={cc.axisStroke} fontSize={12} allowDecimals={false} />
                  <YAxis dataKey="label" type="category" width={100} stroke={cc.axisStroke} fontSize={11} />
                  <Tooltip cursor={cc.tooltipCursor} contentStyle={cc.tooltipStyle} labelStyle={cc.tooltipLabelStyle} itemStyle={cc.tooltipItemStyle} />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]} {...cc.barHover} cursor="pointer" onClick={(d: BarClick) => navigate(String(d.payload?.link ?? '/'))}>
                    {c.rows.map((r, i) => <Cell key={i} fill={r.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent></Card>
          </Grid>
        ))}
      </Grid>

      {/* Row 5: DQ Rules + Activity + Recent Changes */}
      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, md: 4 }}>
          <Card sx={{ height: '100%' }}><CardContent>
            <Typography variant="h6" sx={{ fontSize: '0.95rem', mb: 2 }}>{tr('dashboard.dqRulesPassRatesBy')}</Typography>
            {stats.dq_by_type.length === 0 ? (
              <Typography variant="body2" sx={{ color: cc.fgMuted }}>{tr('dashboard.noDqRulesHaveBeen')}</Typography>
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {stats.dq_by_type.map((rule) => (
                  <Box key={rule.rule_type}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                      <Typography variant="body2" sx={{ fontSize: '0.8rem', color: cc.fg }}>{rule.rule_type}</Typography>
                      <Typography variant="body2" sx={{ fontSize: '0.8rem', fontWeight: 600, color: rule.pass_rate >= 80 ? statusColors().success : rule.pass_rate >= 50 ? statusColors().warning : statusColors().error }}>
                        {rule.pass_rate}%
                      </Typography>
                    </Box>
                    <LinearProgress variant="determinate" value={rule.pass_rate} sx={{
                      height: 6, borderRadius: 3,
                      bgcolor: alpha(rule.pass_rate >= 80 ? statusColors().success : rule.pass_rate >= 50 ? statusColors().warning : statusColors().error, 0.15),
                      '& .MuiLinearProgress-bar': { bgcolor: rule.pass_rate >= 80 ? statusColors().success : rule.pass_rate >= 50 ? statusColors().warning : statusColors().error, borderRadius: 3 }
                    }} />
                    <Typography variant="caption" sx={{ color: cc.fgMuted }}>{tr('dashboard.rulesCount', { count: rule.rule_count })}</Typography>
                  </Box>
                ))}
              </Box>
            )}
          </CardContent></Card>
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <Card sx={{ height: '100%' }}><CardContent>
            <Typography variant="h6" sx={{ fontSize: '0.95rem', mb: 2 }}>{tr('dashboard.activityLast30d')}</Typography>
            {!hasActivity ? (
              <Typography variant="body2" sx={{ color: cc.fgMuted }}>{tr('dashboard.noActivityRecordedYet')}</Typography>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={trends.activity}>
                  <CartesianGrid strokeDasharray="3 3" stroke={cc.gridStroke} vertical={false} />
                  <XAxis dataKey="day" stroke={cc.axisStroke} fontSize={10} tickFormatter={(d: string) => d.slice(8)} interval={4} />
                  <YAxis stroke={cc.axisStroke} fontSize={11} allowDecimals={false} width={30} />
                  <Tooltip cursor={cc.tooltipCursor} contentStyle={cc.tooltipStyle} labelStyle={cc.tooltipLabelStyle} itemStyle={cc.tooltipItemStyle} labelFormatter={(d: string) => formatDate(d)} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="INSERT" name={tr('dashboard.created')} stackId="a" fill={actionColor('INSERT')} cursor="pointer" onClick={() => navigate('/audit')} />
                  <Bar dataKey="UPDATE" name={tr('dashboard.updated')} stackId="a" fill={actionColor('UPDATE')} cursor="pointer" onClick={() => navigate('/audit')} />
                  <Bar dataKey="DELETE" name={tr('dashboard.deleted')} stackId="a" fill={actionColor('DELETE')} radius={[3, 3, 0, 0]} cursor="pointer" onClick={() => navigate('/audit')} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent></Card>
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <Card sx={{ height: '100%' }}><CardContent>
            <Typography variant="h6" sx={{ fontSize: '0.95rem', mb: 2 }}>{tr('dashboard.recentChanges')}</Typography>
            <List disablePadding>
              {audit.slice(0, 8).map((entry) => (
                <ListItem key={entry.id} disablePadding sx={{ mb: 1.5 }}>
                  <ListItemText
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Chip label={entry.action} size="small" sx={actionChipSx(entry.action)} />
                        <Typography variant="body2" sx={{ color: cc.fg, fontSize: '0.8rem', fontWeight: 500 }}><RecordLink type={entry.entity_type} id={entry.entity_id}>{entry.entity_name || entry.entity_id}</RecordLink></Typography>
                      </Box>
                    }
                    secondary={<Typography variant="caption" sx={{ color: cc.fgMuted }}><UserLink email={entry.performed_by}>{entry.performed_by}</UserLink> — {formatDate(entry.performed_at, true)}</Typography>}
                  />
                </ListItem>
              ))}
            </List>
          </CardContent></Card>
        </Grid>
      </Grid>
    </Box>
  );
}
