import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import DeviceHubIcon from '@mui/icons-material/DeviceHub';
import ModuleList from '../components/common/ModuleList';
import CustomerHierarchy from '../components/CustomerHierarchy';
import { AiSuggestButton, DuplicateButton, RemediateButton } from '../components/common/recordActions';
import type { Values } from '../components/common/fields';
import { useBrand } from '../config/BrandContext';
import { useUser } from '../context/UserContext';

/** Customers: the shared module list plus the account hierarchy tab and AI helpers. */
export default function CustomerList() {
  const { t } = useTranslation();
  const brand = useBrand();
  const { canEdit } = useUser();
  const mod = brand.modules.find(m => m.id === 'customer');
  const [prefill, setPrefill] = useState<Values | null>(null);
  if (!mod) return null;
  return (
    <ModuleList
      moduleId="customer"
      extraTabs={mod.hierarchy?.enabled ? [{ key: 'hierarchy', label: t('list.hierarchy'), icon: <DeviceHubIcon />, content: <CustomerHierarchy /> }] : []}
      createActions={(values, set) => <AiSuggestButton mod={mod} values={values} set={set} />}
      recordActions={(record, { edit }) => canEdit && (<>
        <DuplicateButton mod={mod} record={record} onDuplicate={setPrefill} />
        <RemediateButton mod={mod} record={record} edit={edit} />
      </>)}
      prefill={prefill} onPrefillUsed={() => setPrefill(null)}
    />
  );
}
