import { Chip, alpha } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { STAGE_COLORS } from '../types/models';

import { statusColors } from '../theme/brandColors';
/** Lifecycle stage chip; the label is translated (stages.<CODE>), the color keyed by code. */
export default function StageChip({ stage }: { stage: string }) {
  const { t } = useTranslation();
  const color = STAGE_COLORS[stage] ?? statusColors().neutral;
  return (
    <Chip
      label={t(`stages.${stage}`, { defaultValue: stage.replace(/_/g, ' ') })}
      size="small"
      sx={{
        bgcolor: alpha(color, 0.15),
        color,
        fontWeight: 600,
        fontSize: '0.7rem',
        borderRadius: 1.5,
        textTransform: 'uppercase',
      }}
    />
  );
}
