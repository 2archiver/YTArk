import { configRead } from '../config.js';

const STYLE_ATTRIBUTE = 'data-ytark-managed-theme';
let managedStyle = null;

function colorValue(value, fallback) {
  const candidate = String(value || '').trim();
  if (/^#[0-9a-f]{3,8}$/i.test(candidate)
      || /^(?:rgb|rgba|hsl|hsla)\([\d.% ,+-]+\)$/i.test(candidate)
      || /^(?:black|white|transparent|red|blue|gray|grey|navy)$/i.test(candidate)) {
    return candidate;
  }
  return fallback;
}

function getManagedStyle() {
  if (managedStyle && managedStyle.parentNode) return managedStyle;
  managedStyle = document.querySelector(`style[${STYLE_ATTRIBUTE}="true"]`);
  if (!managedStyle) {
    managedStyle = document.createElement('style');
    managedStyle.setAttribute(STYLE_ATTRIBUTE, 'true');
    document.head.appendChild(managedStyle);
  }
  return managedStyle;
}

function updateStyle() {
  if (typeof document === 'undefined' || !document.head) return;
  const focus = colorValue(configRead('focusContainerColor'), '#0f0f0f');
  const route = colorValue(configRead('routeColor'), '#0f0f0f');
  const style = getManagedStyle();
  // Replace this stylesheet's contents instead of appending duplicate rules to
  // a Cobalt nonce style or to a previous YTArk update.
  style.textContent = [
    `ytlr-guide-response yt-focus-container { background-color: ${focus}; }`,
    `#container { background-color: ${route} !important; }`,
  ].join('\n');
}

if (typeof document !== 'undefined') updateStyle();

export default updateStyle;
