import { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  Box, Drawer, List, ListItemButton, ListItemIcon, ListItemText,
  AppBar, Toolbar, Typography, Avatar, Chip, alpha, IconButton, Tooltip,
  useTheme, Menu, MenuItem,
} from '@mui/material';
import DashboardIcon from '@mui/icons-material/Dashboard';
import PeopleIcon from '@mui/icons-material/People';
import InventoryIcon from '@mui/icons-material/Inventory2';
import VerifiedIcon from '@mui/icons-material/VerifiedUser';
import TimelineIcon from '@mui/icons-material/Timeline';
import JoinInnerIcon from '@mui/icons-material/JoinInner';
import HistoryIcon from '@mui/icons-material/History';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import LightModeIcon from '@mui/icons-material/LightMode';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import BarChartIcon from '@mui/icons-material/BarChart';
import AssignmentIndIcon from '@mui/icons-material/AssignmentInd';
import ListAltIcon from '@mui/icons-material/ListAlt';
import WorkspacePremiumIcon from '@mui/icons-material/WorkspacePremium';
import SettingsIcon from '@mui/icons-material/Settings';
import LocalShippingIcon from '@mui/icons-material/LocalShipping';
import StoreIcon from '@mui/icons-material/Store';
import FactoryIcon from '@mui/icons-material/Factory';
import DevicesIcon from '@mui/icons-material/Devices';
import CategoryIcon from '@mui/icons-material/Category';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import MenuIcon from '@mui/icons-material/Menu';
import { useThemeMode } from '../theme/ThemeContext';
import { useUser } from '../context/UserContext';
import { useBrand } from '../config/BrandContext';
import { statusColors } from '../theme/brandColors';
import { logoSrc } from './configuration/BrandingSettings';
import Breadcrumbs from './common/Breadcrumbs';
import NotificationBell from './common/NotificationBell';
import LanguageMenu from './common/LanguageMenu';
import { UnsavedChangesBlocker } from './common/useUnsavedGuard';
import { tr, localized } from '../i18n';

const DRAWER_WIDTH = 260;
const DRAWER_COLLAPSED = 72;
const COLLAPSE_KEY = 'mdm.sidebarCollapsed';

export const MODULE_ICONS: Record<string, React.ReactNode> = {
  People: <PeopleIcon />,
  Inventory2: <InventoryIcon />,
  LocalShipping: <LocalShippingIcon />,
  Store: <StoreIcon />,
  Factory: <FactoryIcon />,
  Devices: <DevicesIcon />,
  Category: <CategoryIcon />,
};

interface NavItem {
  label: string;
  icon: React.ReactNode;
  path: string;
  editorOnly?: boolean;
  adminOnly?: boolean;
}

interface NavSection {
  title: string | null; // null = no header (e.g. Dashboard)
  items: NavItem[];
}


