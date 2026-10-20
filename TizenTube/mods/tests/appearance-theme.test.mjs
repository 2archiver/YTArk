// The appearance sheet: "Remove player dimming" and "Hide channel
// watermark", their composition with the Premium wordmark, and proof that
// the retired OLED theme and the retired navigation/content colour
// overrides left no trace (ui/theme.js, ui/appearanceStyles.js).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FakeElement, FakeMutationObserver, waitFor } from './helpers/fake-dom.mjs';
import { setupEnvironment } from './helpers/ytlr-harness.mjs';

const { doc } = setupEnvironment();
const { configRead, configWrite, configChangeEmitter, configKeys } = await import('../config.js');
const theme = await import('../ui/theme.js');
const styles = await import('../ui/appearanceStyles.js');
const registry = await import('../ui/settingsRegistry.js');

const root = doc.documentElement;
const rootClasses = () => String(root.getAttribute('class') || '').split(/\s+/).filter(Boolean);
const has = name => root.classList.contains(name);
const managedStyles = () => doc.querySelectorAll('style[data-ytark-managed-theme="true"]');

function rulesFor(css, rootClass) {
  // Split "selector { declarations }" blocks and keep those scoped to rootClass.
  const blocks = [];
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = pattern.exec(css))) {
    const selectors = match[1].split(',').map(item => item.trim()).filter(Boolean);
    if (selectors.some(selector => selector.includes(`html.${rootClass}`))) {
      blocks.push({ selectors, declarations: match[2] });
    }
  }
  return blocks;
}

