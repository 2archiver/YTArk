/**
 * The shared YTArk settings registry.
 *
 * One tree describes every YTArk setting: stable id, localized title and
 * description, category (its position in the tree), search keywords, value
 * type and config key, availability and dependency information, and the real
 * action. The YTArk Settings menus (ui/settings.js) and settings search
 * (ui/settingsSearch.js) are both generated from this tree, so they cannot
 * drift apart, and every change goes through the same configuration path.
 *
 * Node types
 *   toggle  boolean config key (`invert` shows the opposite, e.g. "Hide Shorts")
 *   choice  one value of `key` from `options`
 *   multi   array config key; each option toggles membership
 *   menu    a submenu of `children`
 *   action  runs `command` (real YTArk/YouTube commands)
 *   panel   an information panel (`panel()` builds title/subtitle/content)
 *   link    opens another menu (`target`); not indexed separately
 *
 * Commands only ever carry node ids, never node objects, so nothing in this
 * tree is serialized into YouTube's command state.
 */

import { t } from 'i18next';
import qrcode from 'qrcode-npm';
import { configRead, configDefault } from '../config.js';
import { PRESETS, QUALITY_LEVELS } from '../features/tvControls.js';
import { overlayPanelItemListRenderer, scrollPaneRenderer, overlayMessageRenderer, QrCodeRenderer } from './ytUI.js';
import { tx } from '../translations/text.js';
import { whatsNewState } from '../features/whatsNew.js';

const qrcodes = {};

function bridge() {
  try {
    return typeof window !== 'undefined' && window.h5vcc && window.h5vcc.tizentube ? window.h5vcc.tizentube : null;
  } catch (_) {
    return null;
  }
}

/** Device capabilities that decide whether a setting can work here. */
export function runtimeCapabilities() {
  const native = bridge();
  let pip = false;
  try {
    pip = !!(native && typeof native.HasSystemFeature === 'function'
      && native.HasSystemFeature('android.software.picture_in_picture'));
  } catch (_) {
    pip = false;
  }
  return {
    frameRate: !!(native && typeof native.SetFrameRate === 'function'),
    pictureInPicture: pip,
    userAgent: !!(native && typeof native.SetUserAgent === 'function'),
  };
}

export function ytarkDisplayVersion() {
  try {
    const getVersion = bridge() && bridge().GetVersion;
    const version = typeof getVersion === 'function' ? String(getVersion()) : '';
    const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-(?:ytark|personal)\.[1-9]\d*)?$/);
    if (match) return match[3] === '0' ? `${match[1]}.${match[2]}` : `${match[1]}.${match[2]}.${match[3]}`;
  } catch (error) {
    console.warn('[YTArk] Could not read display version for About YTArk:', error);
  }
  return 'unknown';
}

export function ytarkUpdateSubtitle() {
  const version = ytarkDisplayVersion();
  if (version === 'unknown') {
    return 'Installed version: unknown · check the official YTArk release from here';
  }
  return 'Installed version: ' + version + ' · check the official stable release';
}

function qrFor(name, link) {
  if (!qrcodes[name]) {
    try {
      const qr = qrcode.qrcode(6, 'H');
      qr.addData(link);
      qr.make();
      const match = qr.createImgTag(8, 8).match(/src="([^"]+)"/);
      qrcodes[name] = match ? match[1] : '';
    } catch (error) {
      console.warn('[YTArk] Could not draw a QR code:', error);
      qrcodes[name] = '';
    }
  }
  return qrcodes[name];
}

function supportPanel(name, link) {
  return () => {
    const items = [overlayMessageRenderer(t('settings.options.socialMedia.qrCodeScanMessage', { name }))];
    const qr = qrFor(name, link);
    if (qr) items.push(QrCodeRenderer(qr));
    return { title: name, subtitle: link, content: overlayPanelItemListRenderer(items) };
  };
}

const custom = (action, parameters) => ({ customAction: { action, parameters } });

function sponsorCategories(prefix, mode) {
  const categories = [
    ['sponsor', 'enableSponsorBlockSponsor', 'MONEY_HEART', ['sponsor', 'sponsored', 'ad read']],
    ['intro', 'enableSponsorBlockIntro', 'PLAY_CIRCLE', ['intro', 'intermission']],
    ['outro', 'enableSponsorBlockOutro', null, ['outro', 'endcards', 'credits']],
    ['interaction', 'enableSponsorBlockInteraction', null, ['interaction', 'subscribe reminder']],
    ['selfpromo', 'enableSponsorBlockSelfPromo', null, ['self promotion', 'merch']],
    ['preview', 'enableSponsorBlockPreview', null, ['preview', 'recap']],
    ['filler', 'enableSponsorBlockFiller', null, ['filler', 'tangent', 'jokes']],
    ['music_offtopic', 'enableSponsorBlockMusicOfftopic', null, ['music', 'off topic', 'non music']],
  ];
  return categories.map(([category, key, icon, keywords]) => (mode === 'multi'
    ? { id: `${prefix}.${category}`, title: t(`settings.options.sponsorblock.options.categories.${category}`), value: category, icon: icon || undefined }
    : {
      id: `${prefix}.${category}`,
      type: 'toggle',
      title: t(`settings.options.sponsorblock.options.categories.${category}`),
      key,
      icon: icon || undefined,
      keywords: ['sponsorblock', 'segment', 'skip'].concat(keywords),
      dependsOn: { key: 'enableSponsorBlock', title: t('settings.options.sponsorblock.options.enableSB') },
    }));
}

function timeTitle(seconds) {
  return seconds >= 60
    ? t(`settings.options.time.minute${seconds / 60 > 1 ? 's' : ''}`, { count: seconds / 60 })
    : t('settings.options.time.seconds', { count: seconds });
}

function startupDestination(id, titleKey, icon, endpoint) {
  return { id: `ui.launchTo.${id}`, title: t(titleKey), icon, value: JSON.stringify(endpoint) };
}

function aboutPanel() {
  const version = ytarkDisplayVersion();
  return {
    title: 'About YTArk',
    subtitle: `Version ${version}`,
    content: scrollPaneRenderer([
      overlayMessageRenderer(`YTArk ${version} is an independent Android TV application.`),
      overlayMessageRenderer('The optional YouTube Premium wordmark is a local visual only. It does not provide a subscription or account benefits.'),
      overlayMessageRenderer('Third-party notices and source attribution are included in the release NOTICE.md, TizenTube/LICENSE, and upstream license files.'),
      overlayMessageRenderer(tx('ytark.about.changelog', 'Version history: YTArk Settings › Changelog.')),
    ]),
  };
}

function colorsPanel() {
  const theme = configRead('uiTheme');
  const lines = [
    tx('ytark.appearance.colors.saved', 'Saved colours: navigation {{focus}}, content {{route}}.', {
      focus: String(configRead('focusContainerColor')),
      route: String(configRead('routeColor')),
    }),
    tx('ytark.appearance.colors.edit', 'Change them with the Midnight Blue and Classic Dark presets in YTArk Quick Controls, or in the colour panel opened with the remote\'s red button.'),
    theme === 'oled'
      ? tx('ytark.appearance.colors.oled', 'OLED Black is active and draws true black instead; your colours are kept and come back with YouTube default.')
      : tx('ytark.appearance.colors.youtube', 'YouTube default is active, so these colours are in use.'),
  ];
  return {
    title: tx('ytark.appearance.colors.title', 'Navigation and content colours'),
    subtitle: tx('ytark.appearance.colors.subtitle', 'Your saved custom colours'),
    content: scrollPaneRenderer(lines.map(line => overlayMessageRenderer(line))),
  };
}

