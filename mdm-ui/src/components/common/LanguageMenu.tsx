import { useState } from 'react';
import { Button, Menu, MenuItem, Tooltip } from '@mui/material';
import TranslateIcon from '@mui/icons-material/Translate';
import { useTranslation } from 'react-i18next';
import { useBrand } from '../../config/BrandContext';
import { SUPPORTED_LOCALES, setLocale } from '../../i18n';

/** UI language switcher: enabled languages from Configuration > Localization that have a translation. */
export default function LanguageMenu() {
  const { t, i18n } = useTranslation();
  const brand = useBrand();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const configured = (brand.languages ?? []).filter(l => l.enabled !== false);
  const options = (configured.length ? configured : SUPPORTED_LOCALES.map(code => ({ code, label: code.toUpperCase() })))
    .filter(l => (SUPPORTED_LOCALES as readonly string[]).includes(l.code));
  if (options.length < 2) return null;
  return (
    <>
      <Tooltip title={t('nav.language')}>
        <Button size="small" color="inherit" startIcon={<TranslateIcon fontSize="small" />} onClick={e => setAnchor(e.currentTarget)}
          sx={{ color: 'text.secondary', minWidth: 0, textTransform: 'uppercase' }}>{i18n.language}</Button>
      </Tooltip>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
        {options.map(l => (
          <MenuItem key={l.code} selected={l.code === i18n.language} onClick={() => { setAnchor(null); setLocale(l.code); }}>{l.label}</MenuItem>
        ))}
      </Menu>
    </>
  );
}
