import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupEnvironment, initEnglish, lastModal, modalItems, messageText, rowTitle, rowCommands,
  findRow, header, selectedIndex, tick,
} from './helpers/ytlr-harness.mjs';

const { recorded, localStorage } = setupEnvironment({ storage: {
  'yt.leanback.default::auth': 'account-sentinel',
  'unrelated-app-cache': 'must-survive',
} });
await initEnglish();
const config = await import('../config.js');
const registry = await import('../ui/settingsRegistry.js');
const resolve = await import('../resolveCommand.js');
resolve.patchResolveCommand();
const actions = await import('../ui/ytarkActions.js');
const recorderModule = await import('../features/browserDiagnostics.js');
const browser = recorderModule.browserDiagnostics;

function actionFromRow(row) {
  return rowCommands(row).find(command => command.customAction)?.customAction;
}

describe('About diagnostics navigation and scopes', () => {
  it('exposes a default-off browser panel and separate native updater route', async () => {
    assert.equal(config.configRead('recordBrowserDiagnostics'), false);
    assert.equal(registry.findNode(registry.buildSettingsTree(), 'about.diagnostics').type, 'panel');
    actions.handleYtarkAction('YTARK_PANEL_SHOW', { id: 'about' });
    const about = lastModal(recorded, 'ytark-panel-about');
    assert.ok(findRow(about, 'Diagnostics'));
    actions.handleYtarkAction('YTARK_PANEL_SHOW', { id: 'about.diagnostics' });
    const panel = lastModal(recorded, 'ytark-panel-about.diagnostics');
    assert.equal(header(panel).title, 'Diagnostics');
    assert.equal(selectedIndex(panel), 2, 'D-pad selection starts on the first actionable control');
    const titles = modalItems(panel).map(rowTitle).filter(Boolean);
    assert.deepEqual(titles, [
      'Enable / start recording', 'Start new sample', 'View latest report',
      'View recent sessions', 'Clear diagnostic data', 'Android update diagnostics',
    ]);
    const descriptions = modalItems(panel).map(messageText).filter(Boolean).join('\n');
    assert.match(descriptions, /nothing is sent automatically/i);
    assert.match(descriptions, /next launch/i);
    assert.match(descriptions, /separate/i);
    const native = actionFromRow(findRow(panel, 'Android update diagnostics'));
    assert.equal(native.action, 'YTARK_NATIVE_UPDATES_OPEN');
    const clearConfirmRow = actionFromRow(findRow(panel, 'Clear diagnostic data'));
    assert.equal(clearConfirmRow.action, 'YTARK_DIAGNOSTICS_CLEAR_CONFIRM');
    assert.equal(browser.status, 'off');
  });

  it('enables partial capture, displays a scrollable report, and clears only recorder keys', async () => {
    config.configWrite('enableAdBlock', false);
    config.configWrite('reloadHomeOnStartup', false);
    actions.handleYtarkAction('YTARK_DIAGNOSTICS_SET', { enabled: true });
    await tick(5);
    assert.equal(config.configRead('recordBrowserDiagnostics'), true);
    assert.equal(browser.status, 'recording');
    assert.equal(browser.active.capture, 'partial', 'an enable action is not mislabelled as a launch capture');
    assert.equal(browser.record('playback-playing', 'initial', 'proxy'), true);
    assert.equal(browser.record('raw-video-id', 'secret'), false);
    browser._persist({ draft: browser._plainSession(browser.active) });
    assert.ok(localStorage[recorderModule.BROWSER_DIAGNOSTICS_DRAFT_KEY]);

    actions.handleYtarkAction('YTARK_DIAGNOSTICS_LATEST', {});
    const report = lastModal(recorded, 'ytark-browser-diagnostics-report');
    assert.equal(report.openPopupAction.popup.overlaySectionRenderer.overlay.overlayTwoPanelRenderer
      .actionPanel.overlayPanelRenderer.content.scrollPaneRenderer !== undefined, true);
    const reportText = modalItems(report).map(messageText).join('\n');
    assert.match(reportText, /partial sample started in this session/i);
    assert.match(reportText, /browser scope/i);
    assert.match(reportText, /nothing is sent automatically/i);
    assert.doesNotMatch(reportText, /raw-video-id|account-sentinel|private\.invalid|should-not-be-read/i);

    actions.handleYtarkAction('YTARK_DIAGNOSTICS_CLEAR', {});
    assert.equal(localStorage[recorderModule.BROWSER_DIAGNOSTICS_KEY], undefined);
    assert.equal(localStorage[recorderModule.BROWSER_DIAGNOSTICS_DRAFT_KEY], undefined);
    assert.equal(browser.status, 'recording', 'clear starts a new partial sample while enabled');
    assert.equal(browser.active.capture, 'partial');
    assert.equal(config.configRead('enableAdBlock'), false);
    assert.equal(config.configRead('reloadHomeOnStartup'), false);
    assert.equal(localStorage['yt.leanback.default::auth'], 'account-sentinel');
    assert.equal(localStorage['unrelated-app-cache'], 'must-survive');

    actions.handleYtarkAction('YTARK_DIAGNOSTICS_SET', { enabled: false });
    assert.equal(browser.status, 'off', 'disable stops collection immediately');
    assert.equal(config.configRead('recordBrowserDiagnostics'), false);
    assert.equal(localStorage['yt.leanback.default::auth'], 'account-sentinel');
  });

  it('explicit report actions can read retained sessions while collection is off', () => {
    actions.handleYtarkAction('YTARK_DIAGNOSTICS_SET', { enabled: false });
    browser.storage = null;
    localStorage[recorderModule.BROWSER_DIAGNOSTICS_KEY] = JSON.stringify({
      schema: 1, evicted: 0, sessions: [{
        schema: 1, id: 'saved-session', capture: 'launch', status: 'complete',
        clockDomain: 'performance', clockQuality: 'monotonic',
        context: {}, truncated: false,
        events: [{ source: 'browser', clock: 'performance', relativeMs: 0,
          event: 'recording-started', outcome: 'launch', quality: 'observed', valueMs: null }],
      }],
    });
    actions.handleYtarkAction('YTARK_DIAGNOSTICS_LATEST', {});
    const report = lastModal(recorded, 'ytark-browser-diagnostics-report');
    const reportText = modalItems(report).map(messageText).join('\n');
    assert.match(reportText, /Capture: launch capture from userscript bootstrap/);
    assert.equal(browser.status, 'off', 'opening a report does not enable collection');
  });

  it('Clear can remove old local reports while collection is off without touching other data', () => {
    assert.equal(browser.status, 'off');
    localStorage[recorderModule.BROWSER_DIAGNOSTICS_KEY] = JSON.stringify({ schema: 1, sessions: [], evicted: 0 });
    localStorage[recorderModule.BROWSER_DIAGNOSTICS_DRAFT_KEY] = JSON.stringify({ schema: 1, session: {} });
    actions.handleYtarkAction('YTARK_DIAGNOSTICS_CLEAR', {});
    assert.equal(localStorage[recorderModule.BROWSER_DIAGNOSTICS_KEY], undefined);
    assert.equal(localStorage[recorderModule.BROWSER_DIAGNOSTICS_DRAFT_KEY], undefined);
    assert.equal(localStorage['yt.leanback.default::auth'], 'account-sentinel');
    assert.equal(localStorage['unrelated-app-cache'], 'must-survive');
    assert.equal(browser.status, 'off');
  });

  it('uses Back-friendly clear confirmation and never exposes a clipboard or export command', async () => {
    actions.handleYtarkAction('YTARK_PANEL_SHOW', { id: 'about.diagnostics' });
    const panel = lastModal(recorded, 'ytark-panel-about.diagnostics');
    await resolve.default({ customAction: { action: 'YTARK_DIAGNOSTICS_CLEAR_CONFIRM' } });
    const confirm = lastModal(recorded, 'ytark-browser-diagnostics-clear-confirm');
    assert.ok(confirm);
    assert.match(header(confirm).subtitle, /Android reports are cleared separately/i);
    const items = modalItems(confirm);
    const clear = findRow(confirm, 'Clear browser diagnostic data');
    const commands = rowCommands(clear);
    assert.equal(commands[0].signalAction.signal, 'POPUP_BACK');
    assert.equal(commands[1].customAction.action, 'YTARK_DEFERRED');
    const allActions = [...modalItems(panel), ...items].flatMap(item => item?.compactLinkRenderer?.serviceEndpoint?.commandExecutorCommand?.commands || []);
    assert.equal(allActions.some(command => /clipboard|export|download/i.test(JSON.stringify(command))), false);
    // Stop any recorder/timers left by a previous row or action in this process.
    actions.handleYtarkAction('YTARK_DIAGNOSTICS_SET', { enabled: false });
  });
});
