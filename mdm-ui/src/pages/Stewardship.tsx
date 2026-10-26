import { useState, useEffect } from 'react';
import {
  Box, Typography, Card, CardContent, Grid2 as Grid, Chip, alpha, useTheme,
  CircularProgress, List, ListItem, ListItemText, ListItemIcon, Avatar,
} from '@mui/material';
import AssignmentIcon from '@mui/icons-material/Assignment';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import JoinInnerIcon from '@mui/icons-material/JoinInner';
import EditIcon from '@mui/icons-material/Edit';
import AddIcon from '@mui/icons-material/Add';
import PriorityHighIcon from '@mui/icons-material/PriorityHigh';
import TimelineIcon from '@mui/icons-material/Timeline';
import { useUser, getCurrentUserEmail } from '../context/UserContext';
import { useBrand } from '../config/BrandContext';
import { RecordLink, WorkflowLink } from '../components/common/Links';
import i18n, { tr } from '../i18n';

import { liveColors, priorityColor as priorityOf, workflowTypeColor, statusColors, seriesColor } from '../theme/brandColors';
type Workflow = { id: number; entity_type: string; entity_id: string; workflow_type: string; current_stage: string; priority: string; entity_name: string; notes: string; created_at: string };
type DqFailure = { entity_type: string; entity_id: string; entity_name: string; rule_name: string; severity: string; dq_score: number };
type Activity = { entity_type: string; action: string; entity_name: string; performed_at: string; changed_fields: Record<string, unknown> };
type KPIs = { open_tasks: number; total_open_tasks: number; my_updates_30d: number; total_updates_30d: number; my_records_created: number; my_merges: number; high_priority: number };
type StewData = { user: string; kpis: KPIs; my_workflows: Workflow[]; dq_failures: DqFailure[]; recent_activity: Activity[] };

const priorityColor = liveColors(['HIGH', 'MEDIUM', 'LOW'], priorityOf);
const typeColor = liveColors(['ONBOARDING', 'ENRICHMENT', 'MERGE', 'DEACTIVATION'], workflowTypeColor);

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  const rtf = new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto', style: 'short' });
  if (mins < 60) return rtf.format(-mins, 'minute');
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return rtf.format(-hrs, 'hour');
  return rtf.format(-Math.floor(hrs / 24), 'day');
}

