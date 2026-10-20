/**
 * The shared YTArk settings registry.
 *
 * One tree describes every YTArk setting: stable id, localized title and
 * description, category (its position in the tree), value type and config
 * key, availability and dependency information, and the real action. The
 * YTArk Settings menus (ui/settings.js) are generated from this tree, so
 * every change goes through the same configuration path.
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
import {
  installedVersionInfo, installedVersionLabel, youtubeFrontendVersion,
  VERSION_SOURCES,
} from '../features/appVersion.js';
import {
  overlayPanelItemListRenderer, scrollPaneRenderer, overlayMessageRenderer, QrCodeRenderer, buttonItem,
} from './ytUI.js';
import { YTARK_BUILD_INFO } from '../assets/buildInfo.generated.js';
import { tx } from '../translations/text.js';
import { browserDiagnostics } from '../features/browserDiagnostics.js';

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
    /** True when the platform can answer "which YTArk package is installed". */
    packageVersion: !!(native && typeof native.GetVersion === 'function'),
  };
}

/**
 * The installed YTArk version to show: package metadata when the platform
 * answered, this build's packaging metadata otherwise, labelled by source.
 * Never the latest GitHub release and never the YouTube frontend version.
 */
export function ytarkDisplayVersion() {
  const label = installedVersionLabel();
  return label || 'unknown';
}

/** True while the package read is still in flight (the row shows a loading state). */
export function ytarkVersionLoading() {
  return installedVersionInfo().loading;
}