function whatsNewNodes() {
  let state;
  try {
    state = whatsNewState();
  } catch (_) {
    state = { show: false };
  }
  if (!state.show || !state.entry) return [];
  const summary = state.entry.summary || (state.entry.sections[0] && state.entry.sections[0].items[0]) || '';
  return [
    {
      id: 'whatsNew',
      type: 'action',
      search: false,
      title: tx('ytark.whatsNew.title', 'What\'s new in YTArk {{version}}', { version: state.entry.display }),
      description: summary.length > 140 ? `${summary.slice(0, 139)}…` : summary,
      icon: 'STAR',
      command: [custom('YTARK_CHANGELOG_VERSION', { version: state.entry.version })],
    },
    {
      id: 'whatsNew.dismiss',
      type: 'action',
      search: false,
      title: tx('ytark.whatsNew.dismissShort', 'Dismiss What\'s new'),
      description: tx('ytark.whatsNew.dismissSubtitle', 'Hides the What\'s new card in YTArk Settings for this version'),
      icon: 'CLOSE',
      command: [custom('YTARK_WHATS_NEW_DISMISS', { refresh: 'settings' })],
    },
  ];
}

/** Build the complete settings tree for the current state and device. */
export function buildSettingsTree() {
  const caps = runtimeCapabilities();
  const quality = (typeof window !== 'undefined' && window.__ytarkQualityStatus) || {};
  const sbDependency = { key: 'enableSponsorBlock', title: t('settings.options.sponsorblock.options.enableSB') };
  const patchDependency = {
    key: 'enablePatchingVideoPlayer',
    title: t('settings.options.videoPlayer.options.patching.options.enableVPUIPatching'),
  };
  const noFrameRate = caps.frameRate ? undefined
    : tx('ytark.unavailable.frameRate', 'Not available on this device: it did not provide the YTArk frame-rate bridge.');

  const children = [
    {
      id: 'search',
      type: 'action',
      search: false,
      title: tx('ytark.search.entry', 'Search settings'),
      description: tx('ytark.search.entryDescription', 'Find any YTArk setting by name or keyword'),
      icon: 'SEARCH',
      command: [custom('YTARK_SEARCH_OPEN', {})],
    },
    ...whatsNewNodes(),
    {
      id: 'quickControls',
      type: 'menu',
      title: 'YTArk Quick Controls',
      description: 'Presets, themes & quick quality',
      icon: 'TV',
      menuId: 'tt-tv-quick-controls',
      keywords: ['quick', 'presets', 'shortcuts'],
      header: { title: 'YTArk Quick Controls', subtitle: 'Presets, themes & quick quality' },
      children: [
        {
          id: 'quickControls.presets',
          type: 'menu',
          title: 'Presets',
          description: 'One-tap configurations',
          icon: 'STAR',
          menuId: 'tt-tv-presets',
          keywords: ['clean tv', 'midnight blue', 'classic dark', 'preset'],
          header: { title: 'Presets', subtitle: 'One-tap configurations' },
          children: Object.entries(PRESETS).map(([key, preset]) => ({
            id: `quickControls.presets.${key}`,
            type: 'action',
            title: preset.label,
            description: preset.description,
            icon: key === 'cleanTV' ? 'VISIBILITY_OFF' : key === 'midnightBlue' ? 'LENS_BLUE' : 'DARK_THEME',
            keywords: ['preset'],
            command: [custom('TV_APPLY_PRESET', key)],
          })),
        },
        {
          id: 'quickControls.undoPreset',
          type: 'action',
          title: 'Undo Last Preset',
          description: 'Revert the most recently applied preset',
          icon: 'UNDO',
          keywords: ['undo', 'revert', 'preset'],
          command: [custom('TV_UNDO_PRESET', [])],
        },
        {
          id: 'quickControls.quality',
          type: 'choice',
          title: 'Quick Quality',
          description: 'Preferred playback quality ceiling',
          icon: 'VIDEO_QUALITY',
          key: 'preferredVideoQuality',
          menuId: 'tt-tv-quick-quality',
          keywords: ['quality', 'resolution', '4k', 'hd', '1080p', '720p', '2160p'],
          header: {
            title: 'Quick Quality',
            subtitle: `Selected: ${quality.selected || configRead('preferredVideoQuality')}; actual: ${quality.actual || 'not reported by player'}`,
          },
          options: QUALITY_LEVELS.map(level => ({
            id: `quickControls.quality.${level}`,
            title: level === 'auto' ? 'Auto' : `${level}p`,
            icon: level === 'auto' ? 'PLAY_CIRCLE' : 'VIDEO_QUALITY',
            value: level === 'auto' ? 'auto' : `${level}p`,
          })),
        },
        {
          id: 'quickControls.premiumLogo',
          type: 'toggle',
          title: 'Premium logo (cosmetic)',
          description: 'Local wordmark only; it never grants or claims a paid YouTube subscription.',
          icon: 'VIDEO_YOUTUBE',
          key: 'enablePremiumLogo',
          keywords: ['premium', 'logo', 'wordmark', 'header', 'branding'],
        },
        {
          id: 'quickControls.userAgent',
          type: 'choice',
          title: 'User-Agent profile (experimental)',
          description: 'Native Cobalt is recommended.',
          icon: 'SETTINGS',
          key: 'userAgentProfile',
          menuId: 'ytark-user-agent-profile',
          keywords: ['user agent', 'ua', 'device profile', 'spoof'],
          unavailable: caps.userAgent ? undefined
            : tx('ytark.unavailable.userAgent', 'Not available here: this runtime has no Cobalt user-agent bridge.'),
          header: { title: 'User-Agent profile', subtitle: 'Does not change the updater APK architecture.' },
          options: [
            { id: 'quickControls.userAgent.native', title: 'Native Cobalt (recommended)', value: 'native' },
            { id: 'quickControls.userAgent.androidTv32', title: 'Android TV 32-bit (experimental)', value: 'androidTv32' },
            { id: 'quickControls.userAgent.androidTv64', title: 'Android TV 64-bit (experimental)', value: 'androidTv64' },
            { id: 'quickControls.userAgent.tclTv32', title: 'TCL Android TV 32-bit (experimental)', value: 'tclTv32' },
            { id: 'quickControls.userAgent.fireTv32', title: 'Fire TV 32-bit (experimental)', value: 'fireTv32' },
          ],
        },
        {
          id: 'quickControls.resetUserAgent',
          type: 'action',
          title: 'Reset User-Agent profile',
          description: 'Recovery: restore native Cobalt behavior',
          icon: 'UNDO',
          keywords: ['user agent', 'reset', 'recovery'],
          command: [custom('RESET_USER_AGENT_PROFILE')],
        },
        {
          id: 'quickControls.hideShorts',
          type: 'toggle',
          title: 'Hide Shorts',
          description: tx('ytark.quick.hideShorts', 'Removes Shorts shelves and tiles from feeds'),
          icon: 'YOUTUBE_SHORTS_FILL_24',
          key: 'enableShorts',
          invert: true,
          keywords: ['shorts', 'reels'],
        },
        {
          id: 'quickControls.hidePreviews',
          type: 'toggle',
          title: 'Hide Previews',
          description: tx('ytark.quick.hidePreviews', 'Stops video previews when a tile is focused'),
          icon: 'VISIBILITY_OFF',
          key: 'enablePreviews',
          invert: true,
          keywords: ['previews', 'autoplay previews', 'hover'],
        },
        {
          id: 'quickControls.hideEndCards',
          type: 'toggle',
          title: 'Hide End Cards',
          icon: 'VISIBILITY_OFF',
          key: 'enableHideEndScreenCards',
          keywords: ['end screen', 'end cards'],
        },
        {
          id: 'quickControls.hideRelated',
          type: 'toggle',
          title: 'Hide Related in Player',
          icon: 'VISIBILITY_OFF',
          key: 'hideRelatedVideosPlayer',
          keywords: ['related', 'suggestions', 'recommended'],
        },
      ],
    },
    {
      id: 'playback',
      type: 'menu',
      title: tx('ytark.categories.playback.title', 'Playback'),
      description: tx('ytark.categories.playback.description', 'Player, video and subtitles'),
      icon: 'PLAY_CIRCLE',
      menuId: 'ytark-playback',
      keywords: ['playback', 'video', 'player', 'subtitles', 'captions', 'quality'],
      header: { title: tx('ytark.categories.playback.title', 'Playback'), subtitle: tx('ytark.categories.playback.description', 'Player, video and subtitles') },
      resetKeys: ['enablePatchingVideoPlayer', 'enablePreviousNextButtons', 'enableSuperThanksButton', 'enableAIAskButton', 'enableSpeedControlsButton', 'enableMPButton', 'enableSwapMPWithPIP', 'preferredVideoQuality', 'speedSettingsIncrement', 'videoSpeed', 'hideRelatedVideosPlayer', 'preferredVideoCodec', 'autoFrameRate', 'autoFrameRatePauseVideoFor', 'enableShowUserLanguage', 'enableShowOtherLanguages'],
      children: [
      {
        id: 'player',
        type: 'menu',
        title: t('settings.options.videoPlayer.title'),
        description: t('settings.options.videoPlayer.subtitle'),
        icon: 'VIDEO_YOUTUBE',
        menuId: 'ytark-video-player',
        keywords: ['player', 'playback', 'video'],
        header: { title: t('settings.options.videoPlayer.title'), subtitle: t('settings.options.videoPlayer.subtitle') },
        resetKeys: ['enablePatchingVideoPlayer', 'enablePreviousNextButtons', 'enableSuperThanksButton', 'enableAIAskButton',
          'enableSpeedControlsButton', 'enableMPButton', 'enableSwapMPWithPIP', 'preferredVideoQuality', 'speedSettingsIncrement',
          'videoSpeed', 'hideRelatedVideosPlayer', 'preferredVideoCodec', 'autoFrameRate', 'autoFrameRatePauseVideoFor'],
        children: [
          {
            id: 'player.patching',
            type: 'menu',
            title: t('settings.options.videoPlayer.options.patching.title'),
            icon: 'SETTINGS',
            menuId: 'tt-video-player-ui-patching',
            keywords: ['buttons', 'player buttons', 'controls'],
            children: [
              { id: 'player.patching.enable', type: 'toggle', title: t('settings.options.videoPlayer.options.patching.options.enableVPUIPatching'), icon: 'SETTINGS', key: 'enablePatchingVideoPlayer', keywords: ['player ui', 'patch'] },
              { id: 'player.patching.previousNext', type: 'toggle', title: t('settings.options.videoPlayer.options.patching.options.previousNextBtns'), icon: 'SKIP_NEXT', key: 'enablePreviousNextButtons', keywords: ['previous', 'next', 'skip'], dependsOn: patchDependency },
              { id: 'player.patching.superThanks', type: 'toggle', title: t('settings.options.videoPlayer.options.patching.options.showSuperThxBtn'), icon: 'MONEY_HEART', key: 'enableSuperThanksButton', keywords: ['super thanks', 'shopping'], dependsOn: patchDependency },
              { id: 'player.patching.askAi', type: 'toggle', title: t('settings.options.videoPlayer.options.patching.options.showAIAskBtn'), icon: 'SPARK', key: 'enableAIAskButton', keywords: ['ai', 'ask'], dependsOn: patchDependency },
              { id: 'player.patching.speed', type: 'toggle', title: t('settings.options.videoPlayer.options.patching.options.showSpeedCtrlBtn'), icon: 'SLOW_MOTION_VIDEO', key: 'enableSpeedControlsButton', keywords: ['speed', 'playback speed'], dependsOn: patchDependency },
              { id: 'player.patching.miniPlayer', type: 'toggle', title: t('settings.options.videoPlayer.options.patching.options.addMPBtn'), icon: 'CLEAR_COOKIES', key: 'enableMPButton', keywords: ['mini player', 'miniplayer'], dependsOn: patchDependency },
              {
                id: 'player.patching.swapPip',
                type: 'toggle',
                title: t('settings.options.videoPlayer.options.patching.options.swapMPWithPIP'),
                icon: 'CLEAR_COOKIES',
                key: 'enableSwapMPWithPIP',
                keywords: ['picture in picture', 'pip'],
                dependsOn: patchDependency,
                unavailable: caps.pictureInPicture ? undefined
                  : tx('ytark.unavailable.pip', 'Not available on this device: Android reports no picture-in-picture support.'),
              },
            ],
          },
          {
            id: 'player.quality',
            type: 'choice',
            title: t('settings.options.videoPlayer.options.preferredVideoQuality.title'),
            description: t('settings.options.videoPlayer.options.preferredVideoQuality.subtitle'),
            icon: 'VIDEO_QUALITY',
            key: 'preferredVideoQuality',
            menuId: 'tt-preferred-video-quality',
            keywords: ['quality', 'resolution', '4k', 'hd', '1080p', '720p', '2160p', '1440p'],
            header: {
              title: t('settings.options.videoPlayer.options.preferredVideoQuality.title'),
              subtitle: t('settings.options.videoPlayer.options.preferredVideoQuality.subtitle'),
            },
            options: ['Auto', '2160p', '1440p', '1080p', '720p', '480p', '360p', '240p', '144p'].map(level => ({
              id: `player.quality.${level.toLowerCase()}`,
              title: level === 'Auto' ? t('settings.options.videoPlayer.options.qualityAuto') : level,
              value: level.toLowerCase(),
            })),
          },
          {
            id: 'player.speedIncrement',
            type: 'choice',
            title: t('settings.options.videoPlayer.options.speedSettings.title'),
            description: t('settings.options.videoPlayer.options.speedSettings.subtitle'),
            icon: 'SLOW_MOTION_VIDEO',
            key: 'speedSettingsIncrement',
            menuId: 'tt-speed-settings-increments',
            keywords: ['speed', 'increment', 'step'],
            options: [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5].map(step => ({
              id: `player.speedIncrement.${step}`,
              title: `${step}x`,
              value: step,
            })),
          },
          { id: 'player.hideRelated', type: 'toggle', title: t('settings.options.videoPlayer.options.hideRelatedVideosPlayer'), icon: 'VISIBILITY_OFF', key: 'hideRelatedVideosPlayer', keywords: ['related', 'suggestions'] },
          {
            id: 'player.codec',
            type: 'choice',
            title: t('settings.options.videoPlayer.options.preferredVideoCodec.title'),
            description: t('settings.options.videoPlayer.options.preferredVideoCodec.subtitle'),
            icon: 'VIDEO_QUALITY',
            key: 'preferredVideoCodec',
            menuId: 'tt-preferred-video-codec',
            keywords: ['codec', 'vp9', 'av1', 'av01', 'h264', 'avc'],
            options: ['any', 'vp9', 'av01', 'avc1'].map(codec => ({
              id: `player.codec.${codec}`,
              title: codec === 'any' ? t('settings.options.videoPlayer.options.codecAny') : codec.toUpperCase(),
              value: codec,
            })),
          },
          {
            id: 'player.afr',
            type: 'toggle',
            title: t('settings.options.videoPlayer.options.afr'),
            icon: 'SLOW_MOTION_VIDEO',
            key: 'autoFrameRate',
            keywords: ['frame rate', 'afr', 'refresh rate', 'hz', 'fps'],
            unavailable: noFrameRate,
          },
          {
            id: 'player.afrPause',
            type: 'choice',
            title: t('settings.options.videoPlayer.options.afrPauseDuration.title'),
            description: t('settings.options.videoPlayer.options.afrPauseDuration.subtitle'),
            icon: 'TIMER',
            key: 'autoFrameRatePauseVideoFor',
            menuId: 'tt-auto-frame-rate-pause-duration',
            keywords: ['frame rate', 'afr', 'pause'],
            unavailable: noFrameRate,
            dependsOn: { key: 'autoFrameRate', title: t('settings.options.videoPlayer.options.afr') },
            options: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5].map(seconds => ({
              id: `player.afrPause.${seconds}`,
              title: t(seconds === 1 ? 'settings.options.time.second' : 'settings.options.time.seconds', { count: seconds }),
              value: seconds * 1000,
            })),
          },
        ],
      },
          { id: 'misc.longPress', type: 'toggle', title: t('settings.options.misc.options.longPress'), key: 'enableLongPress', keywords: ['long press', 'menu', 'queue'] },
      {
        id: 'subtitles',
        type: 'menu',
        title: t('settings.options.subtitles.title'),
        icon: 'TRANSLATE',
        menuId: 'ytark-subtitles',
        keywords: ['subtitles', 'captions', 'cc', 'language'],
        resetKeys: ['enableShowUserLanguage', 'enableShowOtherLanguages'],
        children: [
          { id: 'subtitles.userLanguage', type: 'toggle', title: t('settings.options.subtitles.options.showLocalSubtitle'), key: 'enableShowUserLanguage', keywords: ['subtitles', 'captions', 'language', 'translate'] },
          { id: 'subtitles.otherLanguages', type: 'toggle', title: t('settings.options.subtitles.options.showHiddenSubtitles'), key: 'enableShowOtherLanguages', keywords: ['subtitles', 'captions', 'languages'] },
        ],
      },
    ],
    },
    {
      id: 'appearance',
      type: 'menu',
      title: tx('ytark.appearance.title', 'Appearance'),
      description: tx('ytark.appearance.description', 'Theme, colours, player look and screen behaviour'),
      icon: 'DARK_THEME',
      menuId: 'ytark-appearance',
      keywords: ['appearance', 'look', 'theme', 'colours', 'colors'],
      resetKeys: ['uiTheme', 'hidePlayerWatermark', 'removePlayerScrim', 'enableScreenDimming', 'dimmingTimeout', 'dimmingOpacity', 'enableHideWatchedVideos', 'hideWatchedVideosThreshold', 'hideWatchedVideosPages', 'enableClock', 'isClock12HourFormat', 'clockShowSeconds', 'clockHideWhenVideoPlaying', 'disableEnlargingThumbnails', 'enableShrinkingThumbnails', 'enableHqThumbnails', 'enableFixedUI'],
      children: [
        {
          id: 'appearance.theme',
          type: 'choice',
          title: tx('ytark.appearance.theme.title', 'Theme'),
          description: tx('ytark.appearance.theme.description', 'YouTube default or OLED Black'),
          icon: 'DARK_THEME',
          key: 'uiTheme',
          menuId: 'ytark-theme',
          keywords: ['theme', 'oled', 'black', 'amoled', 'dark', 'true black', 'background', 'colour', 'color'],
          options: [
            {
              id: 'appearance.theme.youtube',
              title: tx('ytark.appearance.theme.youtube', 'YouTube default'),
              description: tx('ytark.appearance.theme.youtubeDescription', 'YouTube TV colours with your saved navigation and content colours'),
              value: 'youtube',
            },
            {
              id: 'appearance.theme.oled',
              title: tx('ytark.appearance.theme.oled', 'OLED Black'),
              description: tx('ytark.appearance.theme.oledDescription', 'True black backgrounds for supported screens; images and video keep their colours'),
              value: 'oled',
            },
          ],
        },
        {
          id: 'appearance.player',
          type: 'menu',
          title: tx('ytark.appearance.player.title', 'Player'),
          description: tx('ytark.appearance.player.description', 'Watermark and control-overlay dimming'),
          icon: 'VIDEO_YOUTUBE',
          menuId: 'ytark-appearance-player',
          keywords: ['player', 'playback', 'video'],
          children: [
            {
              id: 'appearance.player.hideWatermark',
              type: 'toggle',
              title: tx('ytark.appearance.player.hideWatermark', 'Hide channel watermark'),
              description: tx('ytark.appearance.player.hideWatermarkDescription', 'Hide the clickable channel logo over videos.'),
              icon: 'VISIBILITY_OFF',
              key: 'hidePlayerWatermark',
              keywords: ['watermark', 'channel logo', 'logo', 'branding', 'subscribe', 'overlay', 'corner logo'],
            },
            {
              id: 'appearance.player.removeScrim',
              type: 'toggle',
              title: tx('ytark.appearance.player.removeScrim', 'Remove player dimming'),
              description: tx('ytark.appearance.player.removeScrimDescription', 'Keep the video bright when playback controls are visible.'),
              icon: 'EYE_OFF',
              key: 'removePlayerScrim',
              keywords: ['dimming', 'dim', 'scrim', 'overlay', 'shadow', 'darken', 'darkening', 'brightness', 'controls', 'gradient'],
            },
            {
              id: 'appearance.player.idleDimming',
              type: 'link',
              search: false,
              target: 'ui.screenDimming',
              title: tx('ytark.appearance.player.idleDimming', 'Screen dimming when idle'),
              description: tx('ytark.appearance.player.idleDimmingDescription', 'Separate setting under User Interface'),
              icon: 'TIMER',
            },
          ],
        },
        {
          id: 'appearance.colors',
          type: 'panel',
          title: tx('ytark.appearance.colors.title', 'Navigation and content colours'),
          description: tx('ytark.appearance.colors.subtitle', 'Your saved custom colours'),
          icon: 'LENS_BLUE',
          keywords: ['colour', 'color', 'navigation bar', 'background', 'custom colours'],
          panel: colorsPanel,
        },
            {
              id: 'ui.screenDimming',
              type: 'menu',
              title: t('settings.options.uiSettings.options.screenDimming.title'),
              description: tx('ytark.ui.screenDimmingDescription', 'Dims the app after inactivity; separate from player dimming'),
              icon: 'EYE_OFF',
              menuId: 'tt-screen-dimming-settings',
              keywords: ['dimming', 'idle', 'inactivity', 'screensaver', 'dim screen', 'burn in'],
              children: [
                { id: 'ui.screenDimming.enable', type: 'toggle', title: t('settings.options.uiSettings.options.screenDimming.options.enableScreenDimming'), icon: 'EYE_OFF', key: 'enableScreenDimming', keywords: ['dimming', 'idle', 'screensaver'] },
                {
                  id: 'ui.screenDimming.timeout',
                  type: 'choice',
                  title: t('settings.options.uiSettings.options.screenDimming.options.dimmingTimeout.title'),
                  description: t('settings.options.uiSettings.options.screenDimming.options.dimmingTimeout.subtitle'),
                  icon: 'TIMER',
                  key: 'dimmingTimeout',
                  menuId: 'tt-dimming-timeout',
                  keywords: ['dimming', 'timeout', 'delay'],
                  dependsOn: { key: 'enableScreenDimming', title: t('settings.options.uiSettings.options.screenDimming.options.enableScreenDimming') },
                  options: [10, 20, 30, 60, 120, 180, 240, 300].map(seconds => ({ id: `ui.screenDimming.timeout.${seconds}`, title: timeTitle(seconds), value: seconds })),
                },
                {
                  id: 'ui.screenDimming.opacity',
                  type: 'choice',
                  title: t('settings.options.uiSettings.options.screenDimming.options.dimmingOpacity.title'),
                  description: t('settings.options.uiSettings.options.screenDimming.options.dimmingOpacity.subtitle'),
                  icon: 'LENS_BLUE',
                  key: 'dimmingOpacity',
                  menuId: 'tt-dimming-opacity',
                  keywords: ['dimming', 'opacity', 'strength'],
                  dependsOn: { key: 'enableScreenDimming', title: t('settings.options.uiSettings.options.screenDimming.options.enableScreenDimming') },
                  options: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0].map(opacity => ({ id: `ui.screenDimming.opacity.${opacity}`, title: `${Math.round(opacity * 100)}%`, value: opacity })),
                },
              ],
            },
            {
              id: 'ui.hideWatched',
              type: 'menu',
              title: t('settings.options.uiSettings.options.hideWatchedVideos.title'),
              icon: 'VISIBILITY_OFF',
              menuId: 'tt-hide-watched-videos-settings',
              keywords: ['watched', 'hide watched', 'history'],
              children: [
                { id: 'ui.hideWatched.enable', type: 'toggle', title: t('settings.options.uiSettings.options.hideWatchedVideos.options.enableHideWatchedVideos'), icon: 'VISIBILITY_OFF', key: 'enableHideWatchedVideos', keywords: ['watched', 'hide'] },
                {
                  id: 'ui.hideWatched.threshold',
                  type: 'choice',
                  title: t('settings.options.uiSettings.options.hideWatchedVideos.options.watchedVideosThreshold.title'),
                  description: t('settings.options.uiSettings.options.hideWatchedVideos.options.watchedVideosThreshold.subtitle'),
                  key: 'hideWatchedVideosThreshold',
                  menuId: 'tt-hide-watched-videos-threshold',
                  keywords: ['watched', 'threshold', 'percent'],
                  dependsOn: { key: 'enableHideWatchedVideos', title: t('settings.options.uiSettings.options.hideWatchedVideos.options.enableHideWatchedVideos') },
                  options: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map(percent => ({ id: `ui.hideWatched.threshold.${percent}`, title: `${percent}%`, value: percent })),
                },
                {
                  id: 'ui.hideWatched.pages',
                  type: 'multi',
                  title: t('settings.options.uiSettings.options.hideWatchedVideos.options.setPagesToHideWatchedVideos'),
                  key: 'hideWatchedVideosPages',
                  menuId: 'tt-hide-watched-videos-pages',
                  keywords: ['watched', 'pages'],
                  dependsOn: { key: 'enableHideWatchedVideos', title: t('settings.options.uiSettings.options.hideWatchedVideos.options.enableHideWatchedVideos') },
                  options: [
                    ['search', 'searchResults'], ['home', 'home'], ['music', 'music'], ['gaming', 'gaming'],
                    ['subscriptions', 'subscriptions'], ['library', 'library'], ['more', 'more'],
                  ].map(([value, key]) => ({ id: `ui.hideWatched.pages.${value}`, title: t(`settings.options.uiSettings.options.categories.${key}`), value })),
                },
              ],
            },
            {
              id: 'ui.clock',
              type: 'menu',
              title: t('settings.options.uiSettings.options.clock.title'),
              description: t('settings.options.uiSettings.options.clock.subtitle'),
              icon: 'TIMER',
              menuId: 'tt-clock-settings',
              keywords: ['clock', 'time'],
              header: { title: t('settings.options.uiSettings.options.clock.title'), subtitle: t('settings.options.uiSettings.options.clock.subtitle') },
              children: [
                { id: 'ui.clock.enable', type: 'toggle', title: t('settings.options.uiSettings.options.clock.options.enableClock'), icon: 'TIMER', key: 'enableClock', keywords: ['clock', 'time'] },
                { id: 'ui.clock.twelveHour', type: 'toggle', title: t('settings.options.uiSettings.options.clock.options.isClock12HourFormat'), icon: 'TIMER', key: 'isClock12HourFormat', keywords: ['clock', '12 hour', 'am pm'], dependsOn: { key: 'enableClock', title: t('settings.options.uiSettings.options.clock.options.enableClock') } },
                { id: 'ui.clock.seconds', type: 'toggle', title: t('settings.options.uiSettings.options.clock.options.clockShowSeconds'), icon: 'TIMER', key: 'clockShowSeconds', keywords: ['clock', 'seconds'], dependsOn: { key: 'enableClock', title: t('settings.options.uiSettings.options.clock.options.enableClock') } },
                { id: 'ui.clock.hideInPlayer', type: 'toggle', title: t('settings.options.uiSettings.options.clock.options.clockHideWhenVideoPlaying'), icon: 'EYE_OFF', key: 'clockHideWhenVideoPlaying', keywords: ['clock', 'player'], dependsOn: { key: 'enableClock', title: t('settings.options.uiSettings.options.clock.options.enableClock') } },
              ],
            },
            { id: 'ui.disableEnlargingThumbnails', type: 'toggle', title: t('settings.options.uiSettings.options.disableEnlargingThumbnails'), key: 'disableEnlargingThumbnails', keywords: ['thumbnails', 'enlarge', 'zoom'] },
            { id: 'ui.enableShrinkingThumbnails', type: 'toggle', title: t('settings.options.uiSettings.options.enableShrinkingThumbnails'), key: 'enableShrinkingThumbnails', keywords: ['thumbnails', 'shrink'] },
            { id: 'misc.hqThumbnails', type: 'toggle', title: t('settings.options.misc.options.hqThumbnails'), icon: 'VIDEO_QUALITY', key: 'enableHqThumbnails', keywords: ['thumbnails', 'high quality'] },
            { id: 'misc.fixUi', type: 'toggle', title: t('settings.options.misc.options.fixUI'), icon: 'STAR', key: 'enableFixedUI', keywords: ['animations', 'fix ui', 'performance'] },
      ],
    },
    {
      id: 'privacy',
      type: 'menu',
      title: tx('ytark.categories.privacy.title', 'Privacy'),
      description: tx('ytark.categories.privacy.description', 'Ads, content filtering and prompts'),
      icon: 'PRIVACY_UNLISTED',
      menuId: 'ytark-privacy',
      keywords: ['privacy', 'ads', 'adblock', 'sponsorblock', 'dearrow', 'filter', 'prompts'],
      header: { title: tx('ytark.categories.privacy.title', 'Privacy'), subtitle: tx('ytark.categories.privacy.description', 'Ads, content filtering and prompts') },
      resetKeys: ['enableSponsorBlock', 'sponsorBlockManualSkips', 'enableSponsorBlockSponsor', 'enableSponsorBlockIntro', 'enableSponsorBlockOutro', 'enableSponsorBlockInteraction', 'enableSponsorBlockSelfPromo', 'enableSponsorBlockPreview', 'enableSponsorBlockFiller', 'enableSponsorBlockMusicOfftopic', 'enableSponsorBlockHighlight', 'enableSponsorBlockToasts', 'enableDeArrow', 'enableDeArrowThumbnails'],
      children: [
          {
            id: 'privacy.adBlock',
            type: 'toggle',
            title: 'Ad blocking',
            description: 'Enabled by default. Independent of SponsorBlock and the logo.',
            icon: 'DOLLAR_SIGN',
            key: 'enableAdBlock',
            keywords: ['ads', 'adblock', 'advertising', 'ad blocker'],
          },
      {
        id: 'sponsorblock',
        type: 'menu',
        title: t('settings.options.sponsorblock.title'),
        description: `Currently ${configRead('enableSponsorBlock') ? 'ON' : 'OFF'} · https://sponsor.ajay.app/`,
        icon: 'MONEY_HAND',
        menuId: 'tt-sponsorblock-settings',
        keywords: ['sponsorblock', 'sponsor', 'segments', 'skip'],
        header: {
          title: t('settings.options.sponsorblock.title'),
          subtitle: `Currently ${configRead('enableSponsorBlock') ? 'ON' : 'OFF'} · https://sponsor.ajay.app/`,
        },
        resetKeys: ['enableSponsorBlock', 'sponsorBlockManualSkips', 'enableSponsorBlockSponsor', 'enableSponsorBlockIntro',
          'enableSponsorBlockOutro', 'enableSponsorBlockInteraction', 'enableSponsorBlockSelfPromo', 'enableSponsorBlockPreview',
          'enableSponsorBlockFiller', 'enableSponsorBlockMusicOfftopic', 'enableSponsorBlockHighlight', 'enableSponsorBlockToasts'],
        children: [
          {
            id: 'sponsorblock.undo',
            type: 'action',
            title: 'Undo last manual skip',
            description: typeof window !== 'undefined' && window.__ytarkLastSponsorBlockSkip
              && Date.now() < window.__ytarkLastSponsorBlockSkip.expiresAt
              ? 'Undo the most recent SponsorBlock skip' : 'No recent manual skip to undo',
            icon: 'UNDO',
            keywords: ['undo', 'skip', 'sponsorblock'],
            command: [custom('SPONSORBLOCK_UNDO_SKIP')],
          },
          { id: 'sponsorblock.enable', type: 'toggle', title: t('settings.options.sponsorblock.options.enableSB'), icon: 'MONEY_HAND', key: 'enableSponsorBlock', keywords: ['sponsorblock', 'sponsor', 'skip'] },
          {
            id: 'sponsorblock.manualSkip',
            type: 'multi',
            title: t('settings.options.sponsorblock.options.manualSkip'),
            icon: 'DOLLAR_SIGN',
            key: 'sponsorBlockManualSkips',
            menuId: 'tt-sponsorblock-manual-segment-skip',
            keywords: ['manual skip', 'skip button', 'sponsorblock'],
            dependsOn: sbDependency,
            options: sponsorCategories('sponsorblock.manualSkip', 'multi'),
          },
          {
            id: 'sponsorblock.segments',
            type: 'menu',
            title: t('settings.options.sponsorblock.options.segments'),
            icon: 'SETTINGS',
            menuId: 'tt-sponsorblock-segments',
            keywords: ['segments', 'categories', 'sponsorblock'],
            children: sponsorCategories('sponsorblock.segments', 'toggle').concat([{
              id: 'sponsorblock.segments.highlight',
              type: 'toggle',
              title: t('settings.options.sponsorblock.options.categories.highlights'),
              icon: 'LOCATION_POINT',
              key: 'enableSponsorBlockHighlight',
              keywords: ['highlight', 'skip to highlight', 'sponsorblock'],
              dependsOn: sbDependency,
            }]),
          },
          { id: 'sponsorblock.toasts', type: 'toggle', title: t('settings.options.sponsorblock.options.showSBToasts'), key: 'enableSponsorBlockToasts', keywords: ['toast', 'notification', 'sponsorblock'], dependsOn: sbDependency },
        ],
      },
      {
        id: 'dearrow',
        type: 'menu',
        title: t('settings.options.dearrow.title'),
        description: 'https://dearrow.ajay.app/',
        icon: 'VISIBILITY_OFF',
        menuId: 'ytark-dearrow',
        keywords: ['dearrow', 'clickbait', 'titles', 'thumbnails'],
        header: { title: t('settings.options.dearrow.title'), subtitle: 'https://dearrow.ajay.app/' },
        resetKeys: ['enableDeArrow', 'enableDeArrowThumbnails'],
        children: [
          { id: 'dearrow.enable', type: 'toggle', title: t('settings.options.dearrow.options.enableDA'), icon: 'VISIBILITY_OFF', key: 'enableDeArrow', keywords: ['dearrow', 'clickbait', 'titles'] },
          { id: 'dearrow.thumbnails', type: 'toggle', title: t('settings.options.dearrow.options.enableDAThumbnails'), icon: 'TV', key: 'enableDeArrowThumbnails', keywords: ['dearrow', 'thumbnails'], dependsOn: { key: 'enableDeArrow', title: t('settings.options.dearrow.options.enableDA') } },
        ],
      },
          { id: 'misc.paidPromotion', type: 'toggle', title: t('settings.options.misc.options.paidPromoOverlay'), icon: 'MONEY_HAND', key: 'enablePaidPromotionOverlay', keywords: ['paid promotion', 'sponsored overlay'] },
          { id: 'misc.youThere', type: 'toggle', title: t('settings.options.misc.options.youThereRenderer'), icon: 'HELP', key: 'enableYouThereRenderer', keywords: ['still watching', 'are you there', 'pause prompt'] },
          { id: 'misc.signInReminder', type: 'toggle', title: t('settings.options.misc.options.guestSignInReminder'), key: 'enableSigninReminder', keywords: ['guest', 'sign in reminder'] },
    ],
    },
    {
      id: 'navigation',
      type: 'menu',
      title: tx('ytark.categories.navigation.title', 'Navigation'),
      description: tx('ytark.categories.navigation.description', 'Guide, startup and the YouTube Settings page'),
      icon: 'MENU',
      menuId: 'ytark-navigation',
      keywords: ['navigation', 'guide', 'sidebar', 'startup', 'layout', 'who is watching'],
      header: { title: tx('ytark.categories.navigation.title', 'Navigation'), subtitle: tx('ytark.categories.navigation.description', 'Guide, startup and the YouTube Settings page') },
      resetKeys: ['launchToOnStartup', 'sortSubscriptionsByAlphabet', 'disableChannelsOnSidebar', 'enableYtarkGuideEntry', 'enableWhoIsWatchingMenu', 'permanentlyEnableWhoIsWatchingMenu', 'enableWhosWatchingMenuOnAppExit', 'reloadHomeOnStartup'],
      children: [
          {
            id: 'ui.disableSidebar',
            type: 'action',
            title: t('settings.options.uiSettings.options.disableSidebarContents.title'),
            description: t('settings.options.uiSettings.options.disableSidebarContents.subtitle'),
            icon: 'MENU',
            keywords: ['sidebar', 'guide', 'menu', 'hide tabs'],
            command: [custom('SHOW_GUIDE_SETTINGS', 'disabledSidebarContents')],
          },
          {
            id: 'ui.sortSidebar',
            type: 'action',
            title: t('settings.options.uiSettings.options.sortSidebarContents.title'),
            description: t('settings.options.uiSettings.options.sortSidebarContents.subtitle'),
            icon: 'MENU',
            keywords: ['sidebar', 'guide', 'order', 'sort', 'reorder'],
            command: [custom('SHOW_GUIDE_SETTINGS', 'sortSidebarContents')],
          },
          {
            id: 'ui.launchTo',
            type: 'choice',
            title: t('settings.options.uiSettings.options.launchToOnStartup.title'),
            description: t('settings.options.uiSettings.options.launchToOnStartup.subtitle'),
            icon: 'TV',
            key: 'launchToOnStartup',
            menuId: 'tt-launch-to-on-startup',
            keywords: ['startup', 'launch', 'start page', 'home page'],
            options: [
              startupDestination('search', 'settings.options.uiSettings.options.categories.search', 'SEARCH', { searchEndpoint: { query: '' } }),
              startupDestination('home', 'settings.options.uiSettings.options.categories.home', 'WHAT_TO_WATCH', { browseEndpoint: { browseId: 'FEtopics' } }),
              startupDestination('sports', 'settings.options.uiSettings.options.categories.sports', 'TROPHY', { browseEndpoint: { browseId: 'FEtopics_sports' } }),
              startupDestination('news', 'settings.options.uiSettings.options.categories.news', 'NEWS', { browseEndpoint: { browseId: 'FEtopics_news' } }),
              startupDestination('music', 'settings.options.uiSettings.options.categories.music', 'YOUTUBE_MUSIC', { browseEndpoint: { browseId: 'FEtopics_music' } }),
              startupDestination('podcasts', 'settings.options.uiSettings.options.categories.podcasts', 'BROADCAST', { browseEndpoint: { browseId: 'FEtopics_podcasts' } }),
              startupDestination('movies', 'settings.options.uiSettings.options.categories.moviesAndTv', 'CLAPPERBOARD', { browseEndpoint: { browseId: 'FEtopics_movies' } }),
              startupDestination('gaming', 'settings.options.uiSettings.options.categories.gaming', 'GAMING', { browseEndpoint: { browseId: 'FEtopics_gaming' } }),
              startupDestination('live', 'settings.options.uiSettings.options.categories.live', 'LIVE', { browseEndpoint: { browseId: 'FEtopics_live' } }),
              startupDestination('subscriptions', 'settings.options.uiSettings.options.categories.subscriptions', 'SUBSCRIPTIONS', { browseEndpoint: { browseId: 'FEsubscriptions' } }),
              startupDestination('library', 'settings.options.uiSettings.options.categories.library', 'TAB_LIBRARY', { browseEndpoint: { browseId: 'FElibrary' } }),
              startupDestination('more', 'settings.options.uiSettings.options.categories.more', 'TAB_MORE', { browseEndpoint: { browseId: 'FEtopics_more' } }),
            ],
          },
          { id: 'ui.sortSubscriptions', type: 'toggle', title: t('settings.options.uiSettings.options.sortSubscriptionsByAlphabet'), icon: 'SUBSCRIPTIONS', key: 'sortSubscriptionsByAlphabet', keywords: ['subscriptions', 'alphabetical', 'sort'] },
          { id: 'ui.disableChannelsOnSidebar', type: 'toggle', title: t('settings.options.uiSettings.options.disableChannelsOnSidebar'), key: 'disableChannelsOnSidebar', keywords: ['sidebar', 'channels'] },
          {
            id: 'nav.guideEntry',
            type: 'toggle',
            title: tx('ytark.navigation.guideEntry.title', 'YTArk entry in the guide'),
            description: tx('ytark.navigation.guideEntry.description', 'Shows a YTArk Settings entry in the TV guide so settings stay reachable even with a minimal sidebar'),
            icon: 'MENU',
            key: 'enableYtarkGuideEntry',
            keywords: ['guide', 'sidebar', 'quick access', 'entry', 'shortcut', 'navigation'],
          },
      {
        id: 'ytSettingsLayout',
        type: 'action',
        title: tx('ytark.ytSettings.title', 'Customize YouTube Settings'),
        description: tx('ytark.ytSettings.entryDescription', 'Reorder, hide or pin sections of the YouTube Settings page'),
        icon: 'SETTINGS',
        keywords: ['youtube settings', 'customize', 'customise', 'reorder', 'hide', 'pin', 'sections', 'layout', 'stock settings'],
        command: [custom('YTARK_YTS_EDITOR', {})],
      },
          {
            id: 'misc.whosWatching',
            type: 'menu',
            title: t('settings.options.misc.options.whosWatching.title'),
            icon: 'ACCOUNT_CIRCLE',
            menuId: 'tt-whos-watching-menu-settings',
            keywords: ['who is watching', 'profiles', 'account picker'],
            children: [
              { id: 'misc.whosWatching.enable', type: 'toggle', title: t('settings.options.misc.options.whosWatching.options.enableWW'), key: 'enableWhoIsWatchingMenu', keywords: ['who is watching', 'profiles'] },
              { id: 'misc.whosWatching.permanent', type: 'toggle', title: t('settings.options.misc.options.whosWatching.options.permaEnableWW'), key: 'permanentlyEnableWhoIsWatchingMenu', keywords: ['who is watching', 'always'], dependsOn: { key: 'enableWhoIsWatchingMenu', title: t('settings.options.misc.options.whosWatching.options.enableWW') } },
              { id: 'misc.whosWatching.onExit', type: 'toggle', title: t('settings.options.misc.options.whosWatching.options.enableWWOnExit'), key: 'enableWhosWatchingMenuOnAppExit', keywords: ['who is watching', 'exit'] },
            ],
          },
          { id: 'misc.reloadHome', type: 'toggle', title: t('settings.options.misc.options.reloadHomeOnStartup'), key: 'reloadHomeOnStartup', keywords: ['startup', 'reload', 'home'] },
    ],
    },
    {
      id: 'updates',
      type: 'menu',
      title: 'YTArk Updates',
      description: ytarkUpdateSubtitle(),
      icon: 'SYSTEM_UPDATE',
      menuId: 'ytark-updates-menu',
      keywords: ['update', 'updates', 'version', 'upgrade', 'release', 'apk', 'download', 'installed version'],
      header: { title: 'YTArk Updates', subtitle: ytarkUpdateSubtitle() },
      children: [
        {
          id: 'updates.check',
          type: 'action',
          title: 'Check for YTArk updates',
          description: 'Opens the official release check and download page',
          icon: 'SYSTEM_UPDATE',
          keywords: ['update', 'check', 'version', 'new version'],
          command: [custom('CHECK_FOR_UPDATES')],
        },
        {
          id: 'updates.changelog',
          type: 'action',
          title: tx('ytark.changelog.entryFromUpdates', 'What\'s new and changelog'),
          description: tx('ytark.changelog.entryDescription', 'Version history bundled with this build'),
          icon: 'BOOKMARK_BORDER',
          keywords: ['changelog', 'whats new', 'release notes', 'history'],
          command: [custom('YTARK_CHANGELOG_SHOW', {})],
        },
      ],
    },
    {
      id: 'about',
      type: 'panel',
      title: 'About YTArk',
      description: `Version ${ytarkDisplayVersion()}`,
      icon: 'INFO',
      keywords: ['about', 'version', 'licence', 'license', 'attribution'],
      panel: aboutPanel,
    },
    {
      id: 'support',
      type: 'menu',
      title: 'Support YTArk',
      icon: 'PRIVACY_UNLISTED',
      menuId: 'ytark-support',
      keywords: ['support', 'donate', 'github', 'ko-fi', 'kofi'],
      children: [
        { id: 'support.github', type: 'panel', title: 'YTArk on GitHub', description: 'https://github.com/2archiver/YTArk', icon: 'OPEN_IN_NEW', keywords: ['github', 'source'], panel: supportPanel('YTArk on GitHub', 'https://github.com/2archiver/YTArk') },
        { id: 'support.kofi', type: 'panel', title: 'Support YTArk on Ko-fi', description: 'https://ko-fi.com/2archiver', icon: 'OPEN_IN_NEW', keywords: ['ko-fi', 'donate'], panel: supportPanel('Support YTArk on Ko-fi', 'https://ko-fi.com/2archiver') },
      ],
    },
  ];

  return {
    id: 'root',
    type: 'menu',
    title: 'YTArk Settings',
    description: 'Playback, appearance, privacy and updates',
    menuId: 'tt-settings',
    header: { title: 'YTArk Settings', subtitle: 'Playback, appearance, privacy and updates' },
    children,
  };
}

