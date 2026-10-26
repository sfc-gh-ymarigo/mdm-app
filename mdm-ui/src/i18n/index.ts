import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../locales/en.json';
import fr from '../locales/fr.json';

export const SUPPORTED_LOCALES = ['en', 'fr'] as const;
const STORAGE_KEY = 'mdm.locale';

/** Saved choice, else the browser language, else English (narrowed to enabled languages by BrandContext). */
function initialLocale(): string {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) return saved;
  const nav = navigator.language?.slice(0, 2).toLowerCase();
  return (SUPPORTED_LOCALES as readonly string[]).includes(nav) ? nav : 'en';
}

// Synchronous init: page modules build some label tables at import time (see `tr`).
i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, fr: { translation: fr } },
  lng: initialLocale(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
  initAsync: false,
});
document.documentElement.lang = i18n.language;

/** Translate outside React (module-level label tables, handlers). */
export const tr = (key: string, options?: Record<string, unknown>): string => i18n.t(key, options) as string;

/** Switch language. The app reloads so labels computed at import time are rebuilt too. */
export function setLocale(code: string) {
  if (code === i18n.language) return;
  localStorage.setItem(STORAGE_KEY, code);
  window.location.reload();
}

/** Pick the configured label for the active locale: `labels: { fr: '…' }`, falling back to `fallback`. */
export function localized(fallback: string, labels?: Record<string, string>): string {
  return labels?.[i18n.language] ?? fallback;
}

export default i18n;