export function ytarkUpdateSubtitle() {
  const info = installedVersionInfo();
  if (info.loading) {
    return 'Reading the installed version · check the official stable release';
  }
  if (!info.version) {
    return 'Installed version: unknown · check the official YTArk release from here';
  }
  const source = info.source === VERSION_SOURCES.package
    ? '' : ' (build metadata)';
  return `Installed version: ${info.display}${source} · check the official stable release`;
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
    ['sponsor', 'enableSponsorBlockSponsor', 'MONEY_HEART'],
    ['intro', 'enableSponsorBlockIntro', 'PLAY_CIRCLE'],
    ['outro', 'enableSponsorBlockOutro', null],
    ['interaction', 'enableSponsorBlockInteraction', null],
    ['selfpromo', 'enableSponsorBlockSelfPromo', null],
    ['preview', 'enableSponsorBlockPreview', null],
    ['filler', 'enableSponsorBlockFiller', null],
    ['music_offtopic', 'enableSponsorBlockMusicOfftopic', null],
  ];
  return categories.map(([category, key, icon]) => (mode === 'multi'
    ? { id: `${prefix}.${category}`, title: t(`settings.options.sponsorblock.options.categories.${category}`), value: category, icon: icon || undefined }
    : {
      id: `${prefix}.${category}`,
      type: 'toggle',
      title: t(`settings.options.sponsorblock.options.categories.${category}`),
      key,
      icon: icon || undefined,
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

/**
 * About YTArk stays concise and TV-readable. Release notes, technical data,
 * attribution, licenses and project access are separate navigable destinations.
 */
function aboutPanel() {
  const info = installedVersionInfo();
  const version = info.loading
    ? tx('ytark.about.versionLoading', 'Reading the installed version…')
    : `YTArk ${ytarkDisplayVersion()}`;
  const items = [overlayMessageRenderer(tx(
    'ytark.about.description', 'Independent enhancements for the YouTube TV app.'))];
  items.push(
    buttonItem(
      {
        title: tx('ytark.about.changelog', 'Changelog'),
        subtitle: tx('ytark.about.changelogSubtitle', 'Full release notes and earlier versions'),
      },
      { icon: 'HISTORY' },
      [custom('YTARK_CHANGELOG_SHOW', { focusVersion: info.version || '', settingsInputOwner: true })],
    ),
    buttonItem(
      {
        title: tx('ytark.about.buildDetailsTitle', 'Technical details'),
        subtitle: tx('ytark.about.buildDetailsSubtitle', 'Version code, engine and frontend identifiers'),
      },
      { icon: 'INFO' },
      [custom('YTARK_PANEL_SHOW', { id: 'about.buildInfo' })],
    ),
    (() => {
      const row = buttonItem(
        { title: 'Diagnostics', subtitle: 'Four local browser and native-updater controls' },
        { icon: 'INFO' }, [custom('YTARK_PANEL_SHOW', { id: 'about.diagnostics' })],
      );
      row.compactLinkRenderer.itemId = 'ytark-about-diagnostics';
      return row;
    })(),
    buttonItem(
      {
        title: tx('ytark.about.noticesTitle', 'Credits & licenses'),
        subtitle: tx('ytark.about.noticesSubtitle', 'Project attribution and bundled licence notices'),
      },
      { icon: 'LIST' },
      [custom('YTARK_PANEL_SHOW', { id: 'about.notices' })],
    ),
    buttonItem(
      {
        title: tx('ytark.about.projectLink', 'Project link'),
        subtitle: tx('ytark.about.projectLinkSubtitle', 'YTArk on GitHub'),
      },
      { icon: 'OPEN_IN_NEW' },
      [custom('YTARK_PANEL_SHOW', { id: 'about.project' })],
    ),
  );
  return {
    title: 'About YTArk',
    subtitle: version,
    content: overlayPanelItemListRenderer(items, 0),
  };
}

/** Four primary, bounded native rows; detailed local facts live in the summary panel. */
function aboutDiagnosticsPanel(options = {}) {
  const enabled = configRead('recordBrowserDiagnostics') === true;
  const recorderState = browserDiagnostics.status;
  const summary = browserDiagnostics.startupSummary().split('\n');
  const line = prefix => summary.find(value => value.startsWith(prefix)) || '';
  const sample = line('Latest sample:').replace(/^Latest sample:\s*/, '').replace(/\.$/, '') || 'No saved sample';
  const durationDetail = line('Valid startup duration for latest sample:')
    .replace(/^Valid startup duration for latest sample:\s*/, '').replace(/\.$/, '');
  const duration = durationDetail.match(/^\d+(?:\.\d+)? ms/)?.[0] || 'duration unavailable';
  const modeText = line('Faster startup preference:');
  const actualMode = modeText.includes('Actual readiness mode:')
    ? modeText.split('Actual readiness mode:').slice(1).join('Actual readiness mode:').replace(/\.$/, '').trim()
    : 'not recorded';
  const result = line('Latest result:').replace(/^Latest result:\s*/, '').replace(/\.$/, '') || 'No result recorded';
  const summarySubtitle = `${sample} · ${duration} · actual ${actualMode} · ${result}`;
  const makeRow = (id, title, subtitle, icon, action, parameters = {}) => {
    const row = buttonItem({ title, subtitle }, { icon }, [custom(action, parameters)]);
    row.compactLinkRenderer.itemId = `ytark-diagnostics-${id}`;
    return row;
  };
  const items = [
    makeRow('android', 'Android updater', 'Open native update, install-permission and Android diagnostics controls.',
      'SYSTEM_UPDATE', 'YTARK_NATIVE_UPDATES_OPEN'),
    makeRow('recording', 'Recording', enabled
      ? (recorderState === 'recording' ? 'On · a browser sample is recording.' : 'On · no sample is active.')
      : 'Off · no browser measurements are being collected.',
      enabled ? 'STOP' : 'PLAY_ARROW', 'YTARK_DIAGNOSTICS_SET',
      { enabled: !enabled, returnFocusIndex: 1 }),
    makeRow('startup-summary', 'Startup summary', summarySubtitle,
      'ASSESSMENT', 'YTARK_DIAGNOSTICS_STARTUP_SUMMARY', { returnFocusIndex: 2 }),
    makeRow('clear', 'Clear diagnostic data', 'Remove saved browser samples only; settings and accounts are unchanged.',
      'DELETE', 'YTARK_DIAGNOSTICS_CLEAR_CONFIRM', { returnFocusIndex: 3 }),
  ];
  const requested = Number(options.focusIndex);
  const selectedIndex = Number.isInteger(requested) && requested >= 0 && requested < items.length ? requested : 1;
  return {
    title: 'Diagnostics',
    subtitle: 'Browser measurements stay on this device · Android updater is separate',
    content: overlayPanelItemListRenderer(items, selectedIndex),
  };
}

function aboutBuildInfoPanel() {
  const build = YTARK_BUILD_INFO || {};
  const installed = installedVersionInfo();
  const lines = [];
  if (build.versionName) lines.push(`${tx('ytark.about.versionName', 'Build versionName')}: ${build.versionName}`);
  if (build.versionCode !== undefined && build.versionCode !== null) {
    lines.push(`${tx('ytark.about.versionCode', 'versionCode')}: ${String(build.versionCode)}`);
  }
  if (build.appId) lines.push(`${tx('ytark.about.package', 'Android package')}: ${build.appId}`);
  if (build.commit || build.buildCommit) {
    lines.push(`${tx('ytark.about.buildCommit', 'Build commit')}: ${build.commit || build.buildCommit}`);
  }
  if (build.baseTag) lines.push(`${tx('ytark.about.baseTag', 'Android engine/base')}: ${build.baseTag}`);
  if (build.scriptTag) lines.push(`${tx('ytark.about.scriptVersion', 'YTArk userscript revision')}: ${build.scriptTag}`);
  if (installed.source === VERSION_SOURCES.package && installed.version && installed.version !== build.versionName) {
    lines.push(`${tx('ytark.about.installedVersionName', 'Installed package version')}: ${installed.version}`);
  }
  const frontend = youtubeFrontendVersion();
  if (frontend) lines.push(`${tx('ytark.about.frontendVersion', 'YouTube frontend version')}: ${frontend}`);
  return {
    title: tx('ytark.about.buildDetailsTitle', 'Technical details'),
    subtitle: tx('ytark.about.buildDetailsSubtitle', 'Version code, engine and frontend identifiers'),
    content: scrollPaneRenderer(lines.map(line => overlayMessageRenderer(line))),
  };
}

/**
 * Attribution and licence pointers. Kept grouped and scrollable so the primary
 * About screen stays readable without dropping third-party notices.
 */
function aboutNoticesPanel() {
  const build = YTARK_BUILD_INFO || {};
  const lines = [];
  if (build.baseTag) {
    lines.push(`YTArk is an independent build based on TizenTubeCobalt ${build.baseTag} (TizenTube, GNU GPL v3).`);
  } else {
    lines.push('YTArk is an independent Android TV application. Source: https://github.com/2archiver/YTArk.');
  }
  lines.push(
    'Bundled and adapted components keep their own licences: TizenTube (GPL-3.0-only), TizenTubeCobalt/Cobalt (BSD-style Cobalt licence with its own NOTICE), SponsorBlock, DeArrow and the QR encoder. Full texts are in NOTICE.md and TizenTube/LICENSE in the repository and release assets.',
    'Google, Android, YouTube and YouTube TV are trademarks of Google LLC. The optional YouTube Premium wordmark is a local visual only; it does not provide a subscription or account benefits.',
  );
  return {
    title: tx('ytark.about.noticesTitle', 'Credits & licenses'),
    subtitle: tx('ytark.about.noticesSubtitle', 'Project attribution and bundled licence notices'),
    content: scrollPaneRenderer(lines.map(line => overlayMessageRenderer(line))),
  };
}

function aboutProjectPanel() {
  return supportPanel('YTArk on GitHub', 'https://github.com/2archiver/YTArk')();
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
      id: 'playback',
      type: 'menu',
      title: tx('ytark.categories.playback.title', 'Playback'),
      description: tx('ytark.categories.playback.description', 'Player, video and subtitles'),
      icon: 'PLAY_CIRCLE',
      menuId: 'ytark-playback',
      header: { title: tx('ytark.categories.playback.title', 'Playback'), subtitle: tx('ytark.categories.playback.description', 'Player, video and subtitles') },
      resetKeys: ['enablePatchingVideoPlayer', 'enablePreviousNextButtons', 'enableSuperThanksButton', 'enableAIAskButton', 'enableSpeedControlsButton', 'enableMPButton', 'enableSwapMPWithPIP', 'preferredVideoQuality', 'speedSettingsIncrement', 'videoSpeed', 'hideRelatedVideosPlayer', 'preferredVideoCodec', 'autoFrameRate', 'autoFrameRatePauseVideoFor', 'enablePlaybackRecovery', 'enableShowUserLanguage', 'enableShowOtherLanguages'],
      children: [
      {
        id: 'player',
        type: 'menu',
        title: t('settings.options.videoPlayer.title'),
        description: t('settings.options.videoPlayer.subtitle'),
        icon: 'VIDEO_YOUTUBE',
        menuId: 'ytark-video-player',
        header: { title: t('settings.options.videoPlayer.title'), subtitle: t('settings.options.videoPlayer.subtitle') },
        resetKeys: ['enablePatchingVideoPlayer', 'enablePreviousNextButtons', 'enableSuperThanksButton', 'enableAIAskButton',
          'enableSpeedControlsButton', 'enableMPButton', 'enableSwapMPWithPIP', 'preferredVideoQuality', 'speedSettingsIncrement',
          'videoSpeed', 'hideRelatedVideosPlayer', 'preferredVideoCodec', 'autoFrameRate', 'autoFrameRatePauseVideoFor', 'enablePlaybackRecovery'],
        children: [
          {
            id: 'player.patching',
            type: 'menu',
            title: t('settings.options.videoPlayer.options.patching.title'),
            icon: 'SETTINGS',
            menuId: 'tt-video-player-ui-patching',
            children: [
              { id: 'player.patching.enable', type: 'toggle', title: t('settings.options.videoPlayer.options.patching.options.enableVPUIPatching'), icon: 'SETTINGS', key: 'enablePatchingVideoPlayer' },
              { id: 'player.patching.previousNext', type: 'toggle', title: t('settings.options.videoPlayer.options.patching.options.previousNextBtns'), icon: 'SKIP_NEXT', key: 'enablePreviousNextButtons', dependsOn: patchDependency },
              { id: 'player.patching.superThanks', type: 'toggle', title: t('settings.options.videoPlayer.options.patching.options.showSuperThxBtn'), icon: 'MONEY_HEART', key: 'enableSuperThanksButton', dependsOn: patchDependency },
              { id: 'player.patching.askAi', type: 'toggle', title: t('settings.options.videoPlayer.options.patching.options.showAIAskBtn'), icon: 'SPARK', key: 'enableAIAskButton', dependsOn: patchDependency },
              { id: 'player.patching.speed', type: 'toggle', title: t('settings.options.videoPlayer.options.patching.options.showSpeedCtrlBtn'), icon: 'SLOW_MOTION_VIDEO', key: 'enableSpeedControlsButton', dependsOn: patchDependency },
              { id: 'player.patching.miniPlayer', type: 'toggle', title: t('settings.options.videoPlayer.options.patching.options.addMPBtn'), icon: 'CLEAR_COOKIES', key: 'enableMPButton', dependsOn: patchDependency },
              {
                id: 'player.patching.swapPip',
                type: 'toggle',
                title: t('settings.options.videoPlayer.options.patching.options.swapMPWithPIP'),
                icon: 'CLEAR_COOKIES',
                key: 'enableSwapMPWithPIP',
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
            options: [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5].map(step => ({
              id: `player.speedIncrement.${step}`,
              title: `${step}x`,
              value: step,
            })),
          },
          { id: 'player.hideRelated', type: 'toggle', title: t('settings.options.videoPlayer.options.hideRelatedVideosPlayer'), icon: 'VISIBILITY_OFF', key: 'hideRelatedVideosPlayer' },
          {
            id: 'player.recovery',
            type: 'toggle',
            title: tx('ytark.playback.recovery.title', 'Automatic playback recovery'),
            description: tx('ytark.playback.recovery.description', 'Retry a stalled or recoverable playback error a limited number of times. Paused, completed, seeking and background playback are excluded.'),
            icon: 'REFRESH',
            key: 'enablePlaybackRecovery',
            },
          {
            id: 'player.codec',
            type: 'choice',
            title: t('settings.options.videoPlayer.options.preferredVideoCodec.title'),
            description: t('settings.options.videoPlayer.options.preferredVideoCodec.subtitle'),
            icon: 'VIDEO_QUALITY',
            key: 'preferredVideoCodec',
            menuId: 'tt-preferred-video-codec',
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
          { id: 'misc.longPress', type: 'toggle', title: t('settings.options.misc.options.longPress'), key: 'enableLongPress' },
      {
        id: 'subtitles',
        type: 'menu',
        title: t('settings.options.subtitles.title'),
        icon: 'TRANSLATE',
        menuId: 'ytark-subtitles',
        resetKeys: ['enableShowUserLanguage', 'enableShowOtherLanguages'],
        children: [
          { id: 'subtitles.userLanguage', type: 'toggle', title: t('settings.options.subtitles.options.showLocalSubtitle'), key: 'enableShowUserLanguage' },
          { id: 'subtitles.otherLanguages', type: 'toggle', title: t('settings.options.subtitles.options.showHiddenSubtitles'), key: 'enableShowOtherLanguages' },
        ],
      },
    ],
    },
    {
      id: 'appearance',
      type: 'menu',
      title: tx('ytark.appearance.title', 'Appearance'),
      description: tx('ytark.appearance.description', 'Player look, thumbnails and screen behaviour'),
      icon: 'DARK_THEME',
      menuId: 'ytark-appearance',
      resetKeys: ['hidePlayerWatermark', 'removePlayerScrim', 'enableScreenDimming', 'dimmingTimeout', 'dimmingOpacity', 'enableHideWatchedVideos', 'hideWatchedVideosThreshold', 'hideWatchedVideosPages', 'enableClock', 'isClock12HourFormat', 'clockShowSeconds', 'clockHideWhenVideoPlaying', 'enableShrinkingThumbnails', 'enableHqThumbnails'],
      children: [
        {
          id: 'appearance.player',
          type: 'menu',
          title: tx('ytark.appearance.player.title', 'Player'),
          description: tx('ytark.appearance.player.description', 'Watermark and control-overlay dimming'),
          icon: 'VIDEO_YOUTUBE',
          menuId: 'ytark-appearance-player',
          children: [
            {
              id: 'appearance.player.hideWatermark',
              type: 'toggle',
              title: tx('ytark.appearance.player.hideWatermark', 'Hide channel watermark'),
              description: tx('ytark.appearance.player.hideWatermarkDescription', 'Hide the clickable channel logo over videos.'),
              icon: 'VISIBILITY_OFF',
              key: 'hidePlayerWatermark',
              },
            {
              id: 'appearance.player.removeScrim',
              type: 'toggle',
              title: tx('ytark.appearance.player.removeScrim', 'Remove player dimming'),
              description: tx('ytark.appearance.player.removeScrimDescription', 'Keep the video bright when playback controls are visible.'),
              icon: 'EYE_OFF',
              key: 'removePlayerScrim',
              },
            {
              id: 'appearance.player.hideEndCards',
              type: 'toggle',
              title: tx('ytark.appearance.player.hideEndCards', 'Hide end-screen cards'),
              description: tx('ytark.appearance.player.hideEndCardsDescription', 'Removes the clickable cards shown over the last seconds of a video.'),
              icon: 'VISIBILITY_OFF',
              key: 'enableHideEndScreenCards',
              },
            {
              id: 'appearance.player.idleDimming',
              type: 'link',
              target: 'ui.screenDimming',
              title: tx('ytark.appearance.player.idleDimming', 'Screen dimming when idle'),
              description: tx('ytark.appearance.player.idleDimmingDescription', 'Separate setting under User Interface'),
              icon: 'TIMER',
            },
          ],
        },
        {
          id: 'appearance.premiumLogo',
          type: 'toggle',
          title: tx('ytark.appearance.premiumLogo.title', 'Premium logo (cosmetic)'),
          description: tx('ytark.appearance.premiumLogo.description', 'Local wordmark only; it never grants or claims a paid YouTube subscription.'),
          icon: 'VIDEO_YOUTUBE',
          key: 'enablePremiumLogo',
          },
            {
              id: 'ui.screenDimming',
              type: 'menu',
              title: t('settings.options.uiSettings.options.screenDimming.title'),
              description: tx('ytark.ui.screenDimmingDescription', 'Dims the app after inactivity; separate from player dimming'),
              icon: 'EYE_OFF',
              menuId: 'tt-screen-dimming-settings',
              children: [
                { id: 'ui.screenDimming.enable', type: 'toggle', title: t('settings.options.uiSettings.options.screenDimming.options.enableScreenDimming'), icon: 'EYE_OFF', key: 'enableScreenDimming' },
                {
                  id: 'ui.screenDimming.timeout',
                  type: 'choice',
                  title: t('settings.options.uiSettings.options.screenDimming.options.dimmingTimeout.title'),
                  description: t('settings.options.uiSettings.options.screenDimming.options.dimmingTimeout.subtitle'),
                  icon: 'TIMER',
                  key: 'dimmingTimeout',
                  menuId: 'tt-dimming-timeout',
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
              children: [
                { id: 'ui.hideWatched.enable', type: 'toggle', title: t('settings.options.uiSettings.options.hideWatchedVideos.options.enableHideWatchedVideos'), icon: 'VISIBILITY_OFF', key: 'enableHideWatchedVideos' },
                {
                  id: 'ui.hideWatched.threshold',
                  type: 'choice',
                  title: t('settings.options.uiSettings.options.hideWatchedVideos.options.watchedVideosThreshold.title'),
                  description: t('settings.options.uiSettings.options.hideWatchedVideos.options.watchedVideosThreshold.subtitle'),
                  key: 'hideWatchedVideosThreshold',
                  menuId: 'tt-hide-watched-videos-threshold',
                  dependsOn: { key: 'enableHideWatchedVideos', title: t('settings.options.uiSettings.options.hideWatchedVideos.options.enableHideWatchedVideos') },
                  options: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map(percent => ({ id: `ui.hideWatched.threshold.${percent}`, title: `${percent}%`, value: percent })),
                },
                {
                  id: 'ui.hideWatched.pages',
                  type: 'multi',
                  title: t('settings.options.uiSettings.options.hideWatchedVideos.options.setPagesToHideWatchedVideos'),
                  key: 'hideWatchedVideosPages',
                  menuId: 'tt-hide-watched-videos-pages',
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
              header: { title: t('settings.options.uiSettings.options.clock.title'), subtitle: t('settings.options.uiSettings.options.clock.subtitle') },
              children: [
                { id: 'ui.clock.enable', type: 'toggle', title: t('settings.options.uiSettings.options.clock.options.enableClock'), icon: 'TIMER', key: 'enableClock' },
                { id: 'ui.clock.twelveHour', type: 'toggle', title: t('settings.options.uiSettings.options.clock.options.isClock12HourFormat'), icon: 'TIMER', key: 'isClock12HourFormat', dependsOn: { key: 'enableClock', title: t('settings.options.uiSettings.options.clock.options.enableClock') } },
                { id: 'ui.clock.seconds', type: 'toggle', title: t('settings.options.uiSettings.options.clock.options.clockShowSeconds'), icon: 'TIMER', key: 'clockShowSeconds', dependsOn: { key: 'enableClock', title: t('settings.options.uiSettings.options.clock.options.enableClock') } },
                { id: 'ui.clock.hideInPlayer', type: 'toggle', title: t('settings.options.uiSettings.options.clock.options.clockHideWhenVideoPlaying'), icon: 'EYE_OFF', key: 'clockHideWhenVideoPlaying', dependsOn: { key: 'enableClock', title: t('settings.options.uiSettings.options.clock.options.enableClock') } },
              ],
            },
            {
              id: 'ui.enableShrinkingThumbnails',
              type: 'toggle',
              title: t('settings.options.uiSettings.options.enableShrinkingThumbnails'),
              description: tx('ytark.appearance.enableShrinkingThumbnails.description',
                'Keep video thumbnails smaller and consistently sized.'),
              key: 'enableShrinkingThumbnails',
            },
            { id: 'misc.hqThumbnails', type: 'toggle', title: t('settings.options.misc.options.hqThumbnails'), icon: 'VIDEO_QUALITY', key: 'enableHqThumbnails' },
      ],
    },
    {
      id: 'privacy',
      type: 'menu',
      title: tx('ytark.categories.privacy.title', 'Privacy'),
      description: tx('ytark.categories.privacy.description', 'Ads, content filtering and prompts'),
      icon: 'PRIVACY_UNLISTED',
      menuId: 'ytark-privacy',
      header: { title: tx('ytark.categories.privacy.title', 'Privacy'), subtitle: tx('ytark.categories.privacy.description', 'Ads, content filtering and prompts') },
      resetKeys: ['enableSponsorBlock', 'sponsorBlockManualSkips', 'enableSponsorBlockSponsor', 'enableSponsorBlockIntro', 'enableSponsorBlockOutro', 'enableSponsorBlockInteraction', 'enableSponsorBlockSelfPromo', 'enableSponsorBlockPreview', 'enableSponsorBlockFiller', 'enableSponsorBlockMusicOfftopic', 'enableSponsorBlockHighlight', 'enableSponsorBlockToasts', 'enableDeArrow', 'enableDeArrowThumbnails', 'enableShorts', 'enablePreviews'],
      children: [
          {
            id: 'privacy.adBlock',
            type: 'toggle',
            title: 'Ad blocking',
            description: 'Enabled by default. Independent of SponsorBlock and the logo.',
            icon: 'DOLLAR_SIGN',
            key: 'enableAdBlock',
            },
      {
        id: 'sponsorblock',
        type: 'menu',
        title: t('settings.options.sponsorblock.title'),
        description: `Currently ${configRead('enableSponsorBlock') ? 'ON' : 'OFF'} · https://sponsor.ajay.app/`,
        icon: 'MONEY_HAND',
        menuId: 'tt-sponsorblock-settings',
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
            command: [custom('SPONSORBLOCK_UNDO_SKIP')],
          },
          { id: 'sponsorblock.enable', type: 'toggle', title: t('settings.options.sponsorblock.options.enableSB'), icon: 'MONEY_HAND', key: 'enableSponsorBlock' },
          {
            id: 'sponsorblock.manualSkip',
            type: 'multi',
            title: t('settings.options.sponsorblock.options.manualSkip'),
            icon: 'DOLLAR_SIGN',
            key: 'sponsorBlockManualSkips',
            menuId: 'tt-sponsorblock-manual-segment-skip',
            dependsOn: sbDependency,
            options: sponsorCategories('sponsorblock.manualSkip', 'multi'),
          },
          {
            id: 'sponsorblock.segments',
            type: 'menu',
            title: t('settings.options.sponsorblock.options.segments'),
            icon: 'SETTINGS',
            menuId: 'tt-sponsorblock-segments',
            children: sponsorCategories('sponsorblock.segments', 'toggle').concat([{
              id: 'sponsorblock.segments.highlight',
              type: 'toggle',
              title: t('settings.options.sponsorblock.options.categories.highlights'),
              icon: 'LOCATION_POINT',
              key: 'enableSponsorBlockHighlight',
              dependsOn: sbDependency,
            }]),
          },
          { id: 'sponsorblock.toasts', type: 'toggle', title: t('settings.options.sponsorblock.options.showSBToasts'), key: 'enableSponsorBlockToasts', dependsOn: sbDependency },
        ],
      },
      {
        id: 'dearrow',
        type: 'menu',
        title: t('settings.options.dearrow.title'),
        description: 'https://dearrow.ajay.app/',
        icon: 'VISIBILITY_OFF',
        menuId: 'ytark-dearrow',
        header: { title: t('settings.options.dearrow.title'), subtitle: 'https://dearrow.ajay.app/' },
        resetKeys: ['enableDeArrow', 'enableDeArrowThumbnails'],
        children: [
          { id: 'dearrow.enable', type: 'toggle', title: t('settings.options.dearrow.options.enableDA'), icon: 'VISIBILITY_OFF', key: 'enableDeArrow' },
          { id: 'dearrow.thumbnails', type: 'toggle', title: t('settings.options.dearrow.options.enableDAThumbnails'), icon: 'TV', key: 'enableDeArrowThumbnails', dependsOn: { key: 'enableDeArrow', title: t('settings.options.dearrow.options.enableDA') } },
        ],
      },
      // Feed content filtering, relocated from the retired "YTArk Quick
      // Controls" menu: one authoritative row per behaviour, in the category
      // whose description already covers it ("Ads, content filtering and
      // prompts"). The inverted labels match what turning them on does.
      {
        id: 'privacy.hideShorts',
        type: 'toggle',
        title: tx('ytark.privacy.hideShorts', 'Hide Shorts'),
        description: tx('ytark.privacy.hideShortsDescription', 'Removes Shorts shelves and tiles from feeds'),
        icon: 'YOUTUBE_SHORTS_FILL_24',
        key: 'enableShorts',
        invert: true,
        },
      {
        id: 'privacy.hidePreviews',
        type: 'toggle',
        title: tx('ytark.privacy.hidePreviews', 'Hide video previews'),
        description: tx('ytark.privacy.hidePreviewsDescription', 'Stops video previews when a tile is focused'),
        icon: 'VISIBILITY_OFF',
        key: 'enablePreviews',
        invert: true,
        },
          { id: 'misc.paidPromotion', type: 'toggle', title: t('settings.options.misc.options.paidPromoOverlay'), icon: 'MONEY_HAND', key: 'enablePaidPromotionOverlay' },
          { id: 'misc.youThere', type: 'toggle', title: t('settings.options.misc.options.youThereRenderer'), icon: 'HELP', key: 'enableYouThereRenderer' },
    ],
    },
    {
      id: 'navigation',
      type: 'menu',
      title: tx('ytark.categories.navigation.title', 'Navigation'),
      description: tx('ytark.categories.navigation.description', 'Guide, startup and the YouTube Settings page'),
      icon: 'MENU',
      menuId: 'ytark-navigation',
      header: { title: tx('ytark.categories.navigation.title', 'Navigation'), subtitle: tx('ytark.categories.navigation.description', 'Guide, startup and the YouTube Settings page') },
      resetKeys: ['launchToOnStartup', 'sortSubscriptionsByAlphabet', 'disableChannelsOnSidebar', 'enableYtarkGuideEntry', 'showAutomaticProfilePicker', 'reloadHomeOnStartup'],
      children: [
          {
            id: 'ui.disableSidebar',
            type: 'action',
            title: t('settings.options.uiSettings.options.disableSidebarContents.title'),
            description: t('settings.options.uiSettings.options.disableSidebarContents.subtitle'),
            icon: 'MENU',
            command: [custom('SHOW_GUIDE_SETTINGS', 'disabledSidebarContents')],
          },
          {
            id: 'ui.sortSidebar',
            type: 'action',
            title: t('settings.options.uiSettings.options.sortSidebarContents.title'),
            description: t('settings.options.uiSettings.options.sortSidebarContents.subtitle'),
            icon: 'MENU',
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
          { id: 'ui.sortSubscriptions', type: 'toggle', title: t('settings.options.uiSettings.options.sortSubscriptionsByAlphabet'), icon: 'SUBSCRIPTIONS', key: 'sortSubscriptionsByAlphabet' },
          { id: 'ui.disableChannelsOnSidebar', type: 'toggle', title: t('settings.options.uiSettings.options.disableChannelsOnSidebar'), key: 'disableChannelsOnSidebar' },
          {
            id: 'nav.guideEntry',
            type: 'toggle',
            title: tx('ytark.navigation.guideEntry.title', 'YTArk entry in the guide'),
            description: tx('ytark.navigation.guideEntry.description', 'Adds a YTArk Settings entry at the bottom of the TV guide. Selecting it with OK opens the panel; scrolling past it only highlights it.'),
            icon: 'MENU',
            key: 'enableYtarkGuideEntry',
            },
          {
            id: 'nav.profilePicker',
            type: 'toggle',
            title: tx('ytark.navigation.profilePicker.title', "Who's watching"),
            description: tx('ytark.navigation.profilePicker.description', 'Show the automatic profile picker.'),
            icon: 'ACCOUNT_CIRCLE',
            key: 'showAutomaticProfilePicker',
          },
          { id: 'misc.reloadHome', type: 'toggle', title: t('settings.options.misc.options.reloadHomeOnStartup'), key: 'reloadHomeOnStartup' },
          {
            id: 'nav.fasterStartup',
            type: 'toggle',
            key: 'fasterStartup',
            title: 'Faster startup (Experimental)',
            description: 'Applies on the next app start. Checks YTArk controls sooner; slow readiness returns to normal pacing.',
            icon: 'SPEED',
          },
    ],
    },
    {
      id: 'updates',
      type: 'action',
      title: 'YTArk Updates',
      description: 'Check for updates and manage automatic checks and downloads',
      icon: 'SYSTEM_UPDATE',
      command: [custom('YTARK_NATIVE_UPDATES_OPEN', {})],
    },
    {
      id: 'about',
      type: 'panel',
      // Re-renders in place when the installed version arrives from the
      // platform, so the panel never stays on a loading state.
      versionAware: true,
      title: 'About YTArk',
      description: `YTArk version ${ytarkDisplayVersion()}`,
      icon: 'INFO',
      panel: aboutPanel,
      // Navigable subsections of the About dialog. They are reachable from the
      // panel only (not indexed, not rendered as rows), so the notices and the
      // build metadata cannot collide with the primary dialog.
      children: [
        {
          id: 'about.buildInfo',
          type: 'panel',
          title: tx('ytark.about.buildDetailsTitle', 'Technical details'),
          description: tx('ytark.about.buildDetailsSubtitle', 'Version code, engine and frontend identifiers'),
          icon: 'INFO',
          panel: aboutBuildInfoPanel,
        },
        {
          id: 'about.diagnostics',
          type: 'panel',
          title: 'Diagnostics',
          description: 'Local browser recording, startup summary and Android updater access',
          icon: 'INFO',
          panel: aboutDiagnosticsPanel,
        },
        {
          id: 'about.notices',
          type: 'panel',
          title: tx('ytark.about.noticesTitle', 'Credits & licenses'),
          description: tx('ytark.about.noticesSubtitle', 'Project attribution and bundled licence notices'),
          icon: 'LIST',
          panel: aboutNoticesPanel,
        },
        {
          id: 'about.project',
          type: 'panel',
          title: tx('ytark.about.projectLink', 'Project link'),
          description: tx('ytark.about.projectLinkSubtitle', 'YTArk on GitHub'),
          icon: 'OPEN_IN_NEW',
          panel: aboutProjectPanel,
        },
      ],
    },
    {
      id: 'support',
      type: 'menu',
      title: 'Support YTArk',
      icon: 'PRIVACY_UNLISTED',
      menuId: 'ytark-support',
      children: [
        { id: 'support.github', type: 'panel', title: 'YTArk on GitHub', description: 'https://github.com/2archiver/YTArk', icon: 'OPEN_IN_NEW', panel: supportPanel('YTArk on GitHub', 'https://github.com/2archiver/YTArk') },
        { id: 'support.kofi', type: 'panel', title: 'Support YTArk on Ko-fi', description: 'https://ko-fi.com/2archiver', icon: 'OPEN_IN_NEW', panel: supportPanel('Support YTArk on Ko-fi', 'https://ko-fi.com/2archiver') },
      ],
    },
  ];

  return {
    id: 'root',
    type: 'menu',
    title: 'YTArk Settings',
    description: tx('ytark.root.subtitle', 'YTArk\'s own playback, appearance, privacy and update settings for this YouTube TV app'),
    menuId: 'tt-settings',
    header: { title: 'YTArk Settings', subtitle: tx('ytark.root.subtitle', 'YTArk\'s own playback, appearance, privacy and update settings for this YouTube TV app') },
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
