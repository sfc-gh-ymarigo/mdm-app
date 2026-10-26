import { Box } from '@mui/material';

/** Tab label with an inline count pill. Inline (not a floating Badge) so tabs never clip it. */
export default function TabCount({ label, count, color = 'primary', max = 999 }: {
  label: string;
  count: number;
  color?: 'primary' | 'warning';
  max?: number;
}) {
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
      {label}
      <Box component="span" sx={{
        minWidth: 22, height: 20, px: 0.75, borderRadius: 10,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '0.7rem', fontWeight: 600, lineHeight: 1,
        bgcolor: `${color}.main`, color: `${color}.contrastText`,
        opacity: count > 0 ? 1 : 0.5,
      }}>
        {count > max ? `${max}+` : count}
      </Box>
    </Box>
  );
}
