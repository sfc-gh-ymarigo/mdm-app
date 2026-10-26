#!/usr/bin/env node
// Fails when a translation key used in src/ is missing from a locale, or when locales disagree
// (key sets or {{placeholders}}).  npm run check:i18n
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const locales = Object.fromEntries(['en', 'fr'].map(l => [l, JSON.parse(readFileSync(join(src, 'locales', `${l}.json`), 'utf8'))]));

const flat = (o, p = '') => Object.entries(o).reduce((acc, [k, v]) =>
  (typeof v === 'object' && v !== null ? Object.assign(acc, flat(v, `${p}${k}.`)) : Object.assign(acc, { [`${p}${k}`]: v })), {});
const flats = Object.fromEntries(Object.entries(locales).map(([l, d]) => [l, flat(d)]));

const files = [];
const walk = d => readdirSync(d).forEach(f => {
  const p = join(d, f);
  if (statSync(p).isDirectory()) { if (f !== 'locales') walk(p); } else if (/\.(ts|tsx)$/.test(f)) files.push(p);
});
walk(src);

const used = new Set(), prefixes = new Set();
for (const f of files) {
  const s = readFileSync(f, 'utf8');
  for (const m of s.matchAll(/\btr?\(\s*['"]([a-zA-Z][\w.]*)['"]/g)) used.add(m[1]);
  for (const m of s.matchAll(/\btr?\(\s*`([a-zA-Z][\w.]*)\.\$\{/g)) prefixes.add(m[1]);
}

const errors = [];
for (const [l, keys] of Object.entries(flats)) {
  // Plural keys resolve to key_one / key_other (i18next count suffixes)
  for (const k of used) if (!(k in keys) && !(`${k}_other` in keys)) errors.push(`${l}: missing "${k}"`);
  for (const p of prefixes) if (!Object.keys(keys).some(k => k.startsWith(`${p}.`))) errors.push(`${l}: no keys under "${p}.*"`);
}
const ph = v => [...String(v).matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]).sort().join(',');
for (const k of Object.keys(flats.en)) {
  if (!(k in flats.fr)) errors.push(`fr: missing "${k}" (present in en)`);
  else if (ph(flats.en[k]) !== ph(flats.fr[k])) errors.push(`fr: placeholders differ for "${k}"`);
}
for (const k of Object.keys(flats.fr)) if (!(k in flats.en)) errors.push(`en: missing "${k}" (present in fr)`);

if (errors.length) { console.error(errors.join('\n')); console.error(`\n${errors.length} i18n problem(s)`); process.exit(1); }
console.log(`i18n OK: ${used.size} keys used, ${Object.keys(flats.en).length} keys in en/fr`);
