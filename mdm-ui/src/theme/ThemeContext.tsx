import { createContext, useContext, useState, useMemo, type ReactNode } from 'react';
import { ThemeProvider as MuiThemeProvider, createTheme } from '@mui/material/styles';
import { frFR as materialFr, enUS as materialEn } from '@mui/material/locale';
import { frFR as gridFr, enUS as gridEn } from '@mui/x-data-grid/locales';
import i18n from '../i18n';
import CssBaseline from '@mui/material/CssBaseline';
import { createDarkTheme, createLightTheme } from './theme';
import { setBrandColors } from './brandColors';
import { useBrand } from '../config/BrandContext';

type Mode = 'dark' | 'light';

interface ThemeCtx {
  mode: Mode;
  toggleMode: () => void;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeCtx>({ mode: 'dark', toggleMode: () => {}, isDark: true });

export const useThemeMode = () => useContext(ThemeContext);

export function AppThemeProvider({ children }: { children: ReactNode }) {
  const brand = useBrand();
  const [mode, setMode] = useState<Mode>(
    () => (localStorage.getItem('mdm-theme') as Mode) || 'dark',
  );

  const toggleMode = () =>
    setMode((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      localStorage.setItem('mdm-theme', next);
      return next;
    });

  // MUI and DataGrid built-in texts (pagination, column menus, …) follow the UI language
  const theme = useMemo(() => {
    // Semantic getters (stage, priority, chart series…) read this registry
    setBrandColors(brand.status, brand.charts, brand.workflowTypes, brand.matchMethods);
    const opts = { status: brand.status, typography: brand.typography };
    const base = mode === 'dark'
      ? createDarkTheme(brand.palette, { darkBackground: brand.darkBackground, ...opts })
      : createLightTheme(brand.palette, opts);
    return i18n.language === 'fr' ? createTheme(base, materialFr, gridFr) : createTheme(base, materialEn, gridEn);
  }, [mode, brand.palette, brand.darkBackground, brand.status, brand.workflowTypes, brand.matchMethods, brand.charts, brand.typography]);

  const ctx = useMemo<ThemeCtx>(() => ({ mode, toggleMode, isDark: mode === 'dark' }), [mode]);

  return (
    <ThemeContext.Provider value={ctx}>
      <MuiThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </MuiThemeProvider>
    </ThemeContext.Provider>
  );
}
