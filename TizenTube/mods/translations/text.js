import { t } from 'i18next';

function interpolate(text, options) {
  return String(text).replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name) => (
    options && options[name] !== undefined && options[name] !== null ? String(options[name]) : match
  ));
}

/**
 * Localized text with a safe English fallback. New YTArk strings live under
 * `ytark.*` in translations/resources/en.json; locales without a translation
 * fall back to English through i18next, and this helper also covers the case
 * where i18next is not initialised (tests, early start-up).
 */
export function tx(key, fallback, options) {
  let value = '';
  try {
    value = t(key, options);
  } catch (_) {
    value = '';
  }
  if (typeof value !== 'string' || !value || value === key) return interpolate(fallback, options);
  return value;
}

export default tx;