// ---------------------------------------------------------------------------
// Tree helpers shared by the menus, search and tests
// ---------------------------------------------------------------------------

export function walkTree(node, visit, path = []) {
  if (!node) return;
  visit(node, path);
  for (const child of node.children || []) walkTree(child, visit, node.id === 'root' ? [] : path.concat([node]));
}

export function findNode(tree, id) {
  let found = null;
  walkTree(tree, (node) => {
    if (!found && node.id === id) found = node;
  });
  return found;
}

export function parentOf(tree, id) {
  let parent = null;
  walkTree(tree, (node) => {
    if (!parent && Array.isArray(node.children) && node.children.some(child => child.id === id)) parent = node;
  });
  return parent;
}

/** Path of ancestor nodes (excluding the root) for a node id. */
export function pathOf(tree, id) {
  let result = null;
  walkTree(tree, (node, path) => {
    if (!result && node.id === id) result = path;
  });
  return result || [];
}

export function toggleDisplayValue(node) {
  const value = configRead(node.key) === true;
  return node.invert ? !value : value;
}

function sameValue(a, b) {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  return String(a) === String(b);
}

export function selectedOption(node) {
  const current = configRead(node.key);
  return (node.options || []).find(option => sameValue(option.value, current)) || null;
}

/** Human-readable current value of a node ('' when it has none). */
export function valueText(node) {
  switch (node.type) {
    case 'toggle':
      return toggleDisplayValue(node) ? tx('ytark.value.on', 'On') : tx('ytark.value.off', 'Off');
    case 'choice': {
      const option = selectedOption(node);
      if (option) return option.title;
      const current = configRead(node.key);
      return current === null || current === undefined ? tx('ytark.value.notSet', 'Not set') : tx('ytark.value.custom', 'Custom');
    }
    case 'multi': {
      const current = configRead(node.key);
      const count = Array.isArray(current) ? current.length : 0;
      return tx('ytark.value.selected', '{{count}} selected', { count });
    }
    default:
      return '';
  }
}

