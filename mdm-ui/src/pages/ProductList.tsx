import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Chip, CircularProgress, Tooltip, Typography, alpha } from '@mui/material';
import DeviceHubIcon from '@mui/icons-material/DeviceHub';
import InventoryIcon from '@mui/icons-material/Inventory2';
import TranslateIcon from '@mui/icons-material/GTranslate';
import ModuleList from '../components/common/ModuleList';
import ProductHierarchy from '../components/ProductHierarchy';
import { AiSuggestButton, DuplicateButton, RemediateButton } from '../components/common/recordActions';
import type { FieldOptions, Values } from '../components/common/fields';
import { productsApi, entityApi, type EntityRecord, type Paged } from '../api/client';
import { useBrand } from '../config/BrandContext';
import { useUser } from '../context/UserContext';
import { useToast } from '../components/common/Toast';

type Category = { id: number; name: string; children?: Category[] };

function ProductName({ row }: { row: EntityRecord }) {
  const img = row.primary_image as string | undefined;
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
      {img
        ? <Box component="img" src={img} alt="" sx={{ width: 40, height: 40, borderRadius: 1, objectFit: 'cover', flexShrink: 0 }} />
        : <Box sx={{ width: 40, height: 40, borderRadius: 1, bgcolor: t => alpha(t.palette.text.secondary, 0.1), display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><InventoryIcon sx={{ fontSize: 20, color: 'text.secondary' }} /></Box>}
      <Box>
        <Typography variant="body2" sx={{ fontWeight: 500, fontSize: '0.85rem' }}>{String(row.name ?? '')}</Typography>
        <Typography variant="caption" color="text.secondary">{String(row.sku ?? '—')}</Typography>
      </Box>
    </Box>
  );
}

/** Translate name/description with Cortex into each enabled non-default language. */
function TranslateButtons({ record, reload }: { record: EntityRecord; reload: () => void }) {
  const { t } = useTranslation();
  const brand = useBrand();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const langs = brand.languages || [];
  const source = langs.find(l => l.default)?.code || 'en';
  const targets = langs.filter(l => l.enabled !== false && l.code !== source);
  const run = async (to: string) => {
    setBusy(to);
    try {
      const fields: Record<string, string> = {};
      if (record.name) fields.name = String(record.name);
      if (record.short_desc) fields.short_desc = String(record.short_desc);
      const res = await fetch('/api/ai/translate-batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields, from_lang: source, to_lang: to }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const translations = { ...((record.translations as Record<string, unknown>) || {}), [to]: data.translations };
      await entityApi.update('product', record.id, { translations });
      toast(t('products.translated', { lang: to.toUpperCase() }));
      reload();
    } catch (e) { toast(t('ai.error', { error: (e as Error).message }), 'error'); }
    finally { setBusy(null); }
  };
  return <>{targets.map(l => (
    <Tooltip key={l.code} title={t('products.translateTo', { lang: l.label })}>
      <Button size="small" startIcon={busy === l.code ? <CircularProgress size={14} /> : <TranslateIcon />} disabled={!!busy} sx={{ color: brand.palette.accent, minWidth: 0 }} onClick={() => run(l.code)}>{l.code.toUpperCase()}</Button>
    </Tooltip>
  ))}</>;
}

/** Image and translations shown above the product's fields. */
function ProductHeader({ record }: { record: EntityRecord }) {
  const { t } = useTranslation();
  const translations = (record.translations as Record<string, Record<string, string>> | undefined) || {};
  return (
    <Box sx={{ mb: 2 }}>
      {record.primary_image ? <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}><Box component="img" src={String(record.primary_image)} alt="" sx={{ maxWidth: 160, maxHeight: 160, borderRadius: 2, objectFit: 'contain' }} /></Box> : null}
      {Object.keys(translations).length > 0 && (
        <Box sx={{ mb: 1 }}>
          <Typography variant="overline" color="text.secondary">{t('products.translations')}</Typography>
          {Object.entries(translations).map(([lang, f]) => (
            <Box key={lang} sx={{ p: 1, mb: 1, borderRadius: 1, border: 1, borderColor: 'divider' }}>
              <Chip label={lang.toUpperCase()} size="small" sx={{ height: 18, fontSize: '0.6rem', fontWeight: 700, mb: 0.5 }} />
              {Object.entries(f || {}).map(([k, v]) => <Typography key={k} variant="caption" sx={{ display: 'block' }}><b>{k}</b>: {v}</Typography>)}
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}

/** Products: shared module list plus taxonomy tab, category picker, images, translations and AI helpers. */
export default function ProductList() {
  const { t } = useTranslation();
  const brand = useBrand();
  const { canEdit } = useUser();
  const mod = brand.modules.find(m => m.id === 'product');
  const [prefill, setPrefill] = useState<Values | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  useEffect(() => { fetch('/api/hierarchy/product-categories').then(r => r.json()).then(setCategories).catch(() => {}); }, []);

  const fieldOptions = useMemo<FieldOptions>(() => ({
    category_id: categories.flatMap(root => [{ code: String(root.id), label: root.name }, ...(root.children ?? []).map(c => ({ code: String(c.id), label: c.name, group: root.name }))]),
  }), [categories]);
  // Rows include translations and images (not module fields)
  const load = useMemo(() => (p: URLSearchParams) => productsApi.page(p) as unknown as Promise<Paged<EntityRecord>>, []);
  if (!mod) return null;

  return (
    <ModuleList
      moduleId="product"
      load={load}
      nameCell={row => <ProductName row={row} />}
      subtitle={s => t('products.summary', { count: s.total, published: s.facets.lifecycle_stage?.find(f => f.value === 'PUBLISHED')?.count ?? 0 })}
      fieldOptions={fieldOptions}
      extraTabs={[{ key: 'taxonomy', label: t('products.taxonomy'), icon: <DeviceHubIcon />, content: <ProductHierarchy /> }]}
      createDefaults={{ translations: {}, extended_attrs: {} }}
      createActions={(values, set) => <AiSuggestButton mod={mod} values={values} set={set} />}
      recordHeader={record => <ProductHeader record={record} />}
      recordActions={(record, { edit, reload }) => canEdit && (<>
        <DuplicateButton mod={mod} record={record} onDuplicate={setPrefill} />
        <RemediateButton mod={mod} record={record} edit={edit} />
        <TranslateButtons record={record} reload={reload} />
      </>)}
      prefill={prefill} onPrefillUsed={() => setPrefill(null)}
    />
  );
}