describe('appearance stylesheet', () => {
  it('publishes the feature rules in one managed stylesheet, with no colour override', () => {
    assert.equal(managedStyles().length, 1);
    const css = managedStyles()[0].textContent;
    // The navigation/content colour overrides were retired in 4.0:
    // the standard YouTube/YTArk chrome styling is used, so no rule
    // paints a custom colour onto the guide focus container or the
    // content root.
    assert.doesNotMatch(css, /yt-focus-container/, 'no navigation-bar colour rule');
    assert.doesNotMatch(css, /#container\s*\{[^}]*background-color:\s*#/i,
      'no content-root colour rule');
    assert.doesNotMatch(css, /background-color:\s*#[0-9a-f]{3,8}/i, 'no custom hex colour paint');
    assert.doesNotMatch(css, /filter\s*:|backdrop-filter|mix-blend|opacity\s*:/i,
      'no filters, tints or opacity changes');
  });

  it('scopes the base idom shadow rule to the player instead of every same-named div', () => {
    const css = readFileSync(new URL('../ui/ui.css', import.meta.url), 'utf8');
    assert.match(css, /ytlr-watch-default\s+div\[idomkey="shadow"\]/);
    assert.match(css, /ytlr-watch-default\s+\.ytLrWatchDefaultShadow/);
    assert.doesNotMatch(css, /(?:^|,\s*)div\[idomkey="shadow"\]/m,
      'non-player elements with the same internal attribute keep their own appearance');
  });

  it('ignores stale stored colour values and flips classes when a feature changes', () => {
    // Stale values left behind by the retired colour settings must
    // not be applied: every consumer stopped reading them, so the
    // standard YouTube/YTArk chrome styling is used instead.
    configWrite('focusContainerColor', '#0a1628');
    configWrite('routeColor', '#0d1f3c');
    let css = managedStyles()[0].textContent;
    assert.doesNotMatch(css, /#0a1628|#0d1f3c/, 'stale colours are not painted');
    assert.doesNotMatch(css, /yt-focus-container/, 'no navigation-bar colour rule');

    // Feature rules are static in the sheet: switching a feature off only
    // drops the root class, the rule stays in place, inert.
    configWrite('hidePlayerWatermark', false);
    css = managedStyles()[0].textContent;
    assert.equal(has(styles.ROOT_CLASSES.hideWatermark), false);
    assert.match(css, /html\.ytark-hide-watermark/, 'the rule stays in the sheet, inert');

    configWrite('hidePlayerWatermark', true);
    assert.ok(has(styles.ROOT_CLASSES.hideWatermark));
  });

  it('never recolours or re-shadows media content: no backgrounds, no filters, no tints', () => {
    const css = styles.buildAppearanceCss();
    for (const rootClass of Object.values(styles.ROOT_CLASSES)) {
      for (const block of rulesFor(css, rootClass)) {
        const paints = /background-color|background-image/.test(block.declarations);
        for (const selector of block.selectors) {
          if (paints) {
            assert.doesNotMatch(selector, /\b(img|video|svg|canvas)\b|thumbnail|caption|subtitle|ytlr-player\b/i,
              `a rule that paints may not target media or text content: ${selector}`);
          }
          // The caption and focus selectors may only appear in text-shadow
          // resets (crisp captions and focus pills), never in anything else.
          if (/caption|subtitle|zylon-focus|ytLrButtonFocused/i.test(selector)) {
            assert.match(block.declarations, /text-shadow: none/,
              `caption/focus selectors only ever reset the shadow: ${selector}`);
            assert.doesNotMatch(block.declarations, /background|color\s*:/i,
              `caption/focus selectors never paint: ${selector}`);
          }
        }
      }
    }
    assert.doesNotMatch(css, /filter\s*:|backdrop-filter|mix-blend|opacity\s*:/i);
  });

  it('restores its own classes when the frontend rewrites <html class>', () => {
    configWrite('removePlayerScrim', true);
    root.setAttribute('class', 'frontend-owned');
    const observer = FakeMutationObserver.instances.find(item => item.active && item.root === root
      && item.options && item.options.attributeFilter && item.options.attributeFilter.length === 1);
    assert.ok(observer, 'one scoped observer watches <html class>');
    observer.callback([{ type: 'attributes', attributeName: 'class', target: root }]);
    assert.ok(has(styles.ROOT_CLASSES.noScrim));
    assert.ok(has('frontend-owned'), 'frontend classes are kept');
  });

  it('does not multiply styles, observers or listeners over repeated cycles', () => {
    const listeners = configChangeEmitter.listenerCount('configChange');
    const observers = FakeMutationObserver.activeCount;
    for (let index = 0; index < 40; index += 1) {
      configWrite('removePlayerScrim', index % 2 === 0);
      configWrite('hidePlayerWatermark', index % 2 === 1);
      theme.updateStyle();
    }
    assert.equal(managedStyles().length, 1);
    assert.equal(FakeMutationObserver.activeCount, observers);
    assert.equal(configChangeEmitter.listenerCount('configChange'), listeners);
  });
});

describe('Remove player dimming', () => {
  it('clears only the control-overlay scrim and keeps captions out of the text shadow', () => {
    const css = styles.buildAppearanceCss();
    const blocks = rulesFor(css, styles.ROOT_CLASSES.noScrim);
    const scrim = blocks.find(block => block.declarations.includes('background-image: none'));
    assert.deepEqual(scrim.selectors, styles.SCRIM_SELECTORS.map(selector => `html.${styles.ROOT_CLASSES.noScrim} ${selector}`));
    assert.match(scrim.declarations, /background-color: transparent !important/);
    for (const block of blocks) {
      for (const selector of block.selectors) {
        assert.doesNotMatch(selector, /(^|\s)video\b|html5-video-player|ytlr-player\b|#container|aria-modal|Overlay/,
          `the scrim feature must not touch the video, the player container or dialog backdrops: ${selector}`);
      }
    }
    const captionReset = blocks.find(block => block.selectors.some(selector => selector.includes('caption-window')));
    assert.match(captionReset.declarations, /text-shadow: none/);
    assert.ok(captionReset.selectors.some(selector => selector.includes('.zylon-focus')),
      'focused controls keep crisp text without the readability shadow');
  });

  it('toggles a root class live and back to the stock scrim immediately', () => {
    configWrite('removePlayerScrim', false);
    assert.equal(has(styles.ROOT_CLASSES.noScrim), false);
    configWrite('removePlayerScrim', true);
    assert.ok(has(styles.ROOT_CLASSES.noScrim));
  });

  it('stays independent of inactivity screen dimming in all four combinations', () => {
    const container = new FakeElement('div', doc);
    container.setAttribute('id', 'container');
    doc.body.appendChild(container);
    for (const dimming of [false, true]) {
      for (const noScrim of [false, true]) {
        configWrite('enableScreenDimming', dimming);
        // What ui.js does after the inactivity timeout:
        if (dimming) container.style.setProperty('opacity', '0.5', 'important');
        else container.style.removeProperty('opacity');
        configWrite('removePlayerScrim', noScrim);
        assert.equal(container.style.getPropertyValue('opacity'), dimming ? '0.5' : '',
          'the scrim setting never changes the dimming opacity');
        assert.equal(has(styles.ROOT_CLASSES.noScrim), noScrim);
        assert.equal(configRead('enableScreenDimming'), dimming);
      }
    }
    container.detach();
  });
});

describe('Hide channel watermark', () => {
  it('targets only the watermark element YTArk marks, scoped to the root class', () => {
    const css = styles.buildAppearanceCss();
    const blocks = rulesFor(css, styles.ROOT_CLASSES.hideWatermark);
    const hide = blocks.find(block => block.declarations.includes('display: none'));
    assert.ok(hide, 'one rule hides the marked watermark element');
    assert.equal(hide.selectors.length, 1);
    assert.equal(hide.selectors[0], `html.${styles.ROOT_CLASSES.hideWatermark} [${styles.WATERMARK_ATTRIBUTE}="hidden"]`);
    assert.match(hide.declarations, /display: none !important/);
  });

  it('toggles the root class live, and the rule stays in the sheet, inert when off', () => {
    configWrite('hidePlayerWatermark', false);
    assert.equal(has(styles.ROOT_CLASSES.hideWatermark), false);
    configWrite('hidePlayerWatermark', true);
    assert.ok(has(styles.ROOT_CLASSES.hideWatermark));
    assert.match(managedStyles()[0].textContent, /html\.ytark-hide-watermark/);
  });
});

describe('the retired OLED theme', () => {
  it('leaves no root class, no stylesheet rule and no setting behind', () => {
    configWrite('removePlayerScrim', true);
    configWrite('hidePlayerWatermark', true);
    for (const name of rootClasses()) {
      assert.doesNotMatch(name, /^ytark-theme-/i, `no theme class may exist: ${name}`);
    }
    assert.doesNotMatch(managedStyles()[0].textContent, /ytark-theme-oled/i, 'no OLED rule in the sheet');
    assert.equal(configRead('uiTheme'), undefined, 'the key is retired, not reset');
    assert.equal(configKeys().includes('uiTheme'), false, 'the key is not a setting any more');
    assert.ok(!registry.findNode(registry.buildSettingsTree(), 'appearance.theme'),
      'the Theme row is gone from the settings tree');
    assert.ok(!Object.values(styles.ROOT_CLASSES).some(name => /^ytark-theme-/i.test(name)),
      'no theme root class is defined');
  });

  it('no longer reacts to a uiTheme write', () => {
    const cssBefore = managedStyles()[0].textContent;
    configWrite('uiTheme', 'oled');
    assert.equal(managedStyles()[0].textContent, cssBefore, 'the sheet is untouched by a retired key');
    assert.ok(!rootClasses().some(name => /^ytark-theme-/i.test(name)));
  });
});

describe('composition with the Premium wordmark', () => {
  it('keeps the lettering on the header foreground and the emblem paint, with no extra theme observer', async () => {
    const { YOUTUBE_PREMIUM_WORDMARK } = await import('../assets/youtubePremiumLogo.generated.js');
    const host = new FakeElement('ytlr-logo-entity', doc);
    host.__rectHeight = 52;
    host.style.setProperty('color', 'rgb(255, 255, 255)');
    const artwork = new FakeElement('ytlr-thumbnail-details', doc);
    artwork.style.setProperty('background-image', 'url("https://i.ytimg.com/youtube_logo.png")');
    host.appendChild(artwork);
    doc.body.appendChild(host);

    const branding = await import('../features/premiumBranding.js');
    assert.equal(branding.setPremiumLogo(host, true, doc), true);
    const rootObservers = () => FakeMutationObserver.instances.filter(item => item.active && item.root === root).length;
    const before = rootObservers();

    // Appearance feature flips used to change the root classes alongside the
    // (removed) theme: the wordmark must still need no observer of its own.
    for (const value of [true, false, true, false]) {
      configWrite('removePlayerScrim', value);
      branding.refreshInk(doc);
    }
    await waitFor(150);
    const mark = host.querySelector('[data-ytark-premium-wordmark="true"]');
    assert.equal(mark.getAttribute('data-ytark-premium-ink'), '#ffffff');
    const emblem = mark.querySelectorAll('[data-ytark-premium-paint]');
    const sourceFills = YOUTUBE_PREMIUM_WORDMARK.paths.filter(entry => entry.paint !== 'ink').map(entry => entry.fill);
    assert.deepEqual(emblem.map(node => node.getAttribute('fill')), sourceFills, 'the red emblem is never inverted');
    assert.equal(rootObservers(), before, 'appearance changes create no second Premium theme observer');
    branding.cleanup();
  });
});

describe('lifecycle', () => {
  const css = () => managedStyles()[0].textContent;

  it('is re-applied after the DOM is rebuilt, and restores a stylesheet the frontend dropped', () => {
    configWrite('removePlayerScrim', true);
    // A route change: the frontend rebuilds its content and drops injected head
    // nodes. The classes and the stylesheet must both come back.
    root.setAttribute('class', 'frontend-owned');
    managedStyles()[0].detach();
    assert.equal(managedStyles().length, 0);
    const headObserver = FakeMutationObserver.instances.find(item => item.active && item.root === doc.head);
    assert.ok(headObserver, 'one narrowly scoped observer watches <head>');
    headObserver.callback([{ type: 'childList', target: doc.head }]);
    assert.equal(managedStyles().length, 1, 'exactly one managed stylesheet again');
    assert.equal(theme.themeStatus().restorations, 1);
    // The startup step (ui/ui.js) re-applies the appearance once the TV DOM exists.
    theme.updateStyle();
    assert.equal(managedStyles().length, 1, 're-applying never duplicates the stylesheet');
    assert.ok(has(styles.ROOT_CLASSES.noScrim), 'the root class survives a frontend rewrite');
    assert.ok(has('frontend-owned'), 'frontend classes are kept');
  });

  it('stops restoring after a bounded number of removals instead of scanning forever', () => {
    configWrite('removePlayerScrim', true);
    const headObserver = FakeMutationObserver.instances.find(item => item.root === doc.head);
    for (let index = 0; index < theme.MAX_STYLE_RESTORATIONS + 3 && headObserver.active; index += 1) {
      const style = managedStyles()[0];
      if (style) style.detach();
      headObserver.callback([{ type: 'childList', target: doc.head }]);
    }
    assert.ok(theme.themeStatus().restorations <= theme.MAX_STYLE_RESTORATIONS,
      `restorations are capped (${theme.themeStatus().restorations})`);
    assert.equal(headObserver.active, false, 'the observer gave up instead of fighting the frontend');
    // One clean re-application brings the appearance back for the rest of the session.
    theme.resetThemeForTests();
    theme.updateStyle();
    assert.equal(managedStyles().length, 1);
    assert.ok(has(styles.ROOT_CLASSES.noScrim));
  });
});
