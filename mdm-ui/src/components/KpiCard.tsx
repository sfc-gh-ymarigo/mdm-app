import { Card, CardActionArea, CardContent, Typography, Box, alpha, useTheme } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';

import { statusColors } from '../theme/brandColors';
interface Props {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: ReactNode;
  color: string;
  trend?: string;
  /** Trend text color; defaults to success for '+…', error otherwise */
  trendColor?: string;
  /** Route opened when the card is clicked */
  to?: string;
}

export default function KpiCard({ title, value, subtitle, icon, color, trend, trendColor, to }: Props) {
  const navigate = useNavigate();
  const theme = useTheme();
  const fg = theme.palette.text.primary;
  const fgMuted = theme.palette.text.secondary;

  return (
    <Card
      sx={{
        height: '100%',
        borderRadius: '20px',
        borderLeft: `4px solid ${color}`,
      }}
    >
      <CardActionArea disabled={!to} onClick={() => to && navigate(to)} sx={{ height: '100%' }}>
      <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Box>
            <Typography variant="body2" sx={{ color: fgMuted, fontSize: '0.75rem', mb: 0.5 }}>
              {title}
            </Typography>
            <Typography variant="h4" sx={{ color: fg, fontSize: '1.75rem' }}>
              {value}
            </Typography>
            {subtitle && (
              <Typography variant="caption" sx={{ color: fgMuted, mt: 0.5, display: 'block' }}>
                {subtitle}
              </Typography>
            )}
            {trend && (
              <Typography variant="caption" sx={{ color: trendColor || (trend.startsWith('+') ? statusColors().success : statusColors().error), fontWeight: 600, mt: 0.5, display: 'block' }}>
                {trend}
              </Typography>
            )}
          </Box>
          <Box sx={{ p: 1, borderRadius: '50%', bgcolor: alpha(color, 0.1), color }}>
            {icon}
          </Box>
        </Box>
      </CardContent>
      </CardActionArea>
    </Card>
  );
}
