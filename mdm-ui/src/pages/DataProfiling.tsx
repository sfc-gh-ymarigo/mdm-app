import { useState, useEffect } from 'react';
import {
  Box, Typography, Card, CardContent, Grid2 as Grid, Tabs, Tab,
  CircularProgress, alpha, useTheme, Chip, LinearProgress, Tooltip, Button,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer, Cell } from 'recharts';
import { useChartColors } from '../theme/useChartColors';
import { useBrand } from '../config/BrandContext';
import { localized, tr } from '../i18n';

import { statusColors, seriesColor } from '../theme/brandColors';
type TopValue = { value: string; count: number };
type Pattern = { pattern: string; count: number };
type NumericStats = { min_val: number; max_val: number; avg_val: number; median_val: number; stddev_val: number };
type ColumnProfile = {
  column: string; total_rows: number; non_null: number; null_count: number; null_pct: number;
  distinct_count: number; uniqueness_pct: number; min_length: number; max_length: number; avg_length: number;
  top_values: TopValue[]; patterns: Pattern[]; numeric_stats: NumericStats | null;
};
type ProfilingResult = { entity_type: string; total_records: number; columns: ColumnProfile[]; computed_at?: string; cached?: boolean };


function qualityColor(nullPct: number): string {
  if (nullPct === 0) return statusColors().success;
  if (nullPct < 10) return statusColors().success;
  if (nullPct < 30) return statusColors().warning;
  if (nullPct < 60) return seriesColor(7);
  return statusColors().error;
}

