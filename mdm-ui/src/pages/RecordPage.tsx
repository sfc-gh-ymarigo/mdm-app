import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Card, CardContent } from '@mui/material';
import RecordDetail, { type RecordTab } from '../components/common/RecordDetail';
import { useBreadcrumbLabel } from '../components/common/Breadcrumbs';
import { modulePath } from '../components/common/Links';
import { entityApi } from '../api/client';
import { useBrand } from '../config/BrandContext';

/** Full-page record view: /customers/:id, /products/:id, /suppliers/:id … (?tab=quality|workflows|audit|comments) */
export default function RecordPage({ moduleId }: { moduleId: string }) {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const brand = useBrand();
  const mod = brand.modules.find(m => m.id === moduleId);
  const [name, setName] = useState<string | null>(null);
  useBreadcrumbLabel(name);

  useEffect(() => {
    setName(null);
    if (mod) entityApi.get(moduleId, id).then(r => setName(String(r[mod.name_field] ?? id))).catch(() => setName(id));
  }, [moduleId, id, mod]);

  const tab = (params.get('tab') as RecordTab) || 'details';
  return (
    <Card><CardContent sx={{ p: 3 }}>
      <RecordDetail moduleId={moduleId} id={id} variant="page" initialTab={tab}
        onTabChange={tb => setParams(tb === 'details' ? {} : { tab: tb }, { replace: true })}
        onChanged={r => mod && setName(String(r[mod.name_field] ?? id))}
        onDeleted={() => navigate(modulePath(moduleId))} />
    </CardContent></Card>
  );
}
