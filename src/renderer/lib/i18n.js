// Tiny i18n: the UI is written in Spanish; other languages map the Spanish
// source strings to translations. t('Hace {n} días', { n: 3 })
import EN from './i18n-en.js';

const DICTS = { en: EN };
let lang = 'es';

export const LANGUAGES = [
  { id: '', name: 'Automático (sistema)' },
  { id: 'es', name: 'Español' },
  { id: 'en', name: 'English' },
];

export function setLanguage(l, systemLocale = 'es') {
  const auto = String(systemLocale || 'es').toLowerCase().startsWith('es') ? 'es' : 'en';
  lang = l || auto;
  document.documentElement.lang = lang;
}

export function getLanguage() {
  return lang;
}

export function t(str, vars) {
  let s = str;
  if (lang !== 'es') {
    const d = DICTS[lang];
    if (d && d[str] !== undefined) s = d[str];
  }
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));
  return s;
}

// A text that comes from the main process (src/shared/usertext.js): its
// template and values ({ text, vars }) when it has them, or the Spanish text.
//   tm(task.title, task.titleText)   tm(result.reason)   tm(error.message, error.i18n)
export function tm(value, text) {
  const x = text && typeof text.text === 'string' ? text : value && typeof value === 'object' && typeof value.text === 'string' ? value : null;
  if (x) return t(x.text, x.vars);
  return value === undefined || value === null ? '' : t(String(value));
}
