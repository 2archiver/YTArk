// OLED Black theme, "Remove player dimming" and their composition with the
// Premium wordmark, custom colours and inactivity dimming (ui/theme.js,
// ui/appearanceStyles.js).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FakeElement, FakeMutationObserver, waitFor } from './helpers/fake-dom.mjs';
import { setupEnvironment } from './helpers/ytlr-harness.mjs';

const { doc } = setupEnvironment();
const { configRead, configWrite, configChangeEmitter } = await import('../config.js');
const theme = await import('../ui/theme.js');
const styles = await import('../ui/appearanceStyles.js');
const { OLED_TOKENS } = await import('../ui/themeTokens.js');
const registry = await import('../ui/settingsRegistry.js');

const root = doc.documentElement;
const has = name => root.classList.contains(name);
const managedStyles = () => doc.querySelectorAll('style[data-ytark-managed-theme="true"]');

function rulesFor(css, rootClass) {
  // Split "selector { declarations }" blocks and keep those scoped to rootClass.
  const blocks = [];
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

describe('OLED Black theme', () => {
  it('applies to a fresh install through one managed stylesheet and a root class', () => {
    assert.equal(configRead('uiTheme'), 'oled');
    assert.ok(has(styles.ROOT_CLASSES.oled));
    assert.equal(managedStyles().length, 1);
    const css = managedStyles()[0].textContent;
    assert.match(css, /html\.ytark-theme-oled \.ytLrGuideResponseContainer/);
    assert.match(css, /background-color: #000000 !important/);
  });

  it('switches live, restores the saved custom colours and keeps them untouched', () => {
    configWrite('focusContainerColor', '#0a1628');
    configWrite('routeColor', '#0d1f3c');
    configWrite('uiTheme', 'youtube');
    assert.equal(has(styles.ROOT_CLASSES.oled), false);
    const css = managedStyles()[0].textContent;
    assert.match(css, /#container \{ background-color: #0d1f3c !important; \}/);
    assert.match(css, /yt-focus-container \{ background-color: #0a1628; \}/);

    configWrite('uiTheme', 'oled');
    assert.ok(has(styles.ROOT_CLASSES.oled));
    // OLED overrides with higher specificity; the saved colours are not rewritten.
    assert.equal(configRead('focusContainerColor'), '#0a1628');
    assert.equal(configRead('routeColor'), '#0d1f3c');
    assert.match(managedStyles()[0].textContent, /#container \{ background-color: #0d1f3c !important; \}/);
  });

  it('never recolours images, thumbnails, video, SVG or subtitles, and uses no filters', () => {
    const css = styles.buildAppearanceCss();
    for (const block of rulesFor(css, styles.ROOT_CLASSES.oled)) {
      for (const selector of block.selectors) {
        assert.doesNotMatch(selector, /\b(img|video|svg|canvas)\b|thumbnail|caption|subtitle|ytlr-player\b/i, selector);
      }
    }
    assert.doesNotMatch(css, /filter\s*:|opacity\s*:|brightness|invert|mix-blend/i);
  });

  it('restores its own classes when the frontend rewrites <html class>', async () => {
    root.setAttribute('class', 'frontend-owned');
    const observer = FakeMutationObserver.instances.find(item => item.active && item.root === root
      && item.options && item.options.attributeFilter && item.options.attributeFilter.length === 1);
    assert.ok(observer, 'one scoped observer watches <html class>');
    observer.callback([{ type: 'attributes', attributeName: 'class', target: root }]);
    assert.ok(has(styles.ROOT_CLASSES.oled));
    assert.ok(has('frontend-owned'), 'frontend classes are kept');
  });

  it('does not multiply styles, observers or listeners over repeated cycles', () => {
    const listeners = configChangeEmitter.listenerCount('configChange');
    const observers = FakeMutationObserver.activeCount;
    for (let index = 0; index < 40; index += 1) {
      configWrite('uiTheme', index % 2 ? 'oled' : 'youtube');
      configWrite('removePlayerScrim', index % 2 === 0);
      theme.updateStyle();
    }
    configWrite('uiTheme', 'oled');
    configWrite('removePlayerScrim', true);
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

    for (const value of ['youtube', 'oled', 'youtube', 'oled']) {
      configWrite('uiTheme', value);
      branding.refreshInk(doc);
    }
    await waitFor(150);
    const mark = host.querySelector('[data-ytark-premium-wordmark="true"]');
    assert.equal(mark.getAttribute('data-ytark-premium-ink'), '#ffffff');
    const emblem = mark.querySelectorAll('[data-ytark-premium-paint]');
    const sourceFills = YOUTUBE_PREMIUM_WORDMARK.paths.filter(entry => entry.paint !== 'ink').map(entry => entry.fill);
    assert.deepEqual(emblem.map(node => node.getAttribute('fill')), sourceFills, 'the red emblem is never inverted');
    assert.equal(rootObservers(), before, 'theme changes create no second Premium theme observer');
    branding.cleanup();
  });
});

describe('OLED Black labelling', () => {
  it('describes exactly the surfaces the stylesheet themes, and no more', () => {
    const node = registry.findNode(registry.buildSettingsTree(), 'appearance.theme');
    assert.ok(node, 'the theme setting is in the tree');
    assert.match(node.description, /surfaces YTArk can style/,
      'the row says the theme is scoped, not global');
    const oled = node.options.find(option => option.value === 'oled');
    assert.match(oled.description, /app backdrop/i);
    assert.match(oled.description, /browse, search and settings surfaces/i);
    assert.match(oled.description, /YTArk dialogs/i);
    assert.match(oled.description, /keep their own colours/i,
      'and it says what is left to YouTube');
    assert.doesNotMatch(oled.description, /everything|entire|all screens|whole app/i,
      'no global-coverage claim');
  });
});

describe('OLED Black coverage and lifecycle', () => {
  const css = () => managedStyles()[0].textContent;
  const blocks = () => rulesFor(css(), styles.ROOT_CLASSES.oled);
  const blockFor = fragment => blocks().find(block => block.selectors.some(selector => selector.includes(fragment)));

  it('blacks the app backdrop, the browsing surfaces and the dialogs YTArk opens', () => {
    // The root element gets its own rule (a descendant `html` would match nothing).
    assert.match(css(), new RegExp(`html\\.${styles.ROOT_CLASSES.oled} \\{\\s*background-color: #000000 !important;`));
    for (const selector of ['body', '#container', '.ytLrTvBrowseRendererHost',
      '.ytLrGuideResponseContainer', '.ytLrClassicSearchPageHost', '.ytLrAccountSelectorHost',
      '.ytLrOverlaySectionRendererOverlay', '.ytLrOverlayTwoPanelRendererActionPanel',
      '.ytLrOverlayPanelRendererContent']) {
      const needle = `html.${styles.ROOT_CLASSES.oled} ${selector}`;
      const block = blocks().find(item => item.selectors.some(entry => entry.includes(needle)));
      assert.ok(block, `${selector} is covered by the OLED rule`);
      assert.match(block.declarations, /background-color: #000000 !important/, `${selector} is true black`);
      assert.match(block.declarations, /background-image: none !important/, 'surface gradients cannot cover black');
    }
  });

  it('keeps the focused entry visibly distinct from the black backgrounds', () => {
    const focus = blockFor('yt-focus-container');
    assert.ok(focus, 'the sidebar focus surface is styled under OLED');
    assert.match(focus.declarations, new RegExp(`background-color: ${OLED_TOKENS.surfaceFocus} !important`));
    assert.doesNotMatch(focus.declarations, /#000000/, 'focus is not painted black on black');
    // The frontend's own focus pills are untouched, so focused controls keep
    // their high-contrast look.
    assert.doesNotMatch(css(), /zylon-focus[^{]*\{[^}]*background-color/);
  });

  it('publishes black theme variables and never a filter, tint or opacity change', () => {
    assert.match(css(), /--yt-spec-general-background-a: #000000;/);
    assert.match(css(), /--yt-spec-brand-background-solid: #000000;/);
    assert.doesNotMatch(css(), /filter\s*:|backdrop-filter|mix-blend|opacity\s*:/i);
  });

  it('is re-applied after the DOM is rebuilt, and restores a stylesheet the frontend dropped', () => {
    // A route change: the frontend rebuilds its content and drops injected head
    // nodes. The classes and the stylesheet must both come back.
    root.setAttribute('class', 'frontend-owned');
    managedStyles()[0].detach();
    assert.equal(managedStyles().length, 0);
    const headObserver = FakeMutationObserver.instances.find(item => item.active && item.root === doc.head);
    assert.ok(headObserver, 'one narrowly scoped observer watches <head>');
    headObserver.callback([{ type: 'childList', target: doc.head }]);
    assert.equal(managedStyles().length, 1, 'exactly one managed stylesheet again');
    assert.match(css(), /html\.ytark-theme-oled/);
    assert.equal(theme.themeStatus().restorations, 1);
    // The startup step (ui/ui.js) re-applies the theme once the TV DOM exists.
    theme.updateStyle();
    assert.equal(managedStyles().length, 1, 're-applying never duplicates the stylesheet');
    assert.ok(has(styles.ROOT_CLASSES.oled), 'the root class survives a frontend rewrite');
    assert.ok(has('frontend-owned'), 'frontend classes are kept');
  });

  it('stops restoring after a bounded number of removals instead of scanning forever', () => {
    const headObserver = FakeMutationObserver.instances.find(item => item.root === doc.head);
    for (let index = 0; index < theme.MAX_STYLE_RESTORATIONS + 3 && headObserver.active; index += 1) {
      const style = managedStyles()[0];
      if (style) style.detach();
      headObserver.callback([{ type: 'childList', target: doc.head }]);
    }
    assert.ok(theme.themeStatus().restorations <= theme.MAX_STYLE_RESTORATIONS,
      `restorations are capped (${theme.themeStatus().restorations})`);
    assert.equal(headObserver.active, false, 'the observer gave up instead of fighting the frontend');
    // One clean re-application brings the theme back for the rest of the session.
    theme.resetThemeForTests();
    theme.updateStyle();
    assert.equal(managedStyles().length, 1);
    assert.ok(has(styles.ROOT_CLASSES.oled));
  });

  it('restores the normal theme, including the saved colours, when OLED is turned off', () => {
    configWrite('focusContainerColor', '#0a1628');
    configWrite('routeColor', '#0d1f3c');
    configWrite('uiTheme', 'youtube');
    assert.equal(has(styles.ROOT_CLASSES.oled), false);
    assert.match(css(), /#container \{ background-color: #0d1f3c !important; \}/);
    assert.match(css(), /yt-focus-container \{ background-color: #0a1628; \}/);
    // The OLED rules are still in the sheet but inert: they only apply through
    // the root class, so no original style was permanently changed.
    assert.match(css(), /html\.ytark-theme-oled/);
    configWrite('uiTheme', 'oled');
    assert.ok(has(styles.ROOT_CLASSES.oled));
  });
});
