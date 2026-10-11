// The YTArk Settings guide entry must open only on an explicit OK/Enter or
// click: focusing, hovering or scrolling past it may only highlight it.
// (ui/guideEntryActivation.js + the patched resolver in resolveCommand.js.)
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { FakeElement, keyEvent } from './helpers/fake-dom.mjs';
import { setupEnvironment, initEnglish, lastModal, modals, tick } from './helpers/ytlr-harness.mjs';

const { doc, recorded } = setupEnvironment();
await initEnglish();
const { configWrite } = await import('../config.js');
const activation = await import('../ui/guideEntryActivation.js');
const resolve = await import('../resolveCommand.js');
resolve.patchResolveCommand();
const resolveCommand = resolve.default;

const ENTRY_ENDPOINT = { customAction: { action: 'YTARK_GUIDE_SETTINGS_OPEN', parameters: [] } };
const settingsModals = () => modals(recorded, 'tt-settings');

/** Dispatch a full key/click event through the document listeners. */
function dispatch(event) {
  for (const listener of [...(doc.listeners.get(event.type) || [])]) listener(event);
  return event;
}

/** A rendered guide row carrying the entry's own label. */
function guideRow(label = 'YTArk Settings') {
  const container = new FakeElement('ytlr-guide-response', doc);
  const list = new FakeElement('div', doc);
  list.className = 'ytLrGuideResponseContainer';
  const row = new FakeElement('div', doc);
  row.textContent = label;
  container.appendChild(list);
  list.appendChild(row);
  doc.body.appendChild(container);
  return row;
}

const okOn = target => dispatch(keyEvent('keydown', 13, target));
const clickOn = target => dispatch({ type: 'click', target });

beforeEach(async () => {
  recorded.length = 0;
  activation.resetGuideActivationForTests();
  activation.installGuideActivation();
  configWrite('enableYtarkGuideEntry', true);
  await tick();
});

describe('explicit activation of the YTArk Settings guide entry', () => {
  it('ignores the endpoint the frontend resolves on focus, hover or scroll', () => {
    // This is what the sidebar does when the entry is merely focused: the
    // navigation endpoint is resolved with no user activation behind it.
    for (let index = 0; index < 5; index += 1) resolveCommand(ENTRY_ENDPOINT);
    assert.deepEqual(settingsModals(), [], 'scrolling past the entry opens nothing');
    assert.equal(activation.guideActivationState().armed, false);
  });

  it('opens exactly one panel for an explicit OK on the entry', async () => {
    const row = guideRow();
    okOn(row);
    await tick(activation.FALLBACK_DELAY_MS + 20);
    assert.equal(settingsModals().length, 1, 'one panel');
    // The frontend resolving the same endpoint afterwards must not add a second.
    resolveCommand(ENTRY_ENDPOINT);
    assert.equal(settingsModals().length, 1, 'still exactly one panel');
  });

  it('opens exactly one panel when the frontend resolves the endpoint after OK', async () => {
    const row = guideRow();
    okOn(row);
    resolveCommand(ENTRY_ENDPOINT);
    await tick(activation.FALLBACK_DELAY_MS + 20);
    assert.equal(settingsModals().length, 1, 'command path and fallback path deduplicate');
  });

  it('opens on a click as well, and only once per activation', async () => {
    const row = guideRow();
    clickOn(row);
    clickOn(row);
    await tick(activation.FALLBACK_DELAY_MS + 20);
    assert.equal(settingsModals().length, 1, 'a double click is one activation');
  });

  it('reopens after Back, without stacking panels or listeners', async () => {
    const row = guideRow();
    const listenersBefore = (doc.listeners.get('keydown') || []).length;
    for (let index = 0; index < 4; index += 1) {
      okOn(row);
      await tick(activation.FALLBACK_DELAY_MS + 20);
      // Back: POPUP_BACK first, then the deferred parent refocus.
      resolveCommand({ signalAction: { signal: 'POPUP_BACK' } });
      recorded.length = 0;
    }
    okOn(row);
    await tick(activation.FALLBACK_DELAY_MS + 20);
    assert.equal(settingsModals().length, 1, 'the last activation opened one panel');
    assert.equal((doc.listeners.get('keydown') || []).length, listenersBefore,
      'no key listener was added by reopening');
  });

  it('does not let an OK spent elsewhere reopen the panel on a later focus', () => {
    const other = new FakeElement('div', doc);
    other.textContent = 'Home';
    doc.body.appendChild(other);
    okOn(other);
    assert.equal(activation.guideActivationState().armed, true, 'the press armed an activation');
    // The frontend resolves a browse command for that press: the activation is
    // spent, so a focus resolution of our entry afterwards is ignored.
    resolveCommand({ browseEndpoint: { browseId: 'FEwhat_to_watch' } });
    assert.equal(activation.guideActivationState().armed, false);
    resolveCommand(ENTRY_ENDPOINT);
    assert.deepEqual(settingsModals(), []);
  });

  it('never swallows unrelated keys and does not arm on them', () => {
    const row = guideRow();
    for (const keyCode of [37, 38, 39, 40, 8, 461, 10009]) {
      const event = dispatch(keyEvent('keydown', keyCode, row));
      assert.equal(event.defaultPrevented, false, `key ${keyCode} is not prevented`);
      assert.equal(event.propagationStopped, false, `key ${keyCode} is not stopped`);
    }
    assert.equal(activation.guideActivationState().armed, false, 'navigation keys do not arm');
    assert.deepEqual(settingsModals(), []);
  });

  it('leaves Enter in a text field to the text entry panel', () => {
    const field = new FakeElement('input', doc);
    doc.body.appendChild(field);
    const event = okOn(field);
    assert.equal(event.defaultPrevented, false);
    assert.equal(activation.guideActivationState().armed, false);
    assert.deepEqual(settingsModals(), []);
  });

  it('matches only the entry itself, not the whole sidebar', () => {
    const container = new FakeElement('ytlr-guide-response', doc);
    const list = new FakeElement('div', doc);
    list.textContent = 'Home Subscriptions History Search YTArk Settings';
    container.appendChild(list);
    doc.body.appendChild(container);
    assert.equal(activation.isGuideEntryTarget(list), false, 'a list of entries is not the entry');
    const row = new FakeElement('div', doc);
    row.textContent = 'YTArk Settings';
    list.appendChild(row);
    assert.equal(activation.isGuideEntryTarget(row), true);
    // The first match marks the row, so later presses need no text comparison.
    assert.equal(row.getAttribute('data-ytark-guide-entry'), 'true');
    row.textContent = '';
    assert.equal(activation.isGuideEntryTarget(row), true, 'the marker keeps matching');
  });
});