/** Dependency note when a required setting is off ('' otherwise). */
export function dependencyNote(node) {
  if (!node.dependsOn || !node.dependsOn.key) return '';
  if (configRead(node.dependsOn.key) === true) return '';
  return tx('ytark.dependency', 'Takes effect when "{{setting}}" is on', { setting: node.dependsOn.title });
}

/** Keys owned by the registry (for tests and section resets). */
export function registryKeys(tree) {
  const keys = new Set();
  walkTree(tree, (node) => {
    if (node.key) keys.add(node.key);
    (node.resetKeys || []).forEach(key => keys.add(key));
  });
  return Array.from(keys);
}

export function defaultValueText(node, key) {
  const value = configDefault(key);
  if (node && node.key === key) {
    if (node.type === 'toggle') return (node.invert ? !value : value) ? tx('ytark.value.on', 'On') : tx('ytark.value.off', 'Off');
    if (node.type === 'choice') {
      const option = (node.options || []).find(item => sameValue(item.value, value));
      if (option) return option.title;
    }
  }
  if (typeof value === 'boolean') return value ? tx('ytark.value.on', 'On') : tx('ytark.value.off', 'Off');
  if (Array.isArray(value)) return tx('ytark.value.selected', '{{count}} selected', { count: value.length });
  if (value === null || value === undefined) return tx('ytark.value.notSet', 'Not set');
  return String(value);
}
