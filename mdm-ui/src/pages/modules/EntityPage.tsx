import { useTranslation } from 'react-i18next';
import DeviceHubIcon from '@mui/icons-material/DeviceHub';
import ModuleList from '../../components/common/ModuleList';
import CustomerHierarchy from '../../components/CustomerHierarchy';
import { useBrand } from '../../config/BrandContext';

/**
 * Config-driven page for modules without a dedicated page (suppliers, …): the same list, drawer,
 * export, bulk actions, filters, typed create/edit and admin delete as customers and products,
 * plus the parent-child hierarchy tab when the module enables one.
 */
export default function EntityPage({ moduleId }: { moduleId: string }) {
  const { t } = useTranslation();
  const mod = useBrand().modules.find(m => m.id === moduleId);
  const h = mod?.hierarchy;
  const tabs = h?.enabled && h.type === 'self'
    ? [{ key: 'hierarchy', label: t('list.hierarchy'), icon: <DeviceHubIcon />, content: <CustomerHierarchy key={moduleId} moduleId={moduleId} /> }]
    : [];
  return <ModuleList moduleId={moduleId} extraTabs={tabs} />;
}
