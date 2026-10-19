import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupEnvironment, initEnglish, lastModal, modalItems, messageText, rowTitle, rowSubtitle, rowCommands,
  findRow, header, selectedIndex, tick, press,
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

function dismissalCommands(modal) {
  const dismiss = modal.openPopupAction.popup.overlaySectionRenderer.dismissalCommand;
  return dismiss.commandExecutorCommand?.commands || [];
}

describe('About diagnostics navigation, four-row scope and focus restoration', () => {
  it('shows exactly four primary rows in order and keeps Android updater separate', async () => {
    assert.equal(config.configRead('recordBrowserDiagnostics'), false);
    assert.equal(registry.findNode(registry.buildSettingsTree(), 'about.diagnostics').type, 'panel');
    actions.handleYtarkAction('YTARK_PANEL_SHOW', { id: 'about' });
    const about = lastModal(recorded, 'ytark-panel-about');
    assert.ok(findRow(about, 'Diagnostics'));
    actions.handleYtarkAction('YTARK_PANEL_SHOW', { id: 'about.diagnostics' });
    const panel = lastModal(recorded, 'ytark-panel-about.diagnostics');
    assert.equal(header(panel).title, 'Diagnostics');
    assert.equal(selectedIndex(panel), 1, 'D-pad selection starts on Recording');
    const rows = modalItems(panel);
    assert.deepEqual(rows.map(rowTitle), [
      'Android updater', 'Recording', 'Startup summary', 'Clear diagnostic data',
    ]);
    assert.deepEqual(rows.map(row => row.compactLinkRenderer.itemId), [
      'ytark-diagnostics-android', 'ytark-diagnostics-recording',
      'ytark-diagnostics-startup-summary', 'ytark-diagnostics-clear',
    ]);
    assert.match(rowSubtitle(findRow(panel, 'Recording')), /^Off/);
    assert.match(rowSubtitle(findRow(panel, 'Startup summary')), /No sample/);
    assert.match(rowSubtitle(findRow(panel, 'Startup summary')), /unavailable/i);
    assert.equal(actionFromRow(findRow(panel, 'Android updater')).action, 'YTARK_NATIVE_UPDATES_OPEN');
    assert.equal(actionFromRow(findRow(panel, 'Recording')).action, 'YTARK_DIAGNOSTICS_SET');
    assert.equal(actionFromRow(findRow(panel, 'Startup summary')).action, 'YTARK_DIAGNOSTICS_STARTUP_SUMMARY');
    assert.equal(actionFromRow(findRow(panel, 'Clear diagnostic data')).action, 'YTARK_DIAGNOSTICS_CLEAR_CONFIRM');
    assert.equal(browser.status, 'off');
    assert.equal(config.configRead('recordBrowserDiagnostics'), false);
    assert.equal(localStorage['yt.leanback.default::auth'], 'account-sentinel');
  });

  it('toggles local recording and opens a bounded summary that returns focus to its row', async () => {
    const initial = lastModal(recorded, 'ytark-panel-about.diagnostics')
      || (actions.handleYtarkAction('YTARK_PANEL_SHOW', { id: 'about.diagnostics' }), lastModal(recorded, 'ytark-panel-about.diagnostics'));
    const recording = findRow(initial, 'Recording');
    const recordingAction = actionFromRow(recording);
    assert.deepEqual(recordingAction.parameters, { enabled: true, returnFocusIndex: 1 });
    actions.handleYtarkAction(recordingAction.action, recordingAction.parameters);
    await tick(10);
    assert.equal(config.configRead('recordBrowserDiagnostics'), true);
    assert.equal(browser.status, 'recording');
    assert.equal(browser.active.capture, 'partial', 'turning recording on mid-session never claims a launch capture');
    const enabledPanel = lastModal(recorded, 'ytark-panel-about.diagnostics');
    assert.match(rowSubtitle(findRow(enabledPanel, 'Recording')), /^On/);

    const summaryRow = findRow(enabledPanel, 'Startup summary');
    const summaryAction = actionFromRow(summaryRow);
    assert.deepEqual(summaryAction.parameters, { returnFocusIndex: 2 });
    actions.handleYtarkAction(summaryAction.action, summaryAction.parameters);
    const summary = lastModal(recorded, 'ytark-browser-startup-summary');
    const content = summary.openPopupAction.popup.overlaySectionRenderer.overlay.overlayTwoPanelRenderer
      .actionPanel.overlayPanelRenderer.content;
    assert.ok(content.scrollPaneRenderer, 'summary uses the native scroll-pane renderer');
    const summaryRows = modalItems(summary).map(messageText);
    assert.ok(summaryRows.length <= 24, 'native summary row count is bounded');
    assert.ok(summaryRows.every(line => line.length <= 88), 'long native text is word-wrapped without CSS');
    const summaryText = summaryRows.join('\n');
    assert.match(summaryText, /Recording: On/);
    assert.match(summaryText, /Latest sample: Partial · active/);
    assert.match(summaryText, /Latest result: Sample is still recording/);
    assert.match(summaryText, /Actual readiness mode:/);
    assert.match(summaryText, /not Android app start/);
    const back = dismissalCommands(summary);
    assert.equal(back[0].signalAction.signal, 'POPUP_BACK');
    assert.equal(back[1].customAction.action, 'YTARK_DEFERRED');
    assert.deepEqual(back[1].customAction.parameters.parameters, {
      id: 'about.diagnostics', update: true, focusIndex: 2,
    });
    await resolve.default(summary.openPopupAction.popup.overlaySectionRenderer.dismissalCommand);
    await tick(10);
    assert.equal(selectedIndex(lastModal(recorded, 'ytark-panel-about.diagnostics')), 2,
      'Back restores focus to Startup summary');
  });

  it('reads old valid samples while recording is Off and ignores retired launch labels', async () => {
    actions.handleYtarkAction('YTARK_DIAGNOSTICS_SET', { enabled: false });
    const oldSample = {
      schema: 1, id: 'saved-launch', capture: 'launch', status: 'complete',
      clockDomain: 'performance', clockQuality: 'monotonic', truncated: false,
      context: {
        bundleVersion: '3.8.0', scriptTag: 's39', baseTag: 'v2.0.2',
        reloadHomeOnStartup: true, fasterStartup: false, startupDestination: 'home',
        startupComparisonKind: 'warm',
      },
      events: [
        { source: 'browser', clock: 'performance', relativeMs: 0,
          event: 'recording-started', outcome: 'launch', quality: 'observed', valueMs: null },
        { source: 'browser', clock: 'performance', relativeMs: 5,
          event: 'startup-readiness-mode', outcome: 'normal-disabled', quality: 'observed', valueMs: null },
        { source: 'browser', clock: 'performance', relativeMs: 10,
          event: 'ui-module-evaluated', outcome: 'observed', quality: 'proxy', valueMs: null },
        { source: 'browser', clock: 'performance', relativeMs: 155.2,
          event: 'startup-readiness-complete', outcome: 'complete', quality: 'observed', valueMs: null },
        { source: 'browser', clock: 'performance', relativeMs: 155.2,
          event: 'controls-ready', outcome: 'observed', quality: 'observed', valueMs: null },
        { source: 'browser', clock: 'performance', relativeMs: 155.2,
          event: 'recording-ended', outcome: 'complete', quality: 'observed', valueMs: null },
      ],
    };
    localStorage[recorderModule.BROWSER_DIAGNOSTICS_KEY] = JSON.stringify({
      schema: 1, evicted: 0, sessions: [oldSample],
    });
    browser.storage = null;
    actions.handleYtarkAction('YTARK_PANEL_SHOW', { id: 'about.diagnostics' });
    const panel = lastModal(recorded, 'ytark-panel-about.diagnostics');
    const startupRow = findRow(panel, 'Startup summary');
    assert.match(rowSubtitle(startupRow), /Launch · complete/);
    assert.match(rowSubtitle(startupRow), /145\.2 ms/);
    const startupAction = actionFromRow(startupRow);
    actions.handleYtarkAction(startupAction.action, startupAction.parameters);
    const summary = modalItems(lastModal(recorded, 'ytark-browser-startup-summary')).map(messageText).join(' ');
    assert.match(summary, /Recording: Off/);
    assert.match(summary, /Valid startup duration for latest sample: 145\.2 ms/);
    assert.match(summary, /Faster startup preference: Off/);
    assert.match(summary, /Actual readiness mode: Normal cadence \(Faster startup off\)/);
    assert.doesNotMatch(summary, /startupComparisonKind|cold|warm|comparison/i);
    assert.equal(browser.status, 'off', 'opening a summary never enables collection');
  });

  it('Clear has confirmation, restores focus on Cancel, and removes only browser samples on confirmation', async () => {
    assert.equal(browser.status, 'off');
    localStorage[recorderModule.BROWSER_DIAGNOSTICS_DRAFT_KEY] = JSON.stringify({ schema: 1, session: {} });
    const panel = lastModal(recorded, 'ytark-panel-about.diagnostics')
      || (actions.handleYtarkAction('YTARK_PANEL_SHOW', { id: 'about.diagnostics' }), lastModal(recorded, 'ytark-panel-about.diagnostics'));
    const clearAction = actionFromRow(findRow(panel, 'Clear diagnostic data'));
    assert.deepEqual(clearAction.parameters, { returnFocusIndex: 3 });
    actions.handleYtarkAction(clearAction.action, clearAction.parameters);
    const confirm = lastModal(recorded, 'ytark-browser-diagnostics-clear-confirm');
    assert.ok(confirm);
    assert.equal(header(confirm).subtitle, 'Only local browser samples are removed');
    assert.match(messageText(modalItems(confirm)[0]), /Settings, cookies, accounts, playback state/);
    assert.match(messageText(modalItems(confirm)[0]), /Android updater data are not changed/);
    const cancel = findRow(confirm, 'Cancel');
    await press(resolve.default, cancel);
    const afterCancel = lastModal(recorded, 'ytark-panel-about.diagnostics');
    assert.equal(selectedIndex(afterCancel), 3, 'Cancel restores focus to Clear diagnostic data');
    assert.ok(localStorage[recorderModule.BROWSER_DIAGNOSTICS_DRAFT_KEY], 'Cancel preserves saved content');

    actions.handleYtarkAction('YTARK_DIAGNOSTICS_SET', { enabled: true });
    await tick(10);
    localStorage[recorderModule.BROWSER_DIAGNOSTICS_KEY] = JSON.stringify({ schema: 1, evicted: 0, sessions: [] });
    const enabledPanel = lastModal(recorded, 'ytark-panel-about.diagnostics');
    actions.handleYtarkAction('YTARK_DIAGNOSTICS_CLEAR_CONFIRM', { returnFocusIndex: 3 });
    const clearConfirm = lastModal(recorded, 'ytark-browser-diagnostics-clear-confirm');
    const confirmCommands = rowCommands(findRow(clearConfirm, 'Clear diagnostic data'));
    assert.equal(confirmCommands[0].signalAction.signal, 'POPUP_BACK');
    assert.equal(confirmCommands[1].customAction.action, 'YTARK_DEFERRED');
    assert.deepEqual(confirmCommands[1].customAction.parameters.parameters, { returnFocusIndex: 3 });
    await press(resolve.default, findRow(clearConfirm, 'Clear diagnostic data'));
    await tick(10);
    assert.equal(localStorage[recorderModule.BROWSER_DIAGNOSTICS_KEY], undefined);
    assert.equal(localStorage[recorderModule.BROWSER_DIAGNOSTICS_DRAFT_KEY], undefined);
    assert.equal(browser.status, 'recording', 'Clear restarts a new partial sample only when recording is On');
    assert.equal(browser.active.capture, 'partial');
    assert.equal(config.configRead('enableAdBlock'), true);
    assert.equal(localStorage['yt.leanback.default::auth'], 'account-sentinel');
    assert.equal(localStorage['unrelated-app-cache'], 'must-survive');
    assert.equal(selectedIndex(lastModal(recorded, 'ytark-panel-about.diagnostics')), 3);
    assert.ok(enabledPanel);
    actions.handleYtarkAction('YTARK_DIAGNOSTICS_SET', { enabled: false, returnFocusIndex: 1 });
    await tick(10);
    assert.equal(browser.status, 'off');
    assert.equal(config.configRead('recordBrowserDiagnostics'), false);
  });
});
