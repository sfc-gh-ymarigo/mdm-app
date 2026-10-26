import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, Typography } from '@mui/material';
import SearchOffIcon from '@mui/icons-material/SearchOff';
import { useTranslation } from 'react-i18next';

export default function NotFound() {
  const { t } = useTranslation();
  return (
    <Box sx={{ textAlign: 'center', mt: 10 }}>
      <SearchOffIcon sx={{ fontSize: 64, color: 'text.disabled' }} />
      <Typography variant="h4" sx={{ mt: 2 }}>{t('common.notFound')}</Typography>
      <Typography color="text.secondary" sx={{ mt: 1, mb: 3 }}>{t('common.notFoundHint')}</Typography>
      <Button component={RouterLink} to="/" variant="contained">{t('common.backHome')}</Button>
    </Box>
  );
}