export default function DataProfiling() {
  const theme = useTheme();
  const cc = useChartColors();
  const COLORS = cc.series(10);
  const isDark = theme.palette.mode === 'dark';
  const fgMuted = theme.palette.text.secondary;
  const brand = useBrand();
  const modules = brand.modules.filter(m => m.enabled);

  const [tab, setTab] = useState(0);
  const entityType = modules[tab]?.id.toUpperCase() ?? 'CUSTOMER';
  const [data, setData] = useState<ProfilingResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    setLoading(true);
    // Served from the API cache unless the data changed; reload forces a recompute
    fetch(`/api/profiling/${entityType}${reload ? '?refresh=1' : ''}`)
      .then(r => r.json())
      .then((d: ProfilingResult) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [entityType, reload]);

  if (modules.length === 0) return <Box sx={{ p: 3 }}><Typography variant="h4" sx={{ fontWeight: 700 }}>{tr('dataProfiling.dataProfiling')}</Typography><Typography sx={{ mt: 2, color: fgMuted }}>{tr('dataProfiling.noEntityModulesAreEnabled')}</Typography></Box>;

  const overallCompleteness = data
    ? Math.round(data.columns.reduce((sum, c) => sum + (100 - c.null_pct), 0) / data.columns.length)
    : 0;

  return (
    <Box>
      <Box sx={{ mb: 3, display: 'flex', alignItems: 'flex-start', gap: 2 }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h4" gutterBottom>{tr('dataProfiling.dataProfiling')}</Typography>
          <Typography variant="subtitle1">{tr('dataProfiling.columnLevelStatisticsPatternsAnd')}</Typography>
        </Box>
        <Box sx={{ textAlign: 'right' }}>
          <Button size="small" variant="outlined" startIcon={<RefreshIcon />} disabled={loading} onClick={() => setReload(r => r + 1)}>
            {tr('dataProfiling.recompute')}
          </Button>
          {data?.computed_at && (
            <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: fgMuted }}>
              {tr('dataProfiling.computedAt', { time: new Date(data.computed_at).toLocaleString() })}
            </Typography>
          )}
        </Box>
      </Box>

      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs value={tab} onChange={(_, v) => { setTab(v); setReload(0); }}>
          {modules.map(m => <Tab key={m.id} label={localized(m.label, m.labels)} />)}
        </Tabs>
      </Box>

      {loading && <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>}

      {data && !loading && (
        <>
          {/* Summary cards */}
          <Grid container spacing={2} sx={{ mb: 3 }}>
            <Grid size={{ xs: 6, md: 3 }}>
              <Card><CardContent sx={{ textAlign: 'center' }}>
                <Typography variant="body2" sx={{ color: fgMuted, mb: 0.5 }}>{tr('dataProfiling.records')}</Typography>
                <Typography variant="h4" sx={{ fontWeight: 700 }}>{data.total_records}</Typography>
              </CardContent></Card>
            </Grid>
            <Grid size={{ xs: 6, md: 3 }}>
              <Card><CardContent sx={{ textAlign: 'center' }}>
                <Typography variant="body2" sx={{ color: fgMuted, mb: 0.5 }}>{tr('dataProfiling.columnsProfiled')}</Typography>
                <Typography variant="h4" sx={{ fontWeight: 700 }}>{data.columns.length}</Typography>
              </CardContent></Card>
            </Grid>
            <Grid size={{ xs: 6, md: 3 }}>
              <Card><CardContent sx={{ textAlign: 'center' }}>
                <Typography variant="body2" sx={{ color: fgMuted, mb: 0.5 }}>{tr('dataProfiling.overallFillRate')}</Typography>
                <Typography variant="h4" sx={{ fontWeight: 700, color: qualityColor(100 - overallCompleteness) }}>{overallCompleteness}%</Typography>
              </CardContent></Card>
            </Grid>
            <Grid size={{ xs: 6, md: 3 }}>
              <Card><CardContent sx={{ textAlign: 'center' }}>
                <Typography variant="body2" sx={{ color: fgMuted, mb: 0.5 }}>{tr('dataProfiling.columnsWithNulls')}</Typography>
                <Typography variant="h4" sx={{ fontWeight: 700, color: statusColors().warning }}>{data.columns.filter(c => c.null_count > 0).length}</Typography>
              </CardContent></Card>
            </Grid>
          </Grid>

          {/* Completeness overview chart */}
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="h6" sx={{ fontSize: '0.95rem', mb: 2 }}>{tr('dataProfiling.fillRateByColumn')}</Typography>
              <ResponsiveContainer width="100%" height={Math.max(280, data.columns.length * 26 + 40)}>
                <BarChart data={data.columns.map(c => ({ name: c.column.replace(/_/g, ' '), fill_rate: Math.round(100 - c.null_pct), fill: qualityColor(c.null_pct) }))} layout="vertical" margin={{ left: 10, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={cc.gridStroke} />
                  <XAxis type="number" domain={[0, 100]} stroke={cc.axisStroke} fontSize={12} />
                  <YAxis type="category" dataKey="name" stroke={cc.axisStroke} fontSize={11} width={110} interval={0} />
                  <RTooltip cursor={cc.tooltipCursor} contentStyle={cc.tooltipStyle} labelStyle={cc.tooltipLabelStyle} itemStyle={cc.tooltipItemStyle} formatter={(v: number) => `${v}%`} />
                  <Bar dataKey="fill_rate" radius={[0, 4, 4, 0]} {...cc.barHover}>
                    {data.columns.map((c, i) => <Cell key={i} fill={qualityColor(c.null_pct)} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Column detail cards */}
          <Grid container spacing={2}>
            {data.columns.map((col, idx) => (
              <Grid key={col.column} size={{ xs: 12, md: 6, lg: 4 }}>
                <Card sx={{ height: '100%' }}>
                  <CardContent>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700, fontFamily: 'monospace', fontSize: '0.85rem' }}>{col.column}</Typography>
                      <Chip
                        label={col.numeric_stats ? 'NUMERIC' : 'TEXT'}
                        size="small"
                        sx={{ fontSize: '0.6rem', bgcolor: alpha(col.numeric_stats ? seriesColor(1) : seriesColor(0), 0.15), color: col.numeric_stats ? seriesColor(1) : seriesColor(0) }}
                      />
                    </Box>

                    {/* Fill rate bar */}
                    <Box sx={{ mb: 1.5 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                        <Typography variant="caption" sx={{ color: fgMuted }}>{tr('dataProfiling.fillRate')}</Typography>
                        <Typography variant="caption" sx={{ fontWeight: 600, color: qualityColor(col.null_pct) }}>{Math.round(100 - col.null_pct)}%</Typography>
                      </Box>
                      <LinearProgress
                        variant="determinate"
                        value={100 - col.null_pct}
                        sx={{
                          height: 6, borderRadius: 3,
                          bgcolor: alpha(isDark ? '#fff' : '#000', 0.08),
                          '& .MuiLinearProgress-bar': { bgcolor: qualityColor(col.null_pct), borderRadius: 3 },
                        }}
                      />
                    </Box>

                    {/* Stats grid */}
                    <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.5, mb: 1.5 }}>
                      <Tooltip title={tr('dataProfiling.nonNullValues')}><Box><Typography variant="caption" sx={{ color: fgMuted }}>{tr('dataProfiling.filled')}</Typography><Typography variant="body2" sx={{ fontWeight: 600 }}>{col.non_null} / {col.total_rows}</Typography></Box></Tooltip>
                      <Tooltip title={tr('dataProfiling.distinctValues')}><Box><Typography variant="caption" sx={{ color: fgMuted }}>{tr('dataProfiling.distinct')}</Typography><Typography variant="body2" sx={{ fontWeight: 600 }}>{col.distinct_count} ({col.uniqueness_pct}%)</Typography></Box></Tooltip>
                      {col.numeric_stats ? (
                        <>
                          <Box><Typography variant="caption" sx={{ color: fgMuted }}>{tr('dataProfiling.minMax')}</Typography><Typography variant="body2" sx={{ fontWeight: 600 }}>{col.numeric_stats.min_val} — {col.numeric_stats.max_val}</Typography></Box>
                          <Box><Typography variant="caption" sx={{ color: fgMuted }}>{tr('dataProfiling.avgMedian')}</Typography><Typography variant="body2" sx={{ fontWeight: 600 }}>{col.numeric_stats.avg_val} / {col.numeric_stats.median_val}</Typography></Box>
                        </>
                      ) : (
                        <>
                          <Box><Typography variant="caption" sx={{ color: fgMuted }}>{tr('dataProfiling.lengthMinMax')}</Typography><Typography variant="body2" sx={{ fontWeight: 600 }}>{col.min_length ?? '—'} — {col.max_length ?? '—'}</Typography></Box>
                          <Box><Typography variant="caption" sx={{ color: fgMuted }}>{tr('dataProfiling.avgLength')}</Typography><Typography variant="body2" sx={{ fontWeight: 600 }}>{col.avg_length ?? '—'}</Typography></Box>
                        </>
                      )}
                    </Box>

                    {/* Top values */}
                    {col.top_values.length > 0 && (
                      <Box>
                        <Typography variant="caption" sx={{ color: fgMuted, fontWeight: 600, display: 'block', mb: 0.5 }}>{tr('dataProfiling.topValues')}</Typography>
                        {col.top_values.slice(0, 4).map((tv, i) => (
                          <Box key={i} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.25 }}>
                            <Typography variant="caption" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>{tv.value}</Typography>
                            <Chip label={tv.count} size="small" sx={{ height: 18, fontSize: '0.65rem', bgcolor: alpha(COLORS[idx % COLORS.length], 0.15), color: COLORS[idx % COLORS.length] }} />
                          </Box>
                        ))}
                      </Box>
                    )}

                    {/* Patterns */}
                    {col.patterns.length > 0 && (
                      <Box sx={{ mt: 1 }}>
                        <Typography variant="caption" sx={{ color: fgMuted, fontWeight: 600, display: 'block', mb: 0.5 }}>{tr('dataProfiling.patterns')}</Typography>
                        {col.patterns.slice(0, 3).map((p, i) => (
                          <Box key={i} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.25 }}>
                            <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: '0.7rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>{p.pattern}</Typography>
                            <Typography variant="caption" sx={{ color: fgMuted }}>{p.count}</Typography>
                          </Box>
                        ))}
                      </Box>
                    )}
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        </>
      )}
    </Box>
  );
}
