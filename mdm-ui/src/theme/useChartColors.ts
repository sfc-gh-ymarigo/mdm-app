import { createElement } from 'react';
import { Rectangle } from 'recharts';
import { useTheme, alpha } from '@mui/material/styles';

/** Hovered bar: full opacity + glow in its own color (replaces the default grey cursor band). */
const activeBar = (props: any) => createElement(Rectangle, {
  ...props,
  fillOpacity: 1,
  style: { filter: `drop-shadow(0 0 6px ${alpha(props.fill || '#888', 0.7)})`, transition: 'filter 0.15s' },
});
import { useBrand } from '../config/BrandContext';
import { chartSeries, DEFAULT_CHARTS, DEFAULT_STATUS } from './brandColors';

export function useChartColors() {
  const theme = useTheme();
  const brand = useBrand();
  const isDark = theme.palette.mode === 'dark';
  const cardBg = isDark ? (brand.darkBackground?.card || theme.palette.background.paper) : '#FFFFFF';
  const primaryAlpha = isDark ? 'rgba(255,255,255,0.1)' : alpha(brand.palette.primary, 0.12);

  return {
    isDark,
    fg: theme.palette.text.primary,
    fgMuted: theme.palette.text.secondary,
    gridStroke: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
    axisStroke: isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.35)',
    tooltipBg: cardBg,
    tooltipBorder: primaryAlpha,
    tooltipStyle: {
      backgroundColor: cardBg,
      border: `1px solid ${primaryAlpha}`,
      borderRadius: 8,
      color: isDark ? '#fff' : '#1A1A2E',
    },
    tooltipLabelStyle: {
      color: isDark ? '#fff' : '#1A1A2E',
      fontWeight: 600,
    },
    tooltipItemStyle: {
      color: isDark ? 'rgba(255,255,255,0.85)' : '#1A1A2E',
    },
    /** Spread on <Tooltip>: disables the background hover band */
    tooltipCursor: false as const,
    /** Spread on <Bar>: highlights the hovered bar instead */
    barHover: { activeBar, fillOpacity: 0.8 },
    cardBg,
    drawerBg: isDark ? (brand.darkBackground?.paper || theme.palette.background.paper) : '#F8F8FC',
    divider: theme.palette.divider,
    chipBg: (color: string, opacity = 0.15) => alpha(color, opacity),
    alpha: (color: string, opacity: number) => alpha(color, opacity),
    /** n chart series colors from the branding (categorical list or monochrome shades) */
    series: (n: number) => chartSeries(brand.charts || DEFAULT_CHARTS, n),
    status: brand.status || DEFAULT_STATUS,
  };
}
