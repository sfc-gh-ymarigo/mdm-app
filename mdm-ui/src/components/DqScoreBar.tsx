import { Box, LinearProgress, Typography, alpha, useTheme } from '@mui/material';

import { statusColors } from '../theme/brandColors';
interface Props {
  value: number | null;
  label?: string;
}

export default function DqScoreBar({ value, label }: Props) {
  const theme = useTheme();
  const v = typeof value === 'string' ? parseFloat(value) || 0 : value ?? 0;
  const color = v >= 80 ? statusColors().success : v >= 60 ? statusColors().warning : statusColors().error;
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 120 }}>
      <LinearProgress
        variant="determinate"
        value={v}
        sx={{
          flex: 1,
          height: 6,
          borderRadius: 3,
          bgcolor: alpha(color, 0.15),
          '& .MuiLinearProgress-bar': { bgcolor: color, borderRadius: 3 },
        }}
      />
      <Typography variant="caption" sx={{ fontWeight: 600, color, minWidth: 36, textAlign: 'right' }}>
        {v.toFixed(0)}%
      </Typography>
      {label && (
        <Typography variant="caption" sx={{ color: theme.palette.text.secondary }}>
          {label}
        </Typography>
      )}
    </Box>
  );
}
