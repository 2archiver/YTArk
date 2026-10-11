/**
 * Test harness for YTArk UI modules.
 *
 * It stands in for the YouTube TV frontend's command resolver: every command
 * YTArk does not handle itself (modals, toasts, POPUP_BACK, ...) is recorded.
 * YTArk's real `patchResolveCommand()` is installed on top, so rows are
 * "pressed" through the same code paths the TV uses.
 */
import { readFileSync } from 'node:fs';
import {
  FakeElement, createDocument, createWindowStub, installGlobals,
} from './fake-dom.mjs';

export const tick = (ms = 5) => new Promise(resolve => setTimeout(resolve, ms));

/** localStorage double with property semantics (config.js uses properties). */
export function propertyStorage(initial = {}) {
  const store = { ...initial };
  Object.defineProperty(store, 'getItem', { value(key) { return Object.prototype.hasOwnProperty.call(this, key) ? this[key] : null; }, enumerable: false });
  Object.defineProperty(store, 'setItem', { value(key, value) { this[key] = String(value); }, enumerable: false });
  Object.defineProperty(store, 'removeItem', { value(key) { delete this[key]; }, enumerable: false });
  return store;
}

export async function initEnglish() {
  const i18next = (await import('i18next')).default;
  const en = JSON.parse(readFileSync(new URL('../../translations/resources/en.json', import.meta.url), 'utf-8'));
  await i18next.init({ lng: 'en', fallbackLng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false } });
  return i18next;
}

/** Create globals for a UI test. Must run before importing YTArk modules. */
export function setupEnvironment({ storage = {}, version = '2.3.0', capabilities = {} } = {}) {
  const localStorage = propertyStorage(storage);
  const doc = createDocument();
  const windowStub = createWindowStub({ localStorage, doc });
  windowStub.h5vcc = {
    tizentube: {
      GetVersion: () => version,
      GetArchitecture: () => 'armeabi-v7a',
      ...(capabilities.frameRate ? { SetFrameRate: () => {} } : {}),
      ...(capabilities.userAgent !== false ? { SetUserAgent: () => {}, GetUserAgent: () => '' } : {}),
      HasSystemFeature: feature => feature === 'android.software.picture_in_picture' && capabilities.pip === true,
    },
  };
  const recorded = [];
  windowStub._yttv = {
    app: { instance: { resolveCommand(cmd) { recorded.push(cmd); return true; } } },
  };
  installGlobals({ doc, windowStub, localStorage });
  // A video element keeps speed/player helpers from polling for one.
  const video = new FakeElement('video', doc);
  doc.body.appendChild(video);
  return { doc, windowStub, localStorage, recorded, video };
}

function panelContent(command) {
  return command.openPopupAction.popup.overlaySectionRenderer.overlay.overlayTwoPanelRenderer
    .actionPanel.overlayPanelRenderer.content;
}

export function modals(recorded, id) {
  return recorded.filter(cmd => cmd && cmd.openPopupAction && cmd.openPopupAction.popupType === 'MODAL'
    && (!id || cmd.openPopupAction.uniqueId === id));
}

export function lastModal(recorded, id) {
  const list = modals(recorded, id);
  return list[list.length - 1] || null;
}

export function toasts(recorded) {
  return recorded.filter(cmd => cmd && cmd.openPopupAction && cmd.openPopupAction.popupType === 'TOAST')
    .map(cmd => ({
      title: cmd.openPopupAction.popup.overlayToastRenderer.title.simpleText,
      subtitle: cmd.openPopupAction.popup.overlayToastRenderer.subtitle.simpleText,
    }));
}

export function modalItems(command) {
  const content = panelContent(command);
  if (content.overlayPanelItemListRenderer) return content.overlayPanelItemListRenderer.items;
  if (content.scrollPaneRenderer) return content.scrollPaneRenderer.content.scrollPaneItemListRenderer.items;
  return [];
}

export function selectedIndex(command) {
  const content = panelContent(command);
  return content.overlayPanelItemListRenderer ? content.overlayPanelItemListRenderer.selectedIndex : 0;
}

export function header(command) {
  const renderer = command.openPopupAction.popup.overlaySectionRenderer.overlay.overlayTwoPanelRenderer
    .actionPanel.overlayPanelRenderer.header.overlayPanelHeaderRenderer;
  return { title: renderer.title && renderer.title.simpleText, subtitle: renderer.subtitle && renderer.subtitle.simpleText };
}

export function rowTitle(item) {
  return item && item.compactLinkRenderer && item.compactLinkRenderer.title ? item.compactLinkRenderer.title.simpleText : '';
}

export function rowSubtitle(item) {
  return item && item.compactLinkRenderer && item.compactLinkRenderer.subtitle ? item.compactLinkRenderer.subtitle.simpleText : '';
}

export function rowSecondaryIcon(item) {
  return item && item.compactLinkRenderer && item.compactLinkRenderer.secondaryIcon
    ? item.compactLinkRenderer.secondaryIcon.iconType : '';
}

export function rowCommands(item) {
  return item.compactLinkRenderer.serviceEndpoint.commandExecutorCommand.commands;
}

export function messageText(item) {
  return item && item.overlayMessageRenderer ? item.overlayMessageRenderer.title.simpleText : '';
}

export function findRow(command, match) {
  const items = modalItems(command);
  return items.find(item => (typeof match === 'function' ? match(item) : rowTitle(item) === match)) || null;
}

/** Press a row through the patched resolver, then let deferred work run. */
export async function press(resolveCommand, item) {
  if (!item || !item.compactLinkRenderer) throw new Error('press(): not a pressable row');
  resolveCommand(item.compactLinkRenderer.serviceEndpoint);
  await tick();
}