export default function Stewardship() {
  const theme = useTheme();
  const brand = useBrand();
  const { currentUser } = useUser();
  const isDark = theme.palette.mode === 'dark';
  const fgMuted = theme.palette.text.secondary;
  const p = brand.palette;

  const [data, setData] = useState<StewData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const email = getCurrentUserEmail();
    fetch(`/api/stewardship?user=${encodeURIComponent(email)}`)
      .then(r => r.json())
      .then((d: StewData) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [currentUser]);

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>;
  if (!data) return <Typography sx={{ p: 3 }}>{tr('stewardship.failedToLoadStewardshipData')}</Typography>;

  const k = data.kpis;

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" gutterBottom>{tr('stewardship.myStewardship')}</Typography>
        <Typography variant="subtitle1">
          {tr('stewardship.welcome', { name: currentUser?.display_name || data.user })}
        </Typography>
      </Box>

      {/* KPI cards */}
      <Grid container spacing={2} sx={{ mb: 3, '& > .MuiGrid2-root': { display: 'flex' } }}>
        <Grid size={{ xs: 6, sm: 4, md: 2 }}>
          <Card sx={{ flex: 1, borderLeft: `3px solid ${p.primary}` }}><CardContent sx={{ textAlign: 'center', py: 1.5, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <Typography variant="caption" sx={{ color: fgMuted }}>{tr('stewardship.myOpenTasks')}</Typography>
            <Typography variant="h4" sx={{ fontWeight: 700, color: p.primary }}>{k.open_tasks}</Typography>
            <Typography variant="caption" sx={{ color: fgMuted }}>{tr('stewardship.ofTotalOpenTasksTotal', { total_open_tasks: k.total_open_tasks })}</Typography>
          </CardContent></Card>
        </Grid>
        <Grid size={{ xs: 6, sm: 4, md: 2 }}>
          <Card sx={{ flex: 1, borderLeft: '3px solid ${statusColors().error}' }}><CardContent sx={{ textAlign: 'center', py: 1.5, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <Typography variant="caption" sx={{ color: fgMuted }}>{tr('stewardship.highPriority')}</Typography>
            <Typography variant="h4" sx={{ fontWeight: 700, color: statusColors().error }}>{k.high_priority}</Typography>
            <Typography variant="caption" sx={{ color: fgMuted }}>{tr('stewardship.needsAttention')}</Typography>
          </CardContent></Card>
        </Grid>
        <Grid size={{ xs: 6, sm: 4, md: 2 }}>
          <Card sx={{ flex: 1, borderLeft: '3px solid ${statusColors().warning}' }}><CardContent sx={{ textAlign: 'center', py: 1.5, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <Typography variant="caption" sx={{ color: fgMuted }}>{tr('stewardship.myEdits30d')}</Typography>
            <Typography variant="h4" sx={{ fontWeight: 700, color: statusColors().warning }}>{k.my_updates_30d}</Typography>
            <Typography variant="caption" sx={{ color: fgMuted }}>{tr('stewardship.ofTotalUpdates30dTotal', { total_updates_30d: k.total_updates_30d })}</Typography>
          </CardContent></Card>
        </Grid>
        <Grid size={{ xs: 6, sm: 4, md: 2 }}>
          <Card sx={{ flex: 1, borderLeft: '3px solid ${statusColors().success}' }}><CardContent sx={{ textAlign: 'center', py: 1.5, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <Typography variant="caption" sx={{ color: fgMuted }}>{tr('stewardship.recordsCreated')}</Typography>
            <Typography variant="h4" sx={{ fontWeight: 700, color: statusColors().success }}>{k.my_records_created}</Typography>
            <Typography variant="caption" sx={{ color: fgMuted }}>{tr('stewardship.last30Days')}</Typography>
          </CardContent></Card>
        </Grid>
        <Grid size={{ xs: 6, sm: 4, md: 2 }}>
          <Card sx={{ flex: 1, borderLeft: '3px solid ${seriesColor(1)}' }}><CardContent sx={{ textAlign: 'center', py: 1.5, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <Typography variant="caption" sx={{ color: fgMuted }}>{tr('stewardship.mergesPerformed')}</Typography>
            <Typography variant="h4" sx={{ fontWeight: 700, color: seriesColor(1) }}>{k.my_merges}</Typography>
            <Typography variant="caption" sx={{ color: fgMuted }}>{tr('stewardship.allTime')}</Typography>
          </CardContent></Card>
        </Grid>
        <Grid size={{ xs: 6, sm: 4, md: 2 }}>
          <Card sx={{ flex: 1, borderLeft: `3px solid ${p.accent}` }}><CardContent sx={{ textAlign: 'center', py: 1.5, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <Typography variant="caption" sx={{ color: fgMuted }}>{tr('stewardship.contribution')}</Typography>
            <Typography variant="h4" sx={{ fontWeight: 700, color: p.accent }}>{k.total_updates_30d > 0 ? Math.round((k.my_updates_30d / k.total_updates_30d) * 100) : 0}%</Typography>
            <Typography variant="caption" sx={{ color: fgMuted }}>{tr('stewardship.ofAllEdits')}</Typography>
          </CardContent></Card>
        </Grid>
      </Grid>

      <Grid container spacing={3}>
        {/* My Tasks */}
        <Grid size={{ xs: 12, md: 7 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <AssignmentIcon sx={{ color: p.primary }} />
                <Typography variant="h6" sx={{ fontSize: '0.95rem' }}>{tr('stewardship.myOpenTasksLength', { length: data.my_workflows.length })}</Typography>
              </Box>
              {data.my_workflows.length === 0 ? (
                <Box sx={{ textAlign: 'center', py: 4 }}>
                  <CheckCircleIcon sx={{ fontSize: 48, color: statusColors().success, mb: 1 }} />
                  <Typography sx={{ color: fgMuted }}>{tr('stewardship.allCaughtUpNoPending')}</Typography>
                </Box>
              ) : (
                <List disablePadding>
                  {data.my_workflows.map(w => (
                    <ListItem key={w.id} sx={{ px: 1, py: 1, borderRadius: 1, mb: 0.5, bgcolor: alpha(isDark ? '#fff' : '#000', 0.02) }}>
                      <ListItemIcon sx={{ minWidth: 36 }}>
                        <Avatar sx={{ width: 28, height: 28, bgcolor: alpha(typeColor[w.workflow_type] || statusColors().neutral, 0.15), color: typeColor[w.workflow_type] || statusColors().neutral, fontSize: '0.7rem' }}>
                          {w.workflow_type === 'MERGE' ? <JoinInnerIcon sx={{ fontSize: 16 }} /> : <AssignmentIcon sx={{ fontSize: 16 }} />}
                        </Avatar>
                      </ListItemIcon>
                      <ListItemText
                        primary={
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography variant="body2" sx={{ fontWeight: 600 }}><WorkflowLink id={w.id}>{w.entity_name || w.entity_id}</WorkflowLink></Typography>
                            <Chip label={w.workflow_type} size="small" sx={{ fontSize: '0.6rem', height: 18, bgcolor: alpha(typeColor[w.workflow_type] || statusColors().neutral, 0.15), color: typeColor[w.workflow_type] || statusColors().neutral }} />
                            <Chip label={w.priority} size="small" sx={{ fontSize: '0.6rem', height: 18, bgcolor: alpha(priorityColor[w.priority] || statusColors().neutral, 0.15), color: priorityColor[w.priority] || statusColors().neutral }} />
                          </Box>
                        }
                        secondary={
                          <Typography variant="caption" sx={{ color: fgMuted }}>{w.entity_type} · {w.current_stage} · {w.notes || tr('stewardship.noNotes')}</Typography>
                        }
                      />
                      <Typography variant="caption" sx={{ color: fgMuted, whiteSpace: 'nowrap' }}>{timeAgo(w.created_at)}</Typography>
                    </ListItem>
                  ))}
                </List>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Right column: DQ failures + Activity */}
        <Grid size={{ xs: 12, md: 5 }}>
          {/* DQ Failures */}
          <Card sx={{ mb: 2 }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <WarningAmberIcon sx={{ color: statusColors().warning }} />
                <Typography variant="h6" sx={{ fontSize: '0.95rem' }}>{tr('stewardship.dqFailuresLength', { length: data.dq_failures.length })}</Typography>
              </Box>
              {data.dq_failures.length === 0 ? (
                <Typography variant="body2" sx={{ color: fgMuted, textAlign: 'center', py: 2 }}>{tr('stewardship.noDqFailuresRunDq')}</Typography>
              ) : (
                <List disablePadding>
                  {data.dq_failures.map((f, i) => (
                    <ListItem key={i} sx={{ px: 1, py: 0.75 }}>
                      <ListItemIcon sx={{ minWidth: 28 }}>
                        <PriorityHighIcon sx={{ fontSize: 16, color: f.severity === 'ERROR' ? statusColors().error : statusColors().warning }} />
                      </ListItemIcon>
                      <ListItemText
                        primary={<Typography variant="body2" sx={{ fontWeight: 600 }}><RecordLink type={f.entity_type} id={f.entity_id}>{f.entity_name || f.entity_id}</RecordLink></Typography>}
                        secondary={<Typography variant="caption" sx={{ color: fgMuted }}>{tr('stewardship.ruleNameDqDqScore', { rule_name: f.rule_name, dq_score: f.dq_score })}</Typography>}
                      />
                      <Chip label={f.entity_type} size="small" sx={{ fontSize: '0.55rem', height: 16 }} />
                    </ListItem>
                  ))}
                </List>
              )}
            </CardContent>
          </Card>

          {/* Recent Activity */}
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <TimelineIcon sx={{ color: p.accent }} />
                <Typography variant="h6" sx={{ fontSize: '0.95rem' }}>{tr('stewardship.myRecentActivity')}</Typography>
              </Box>
              {data.recent_activity.length === 0 ? (
                <Typography variant="body2" sx={{ color: fgMuted, textAlign: 'center', py: 2 }}>{tr('stewardship.noRecentActivityRecorded')}</Typography>
              ) : (
                <List disablePadding>
                  {data.recent_activity.map((a, i) => (
                    <ListItem key={i} sx={{ px: 1, py: 0.5 }}>
                      <ListItemIcon sx={{ minWidth: 28 }}>
                        {a.action === 'INSERT' ? <AddIcon sx={{ fontSize: 16, color: statusColors().success }} /> :
                         a.action === 'UPDATE' ? <EditIcon sx={{ fontSize: 16, color: statusColors().warning }} /> :
                         <EditIcon sx={{ fontSize: 16, color: fgMuted }} />}
                      </ListItemIcon>
                      <ListItemText
                        primary={<Typography variant="body2">{a.action} — {a.entity_name || a.entity_type}</Typography>}
                        secondary={<Typography variant="caption" sx={{ color: fgMuted }}>{timeAgo(a.performed_at)}</Typography>}
                      />
                    </ListItem>
                  ))}
                </List>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}