export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const { isDark, toggleMode } = useThemeMode();
  const { currentUser, users, switchUser, devAuth, canEdit, isAdmin } = useUser();
  const brand = useBrand();

  // Build module nav items
  const moduleNavItems: NavItem[] = (brand.modules || [])
    .filter(m => m.enabled)
    .sort((a, b) => a.order - b.order)
    .map(m => ({
      label: localized(m.label, m.labels),
      icon: MODULE_ICONS[m.icon] || <CategoryIcon />,
      path: `/${m.id}s`,
    }));

  // Grouped sections
  const sections: NavSection[] = [
    { title: null, items: [{ label: tr('nav.dashboard'), icon: <DashboardIcon />, path: '/' }] },
    {
      title: tr('nav.masterData'),
      items: [
        ...moduleNavItems,
        { label: tr('nav.golden'), icon: <WorkspacePremiumIcon />, path: '/golden' },
        { label: tr('nav.referenceData'), icon: <ListAltIcon />, path: '/reference-data' },
      ],
    },
    {
      title: tr('nav.operations'),
      items: [
        { label: tr('nav.dataQuality'), icon: <VerifiedIcon />, path: '/data-quality' },
        { label: tr('nav.profiling'), icon: <BarChartIcon />, path: '/profiling' },
        { label: tr('nav.workflows'), icon: <TimelineIcon />, path: '/workflows' },
        { label: tr('nav.matchMerge'), icon: <JoinInnerIcon />, path: '/match-merge', editorOnly: true },
        { label: tr('nav.audit'), icon: <HistoryIcon />, path: '/audit' },
      ],
    },
    {
      title: tr('nav.myWork'),
      items: [
        { label: tr('nav.stewardship'), icon: <AssignmentIndIcon />, path: '/stewardship' },
      ],
    },
    {
      title: tr('nav.intelligence'),
      items: [
        { label: tr('nav.analyst'), icon: <AutoAwesomeIcon />, path: '/analyst' },
      ],
    },
  ];

  const [userMenuAnchor, setUserMenuAnchor] = useState<HTMLElement | null>(null);

  const p = brand.palette;

  const fgMuted = theme.palette.text.secondary;
  const borderAlpha = isDark ? alpha('#fff', 0.06) : alpha(p.primary, 0.08);

  const sidebarGradient = isDark
    ? (brand.darkBackground?.sidebarGradient || `linear-gradient(180deg, ${brand.darkBackground?.paper || '#081A36'} 0%, ${brand.darkBackground?.default || '#040D21'} 100%)`)
    : (brand.lightBackground?.sidebarGradient || `linear-gradient(180deg, ${p.primary} 0%, ${p.primaryDark} 100%)`);

  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1');
  const toggleCollapsed = () => setCollapsed(c => { localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1'); return !c; });
  const width = collapsed ? DRAWER_COLLAPSED : DRAWER_WIDTH;

  const configActive = location.pathname.startsWith('/configuration');

  return (
    <Box sx={{ display: 'flex', height: '100vh' }}>
      <Drawer
        variant="permanent"
        sx={{
          width,
          transition: 'width 0.2s',
          '& .MuiDrawer-paper': {
            width,
            transition: 'width 0.2s',
            overflowX: 'hidden',
            boxSizing: 'border-box',
            background: sidebarGradient,
            borderRight: `1px solid ${borderAlpha}`,
          },
        }}
      >
        {/* Decorative watermark: slow-spinning snowflake behind the menu */}
        {!collapsed && (
          <Box component="img" src="/logos/snowflake.png" alt="" aria-hidden
            sx={{
              position: 'absolute', width: 260, right: -80, bottom: 70, opacity: 0.06, pointerEvents: 'none', zIndex: 0,
              animation: 'mdm-spin 60s linear infinite',
              '@keyframes mdm-spin': { from: { transform: 'rotate(0deg)' }, to: { transform: 'rotate(360deg)' } },
              '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
            }} />
        )}
        <Box sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'space-between', minHeight: 64 }}>
          {!collapsed && (logoSrc(brand.logo)
            ? <Box component="img" src={logoSrc(brand.logo)} alt={brand.name} sx={{ maxHeight: 32, maxWidth: 170, ml: 0.5 }} />
            : <Box component="img" src="/logos/snowflake.png" alt="Snowflake" sx={{ height: 32, ml: 0.5, opacity: 0.35 }} />)}
          <Tooltip title={collapsed ? tr('layout.expandSidebar') : tr('layout.collapseSidebar')} placement="right">
            <IconButton size="small" onClick={toggleCollapsed} sx={{ color: alpha('#fff', 0.6) }}>
              {collapsed ? <MenuIcon fontSize="small" /> : <ChevronLeftIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        </Box>

        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
          <List sx={{ px: 1.5, mt: 0.5, flex: 1 }}>
            {sections.map((section, si) => (
              <Box key={si}>
                {section.title && collapsed && si > 0 && <Box sx={{ borderTop: `1px solid ${alpha('#fff', 0.06)}`, mx: 1, my: 1 }} />}
                {section.title && !collapsed && (
                  <Typography
                    variant="overline"
                    sx={{
                      display: 'block',
                      px: 1.5,
                      pt: si === 1 ? 1 : 2,
                      pb: 0.5,
                      fontSize: '0.6rem',
                      fontWeight: 700,
                      letterSpacing: '0.12em',
                      color: alpha('#fff', 0.35),
                    }}
                  >
                    {section.title}
                  </Typography>
                )}
                {section.items
                  .filter(item => (!item.editorOnly || canEdit) && (!item.adminOnly || isAdmin))
                  .map((item) => {
                    const active = item.path === '/' ? location.pathname === '/' : location.pathname === item.path || location.pathname.startsWith(`${item.path}/`);
                    return (
                      <Tooltip key={item.path} title={collapsed ? item.label : ''} placement="right">
                      <ListItemButton
                        onClick={() => navigate(item.path)}
                        sx={{
                          borderRadius: 2, mb: 0.3,
                          py: 0.6,
                          justifyContent: collapsed ? 'center' : 'flex-start',
                          color: active ? p.primary : alpha('#fff', 0.6),
                          bgcolor: active ? alpha(p.primary, 0.12) : 'transparent',
                          '&:hover': { bgcolor: alpha(p.primary, 0.06) },
                        }}
                      >
                        <ListItemIcon sx={{ minWidth: collapsed ? 0 : 36, color: 'inherit' }}>{item.icon}</ListItemIcon>
                        {!collapsed && <ListItemText primary={item.label} primaryTypographyProps={{ fontSize: '0.84rem', fontWeight: active ? 600 : 400 }} />}
                      </ListItemButton>
                      </Tooltip>
                    );
                  })}
              </Box>
            ))}
          </List>

          {/* Configuration link — bottom of nav, above user */}
          {isAdmin && (
            <Box sx={{ px: 1.5, pb: 1 }}>
              <Box sx={{ borderTop: `1px solid ${alpha('#fff', 0.06)}`, pt: 1 }}>
                <Tooltip title={collapsed ? tr('nav.configuration') : ''} placement="right">
                <ListItemButton
                  onClick={() => navigate('/configuration')}
                  sx={{
                    borderRadius: 2,
                    py: 0.6,
                    justifyContent: collapsed ? 'center' : 'flex-start',
                    color: configActive ? p.primary : alpha('#fff', 0.6),
                    bgcolor: configActive ? alpha(p.primary, 0.12) : 'transparent',
                    '&:hover': { bgcolor: alpha(p.primary, 0.06) },
                  }}
                >
                  <ListItemIcon sx={{ minWidth: collapsed ? 0 : 36, color: 'inherit' }}><SettingsIcon /></ListItemIcon>
                  {!collapsed && <ListItemText primary={tr('nav.configuration')} primaryTypographyProps={{ fontSize: '0.84rem', fontWeight: configActive ? 600 : 400 }} />}
                </ListItemButton>
                </Tooltip>
              </Box>
            </Box>
          )}
        </Box>

        <Box sx={{ p: collapsed ? 1.5 : 2.5, borderTop: `1px solid ${alpha('#fff', 0.06)}` }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'flex-start', gap: 1.5, cursor: devAuth ? 'pointer' : 'default' }} onClick={(e) => { if (devAuth) setUserMenuAnchor(e.currentTarget); }}>
            <Avatar sx={{ width: 36, height: 36, bgcolor: isDark ? p.primary : p.secondary, fontSize: '0.85rem' }}>{currentUser ? currentUser.display_name.split(' ').map(w => w[0]).join('') : 'U'}</Avatar>
            <Box sx={{ flex: 1, minWidth: 0, display: collapsed ? 'none' : 'block' }}>
              <Typography variant="body2" sx={{ color: '#fff', fontWeight: 500, fontSize: '0.8rem' }}>{currentUser?.display_name || tr('layout.loading')}</Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Chip label={currentUser?.role || ''} size="small" sx={{ fontSize: '0.6rem', height: 16, bgcolor: currentUser?.role === 'ADMIN' ? alpha(statusColors().error, 0.2) : currentUser?.role === 'STEWARD' ? alpha(statusColors().warning, 0.2) : alpha(statusColors().neutral, 0.2), color: currentUser?.role === 'ADMIN' ? statusColors().error : currentUser?.role === 'STEWARD' ? statusColors().warning : statusColors().neutral }} />
                {currentUser?.country_scope && <Typography variant="caption" sx={{ color: alpha('#fff', 0.4), fontSize: '0.6rem' }}>{currentUser.country_scope.join(', ')}</Typography>}
              </Box>
            </Box>
          </Box>
          <Menu anchorEl={userMenuAnchor} open={devAuth && !!userMenuAnchor} onClose={() => setUserMenuAnchor(null)} anchorOrigin={{ vertical: 'top', horizontal: 'right' }} transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}>
            <Box sx={{ px: 2, py: 1, borderBottom: `1px solid ${theme.palette.divider}` }}>
              <Typography variant="caption" sx={{ color: fgMuted }}>{tr('layout.switchUserLocalDevOnly')}</Typography>
            </Box>
            {users.filter(u => u.is_active).map(u => (
              <MenuItem key={u.email} selected={u.email === currentUser?.email} onClick={() => { switchUser(u.email); setUserMenuAnchor(null); }} sx={{ py: 1 }}>
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>{u.display_name}</Typography>
                  <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                    <Chip label={u.role} size="small" sx={{ fontSize: '0.55rem', height: 14 }} />
                    <Typography variant="caption" sx={{ color: fgMuted, fontSize: '0.65rem' }}>{u.country_scope ? u.country_scope.join(', ') : 'All countries'}</Typography>
                  </Box>
                </Box>
              </MenuItem>
            ))}
          </Menu>
        </Box>
      </Drawer>

      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        <AppBar
          position="sticky"
          elevation={0}
          sx={{
            bgcolor: alpha(theme.palette.background.default, 0.85),
            backdropFilter: 'blur(20px)',
            borderBottom: `1px solid ${borderAlpha}`,
          }}
        >
          <Toolbar sx={{ gap: 1.5 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}><Breadcrumbs /></Box>
            <Tooltip title={isDark ? tr('layout.switchToLightMode') : 'Switch to Dark mode'}>
              <IconButton size="small" onClick={toggleMode} sx={{ color: fgMuted }}>
                {isDark ? <LightModeIcon fontSize="small" /> : <DarkModeIcon fontSize="small" />}
              </IconButton>
            </Tooltip>

            <LanguageMenu />
            <NotificationBell />
          </Toolbar>
        </AppBar>

        <UnsavedChangesBlocker />
        <Box sx={{ flex: 1, p: 3, overflow: 'auto', minHeight: 0 }}>
          <Outlet />
        </Box>
      </Box>
    </Box>
  );
}
