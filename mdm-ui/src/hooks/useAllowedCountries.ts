import { useMemo } from 'react';
import { useBrand } from '../config/BrandContext';
import { useUser } from '../context/UserContext';
import { useRefData, type RefValue } from './useRefData';

/**
 * Countries a user may assign to a record of this module. Mirrors the API rule:
 * active Operating Countries (or all reference countries if none configured),
 * narrowed to the user's country scope when the module is country-scoped.
 */
export function useAllowedCountries(moduleId: string): RefValue[] {
  const brand = useBrand();
  const { currentUser } = useUser();
  const refCountries = useRefData('COUNTRY');

  return useMemo(() => {
    const operating = (brand.countries || []).filter(c => c.enabled !== false);
    let list: RefValue[] = operating.length > 0
      ? operating.map(c => ({ code: c.code.toUpperCase(), label: refCountries.find(r => r.code === c.code.toUpperCase())?.label || c.label }))
      : refCountries;
    const scoped = brand.modules?.find(m => m.id === moduleId)?.country_scoped;
    const scope = currentUser?.country_scope;
    if (scoped && scope) list = list.filter(c => scope.includes(c.code));
    return list;
  }, [brand.countries, brand.modules, moduleId, currentUser?.country_scope, refCountries]);
}
