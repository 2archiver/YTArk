import { configRead } from '../config.js';
import { removeAdSlotRenderers } from './adRendererPolicy.js';
import Chapters from '../ui/chapters.js';
import resolveCommand from '../resolveCommand.js';
import { timelyAction, longPressData, MenuServiceItemRenderer, ShelfRenderer, TileRenderer, ButtonRenderer } from '../ui/ytUI.js';
import { findFeedbackToken } from '../utils/innerTubeCalls.js';
import { PatchSettings } from '../ui/customYTSettings.js';
import { t } from 'i18next';

function codecAvailableInCurrentBrowser(format) {
  const video = document.querySelector('video');
  if (!video || typeof video.canPlayType !== 'function' || !format || !format.mimeType) return false;
  try {
    return video.canPlayType(format.mimeType) !== '';
  } catch (_) {
    return false;
  }
}


/**
 * This is a minimal reimplementation of the following uBlock Origin rule:
 * https://github.com/uBlockOrigin/uAssets/blob/3497eebd440f4871830b9b45af0afc406c6eb593/filters/filters.txt#L116
 *
 * This in turn calls the following snippet:
 * https://github.com/gorhill/uBlock/blob/bfdc81e9e400f7b78b2abc97576c3d7bf3a11a0b/assets/resources/scriptlets.js#L365-L470
 *
 * Seems like for now dropping just the adPlacements is enough for YouTube TV
 */
const origParse = JSON.parse;
JSON.parse = function () {
  const r = origParse.apply(this, arguments);
  try {
    if (!r || typeof r !== 'object') return r;
    const adBlockEnabled = configRead('enableAdBlock');

    if (r.adPlacements && adBlockEnabled) {
      r.adPlacements = [];
    }

    // Also set playerAds to false, just incase.
    if (r.playerAds && adBlockEnabled) {
      r.playerAds = false;
    }

    // Also set adSlots to an empty array, emptying only the adPlacements won't work.
    if (r.adSlots && adBlockEnabled) {
      r.adSlots = [];
    }

    if (r.paidContentOverlay && !configRead('enablePaidPromotionOverlay')) {
      r.paidContentOverlay = null;
    }

    if (Array.isArray(r?.streamingData?.adaptiveFormats)
        && configRead('preferredVideoCodec') !== 'any') {
      const preferredCodec = configRead('preferredVideoCodec');
      const formats = r.streamingData.adaptiveFormats;
      const usablePreferredFormats = formats.filter(format =>
        format && typeof format.mimeType === 'string'
        && format.mimeType.includes(preferredCodec)
        && codecAvailableInCurrentBrowser(format));
      // Only filter when the current Cobalt media element reports that at least
      // one of the actual supplied formats is playable. Otherwise retain Auto's
      // complete stream list rather than forcing an unsupported codec.
      if (usablePreferredFormats.length) {
        r.streamingData.adaptiveFormats = formats.filter(format =>
          format && typeof format.mimeType === 'string'
          && (format.mimeType.startsWith('audio/')
            || (format.mimeType.includes(preferredCodec) && codecAvailableInCurrentBrowser(format))));
      }
    }

    // Drop "masthead" ad from home screen
    if (
      r?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.content
        ?.sectionListRenderer?.contents
    ) {
      // Do not remove sign-in/feed nudges here. The TV frontend can place its
      // "Continue as guest" action in the same renderer family.

      if (adBlockEnabled) {
        r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents =
          removeAdSlotRenderers(
            r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents
          );

        for (const shelve of r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents) {
          if (shelve.shelfRenderer && shelve.shelfRenderer.content?.horizontalListRenderer?.items) {
            shelve.shelfRenderer.content.horizontalListRenderer.items = removeAdSlotRenderers(
              shelve.shelfRenderer.content.horizontalListRenderer.items
            );
          }
        }
      }

      processShelves(r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents);
    }

    if (
      r?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.content
        ?.gridRenderer?.items
    ) {
      addLongPress(r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.gridRenderer.items);
    }

    if (r.endscreen && configRead('enableHideEndScreenCards')) {
      r.endscreen = null;
    }

    if (r.messages && Array.isArray(r.messages) && !configRead('enableYouThereRenderer')) {
      r.messages = r.messages.filter(
        (msg) => !msg?.youThereRenderer
      );
    }

    // Remove shorts ads
    if (!Array.isArray(r) && r?.entries && adBlockEnabled) {
      r.entries = r.entries?.filter(
        (elm) => !elm?.command?.reelWatchEndpoint?.adClientParams?.isAd
      );
    }

    // Patch settings

    if (r?.title?.runs) {
      PatchSettings(r);
    }

    // DeArrow Implementation. I think this is the best way to do it. (DOM manipulation would be a pain)

    if (r?.contents?.sectionListRenderer?.contents) {
      processShelves(r.contents.sectionListRenderer.contents);
    }

    if (r?.continuationContents?.sectionListContinuation?.contents) {
      processShelves(r.continuationContents.sectionListContinuation.contents);
    }

    if (r?.continuationContents?.horizontalListContinuation?.items) {
      deArrowify(r.continuationContents.horizontalListContinuation.items);
      hqify(r.continuationContents.horizontalListContinuation.items);
      addLongPress(r.continuationContents.horizontalListContinuation.items);
      r.continuationContents.horizontalListContinuation.items = hideVideo(r.continuationContents.horizontalListContinuation.items);
    }

    if (r?.continuationContents?.gridContinuation?.items) {
      addLongPress(r.continuationContents.gridContinuation.items);
    }

    if (r?.contents?.tvBrowseRenderer?.content?.tvSecondaryNavRenderer?.sections) {
      for (let i = 0; i < r.contents.tvBrowseRenderer.content.tvSecondaryNavRenderer.sections.length; i++) {
        const section = r.contents.tvBrowseRenderer.content.tvSecondaryNavRenderer.sections[i].tvSecondaryNavSectionRenderer;
        if (!section || !section.tabs) continue;

        if (configRead('sortSubscriptionsByAlphabet')) {
          section.tabs.sort((a, b) => {
            if (a.tabRenderer.selected && !b.tabRenderer.selected) return -1;
            if (!a.tabRenderer.selected && b.tabRenderer.selected) return 1;
            return a.tabRenderer.title.localeCompare(b.tabRenderer.title);
          });
        }

        for (let j = 0; j < section.tabs.length; j++) {
          const tab = section.tabs[j];
          const content = tab.tabRenderer.content?.tvSurfaceContentRenderer?.content;
          if (content?.sectionListRenderer?.contents) {
            const index = section.tabs.indexOf(tab);
            const clone = content.sectionListRenderer.contents;
            processShelves(clone);
            section.tabs[index].tabRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents = clone;
          }
          if (content?.gridRenderer?.items) {
            addLongPress(content.gridRenderer.items);
          }
        }
      }
    }

    if (r?.contents?.singleColumnWatchNextResults?.pivot?.sectionListRenderer) {
      if (configRead('hideRelatedVideosPlayer')) {
        r.contents.singleColumnWatchNextResults.pivot.sectionListRenderer.contents = [{}]
        r.contents.singleColumnWatchNextResults.pivot.sectionListRenderer.continuations = []
      }
      // Preserve alert/action renderers: some YouTube sign-in screens expose
      // "Continue as guest" through this same stock frontend path.
      processShelves(r.contents.singleColumnWatchNextResults.pivot.sectionListRenderer.contents, false);
      if (window.queuedVideos?.videos?.length > 0) {
        const queuedVideosClone = window.queuedVideos.videos.slice();
        queuedVideosClone.unshift(TileRenderer(
          'Clear Queue',
          {
            customAction: {
              action: 'CLEAR_QUEUE'
            }
          }));
        r.contents.singleColumnWatchNextResults.pivot.sectionListRenderer.contents.unshift(ShelfRenderer(
          'Queued Videos',
          queuedVideosClone,
          queuedVideosClone.findIndex(v => v.contentId === window.queuedVideos.lastVideoId) !== -1 ?
            queuedVideosClone.findIndex(v => v.contentId === window.queuedVideos.lastVideoId)
            : 0
        ));
      }
    }
    if (configRead('enableChapters')) {
      try {
        const chapterData = Chapters(r);
        const mutations = r?.frameworkUpdates?.entityBatchUpdate?.mutations;
        if (chapterData && Array.isArray(mutations)
            && !mutations.some(mutation => mutation?.entityKey === chapterData.entityKey)) {
          mutations.push(chapterData);
          resolveCommand({
            clickTrackingParams: 'null',
            loadMarkersCommand: {
              visibleOnLoadKeys: [chapterData.entityKey],
              entityKeys: [chapterData.entityKey]
            }
          });
        }
      } catch (error) {
        // Description-derived chapters are best-effort; stock playback and
        // chapter controls remain available if this frontend shape changes.
        console.warn('[YTArk chapters] Could not augment this video:', error);
      }
    }

    // Manual SponsorBlock Skips

    if (r?.playerOverlays?.playerOverlayRenderer) {
      if (r.playerOverlays.playerOverlayRenderer.timelyActionRenderers) {
        r.playerOverlays.playerOverlayRenderer.timelyActionRenderers =
          r.playerOverlays.playerOverlayRenderer.timelyActionRenderers.filter(a => a.timelyActionRenderer.type !== 'TIMELY_ACTION_TYPE_SHOPPING' &&
            a.timelyActionRenderer.type !== 'TIMELY_ACTION_TYPE_NFL_WATERMARK');
      } else r.playerOverlays.playerOverlayRenderer.timelyActionRenderers = [];
      const manualSkipCategories = configRead('sponsorBlockManualSkips');
      if (configRead('enableSponsorBlock') && Array.isArray(manualSkipCategories)
          && manualSkipCategories.length > 0) {
        const manualSkippedSegments = manualSkipCategories;
        if (window?.sponsorblock?.segments) {
          for (const segment of window.sponsorblock.segments) {
            if (manualSkippedSegments.includes(segment.category)) {
              const timelyActionData = timelyAction(
                t('sponsorblock.toasts.skip', { segment: t(`sponsorblock.segments.${segment.category}`) }),
                'SKIP_NEXT',
                {
                  clickTrackingParams: null,
                  showEngagementPanelEndpoint: {
                    customAction: {
                      action: 'SKIP',
                      parameters: {
                        time: segment.segment[1],
                        source: 'sponsorblock',
                        category: segment.category,
                        undoable: true
                      }
                    }
                  }
                },
                segment.segment[0] * 1000,
                segment.segment[1] * 1000 - segment.segment[0] * 1000
              );
              r.playerOverlays.playerOverlayRenderer.timelyActionRenderers.push(timelyActionData);
            }
          }
        }
      }
    }

    if (r?.transportControls?.transportControlsRenderer?.promotedActions && configRead('enableSponsorBlockHighlight')) {
      if (window?.sponsorblock?.segments) {
        const category = window.sponsorblock.segments.find(seg => seg.category === 'poi_highlight');
        if (category) {
          r.transportControls.transportControlsRenderer.promotedActions.push({
            type: 'TRANSPORT_CONTROLS_BUTTON_TYPE_SPONSORBLOCK_HIGHLIGHT',
            button: {
              buttonRenderer: ButtonRenderer(
                false,
                t('sponsorblock.toasts.skipToHighlight'),
                'SKIP_NEXT',
                {
                  clickTrackingParams: null,
                  customAction: {
                    action: 'SKIP',
                    parameters: {
                      time: category.segment[0]
                    }
                  }
                })
            }
          });
        }
      }
    }

    if (r?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.header?.channelHeaderRenderer?.buttons) {
      let browseId = null;
      const title = r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.header.channelHeaderRenderer.title.simpleText;
      for (const service of r.responseContext.serviceTrackingParams) {
        for (const param of service.params) {
          if (param.key === 'browse_id') {
            browseId = param.value;
            break;
          }
        }
        if (browseId) break;
      }

      const inSidebar = configRead('sidebarContentsOrder')?.some(orderItem =>
        (typeof orderItem === 'object' ? orderItem.browseId : orderItem) === browseId);

      r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.header.channelHeaderRenderer.buttons.push({
        buttonRenderer: ButtonRenderer(
          false,
          inSidebar ? t('settings.options.uiSettings.options.sortSidebarContents.removeFromSidebar') : t('settings.options.uiSettings.options.sortSidebarContents.addToSidebar'),
          inSidebar ? 'REMOVE' : 'ADD',
          {
            customAction: {
              action: 'ADD_OR_REMOVE_CHANNEL_TO_SIDEBAR',
              parameters: {
                browseId,
                title
              }
            }
          }
        )
      })
    }
  } catch (e) {
    console.error('An error occured while processing the JSON:', e);
  }

  return r;
};

// Fix playback issues

const origStringify = JSON.stringify;
JSON.stringify = function (value, replacer, space) {
  if (configRead('enableAdBlock') && value?.playbackContext?.contentPlaybackContext) {
    const copiedValue = JSON.parse(origStringify(value));
    if (!copiedValue.playbackContext.contentPlaybackContext.isInlinePlaybackNoAd) {
      copiedValue.playbackContext.contentPlaybackContext.isInlinePlaybackNoAd = true;
      return origStringify.call(this, copiedValue, replacer, space);
    }
  }
  return origStringify.call(this, value, replacer, space);
};

window.JSON.stringify = JSON.stringify;

// Patch JSON.parse to use the custom one
window.JSON.parse = JSON.parse;
for (const key in window._yttv) {
  if (window._yttv[key] && window._yttv[key].JSON && window._yttv[key].JSON.parse) {
    window._yttv[key].JSON.parse = JSON.parse;
  }
}


function processShelves(shelves, shouldAddPreviews = true) {
  for (const shelve of shelves) {
    if (shelve.shelfRenderer) {
      if (!shelve.shelfRenderer.tvhtml5Style) shelve.shelfRenderer.tvhtml5Style = { effects: {} };
      if (configRead('disableEnlargingThumbnails')) shelve.shelfRenderer.tvhtml5Style.effects.enlarge = false;
      if (configRead('enableShrinkingThumbnails')) shelve.shelfRenderer.tvhtml5Style.effects.shrink = true;
      if (!shelve.shelfRenderer.content?.horizontalListRenderer?.items) continue;
      deArrowify(shelve.shelfRenderer.content.horizontalListRenderer.items);
      hqify(shelve.shelfRenderer.content.horizontalListRenderer.items);
      addLongPress(shelve.shelfRenderer.content.horizontalListRenderer.items);
      if (shouldAddPreviews) {
        addPreviews(shelve.shelfRenderer.content.horizontalListRenderer.items);
      }
      shelve.shelfRenderer.content.horizontalListRenderer.items = hideVideo(shelve.shelfRenderer.content.horizontalListRenderer.items);
      if (!configRead('enableShorts')) {
        if (shelve.shelfRenderer.tvhtml5ShelfRendererType === 'TVHTML5_SHELF_RENDERER_TYPE_SHORTS') {
          shelves.splice(shelves.indexOf(shelve), 1);
          continue;
        }
        shelve.shelfRenderer.content.horizontalListRenderer.items = shelve.shelfRenderer.content.horizontalListRenderer.items.filter(item => item.tileRenderer?.tvhtml5ShelfRendererType !== 'TVHTML5_TILE_RENDERER_TYPE_SHORTS');
        shelve.shelfRenderer.content.horizontalListRenderer.items = shelve.shelfRenderer.content.horizontalListRenderer.items.filter(item => item.lockupViewModel?.contentType !== 'LOCKUP_CONTENT_TYPE_SHORT');

        shelve.shelfRenderer.content.horizontalListRenderer.items = shelve.shelfRenderer.content.horizontalListRenderer.items.filter(item => !item.tileRenderer?.onSelectCommand?.reelWatchEndpoint);
      }
    }
  }
}

function addPreviews(items) {
  if (!configRead('enablePreviews')) return;
  for (const item of items) {
    if (item.tileRenderer) {
      const watchEndpoint = item.tileRenderer.onSelectCommand;
      const copiedEndpoint = JSON.parse(JSON.stringify(watchEndpoint));
      if (item.tileRenderer?.onFocusCommand?.playbackEndpoint) continue;
      if (item.tileRenderer?.onFocusCommand?.commandExecutorCommand) continue;
      item.tileRenderer.onFocusCommand = {
        startInlinePlaybackCommand: {
          blockAdoption: true,
          caption: false,
          delayMs: 3000,
          durationMs: 40000,
          muted: false,
          restartPlaybackBeforeSeconds: 10,
          resumeVideo: true,
          playbackEndpoint: copiedEndpoint
        }
      };
    }
  }
}

function deArrowify(items) {
  if (!Array.isArray(items) || !configRead('enableDeArrow')) return;
  for (const item of items) {
    const isLockupVideo = item?.lockupViewModel?.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO';
    if (!item?.tileRenderer && !isLockupVideo) continue;
    const videoID = item.tileRenderer?.contentId || item.lockupViewModel?.contentId;
    if (!videoID) continue;

    fetch(`https://sponsor.ajay.app/api/branding?videoID=${encodeURIComponent(videoID)}`)
      .then(res => {
        if (!res.ok) throw new Error(`DeArrow request returned HTTP ${res.status}`);
        return res.json();
      })
      .then(data => {
        const titles = Array.isArray(data?.titles) ? data.titles : [];
        const thumbnails = Array.isArray(data?.thumbnails) ? data.thumbnails : [];
        if (titles.length) {
          const mostVoted = titles.reduce((max, title) => max.votes > title.votes ? max : title);
          if (mostVoted && typeof mostVoted.title === 'string') {
            if (item.tileRenderer?.metadata?.tileMetadataRenderer?.title) {
              item.tileRenderer.metadata.tileMetadataRenderer.title.simpleText = mostVoted.title;
            } else if (item.lockupViewModel?.metadata?.lockupMetadataViewModel?.title) {
              item.lockupViewModel.metadata.lockupMetadataViewModel.title.content = mostVoted.title;
            }
          }
        }

        if (thumbnails.length && configRead('enableDeArrowThumbnails')) {
          const mostVotedThumbnail = thumbnails.reduce((max, thumbnail) => max.votes > thumbnail.votes ? max : thumbnail);
          if (mostVotedThumbnail?.timestamp) {
            const url = `https://dearrow-thumb.ajay.app/api/v1/getThumbnail?videoID=${encodeURIComponent(videoID)}&time=${encodeURIComponent(mostVotedThumbnail.timestamp)}`;
            if (item.tileRenderer?.header?.tileHeaderRenderer?.thumbnail) {
              item.tileRenderer.header.tileHeaderRenderer.thumbnail.thumbnails = [
                { url, width: 1280, height: 640 }
              ];
            } else if (item.lockupViewModel?.contentImage?.thumbnailViewModel?.image) {
              item.lockupViewModel.contentImage.thumbnailViewModel.image.sources = [
                { url, width: 1280, height: 640 }
              ];
            }
          }
        }
      })
      .catch(() => { });
  }
}


function hqify(items) {
  for (const item of items) {
    if (!item.tileRenderer && !item.lockupViewModel) continue;
    if (item?.tileRenderer?.style !== 'TILE_STYLE_YTLR_DEFAULT' && item?.lockupViewModel?.contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO') continue;
    if (configRead('enableHqThumbnails')) {
      if (!item?.tileRenderer?.onSelectCommand?.watchEndpoint?.videoId && !item?.lockupViewModel?.contentId) continue;
      if (!item?.tileRenderer?.header?.tileHeaderRenderer?.thumbnail?.thumbnails?.[0]?.url && !item?.lockupViewModel?.contentImage?.thumbnailViewModel?.image?.sources?.[0]?.url) continue;
      const videoID = item.tileRenderer ? item.tileRenderer.onSelectCommand.watchEndpoint.videoId : item.lockupViewModel.contentId;
      const queryArgs = item.tileRenderer ? item.tileRenderer.header.tileHeaderRenderer.thumbnail.thumbnails[0].url.split('?')[1] : item.lockupViewModel.contentImage.thumbnailViewModel.image.sources[0].url.split('?')[1];
      item.tileRenderer ? item.tileRenderer.header.tileHeaderRenderer.thumbnail.thumbnails = [
        {
          url: `https://i.ytimg.com/vi/${videoID}/sddefault.jpg${queryArgs ? `?${queryArgs}` : ''}`,
          width: 640,
          height: 480
        }
      ] : item.lockupViewModel.contentImage.thumbnailViewModel.image.sources = [
        {
          url: `https://i.ytimg.com/vi/${videoID}/sddefault.jpg${queryArgs ? `?${queryArgs}` : ''}`,
          width: 640,
          height: 480
        }
      ];
    }
  }
}

function addLongPress(items) {
  for (const item of items) {
    if (!item.tileRenderer && !item.lockupViewModel) continue;
    if (item?.tileRenderer?.style !== 'TILE_STYLE_YTLR_DEFAULT' && item?.lockupViewModel?.contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO') continue;
    if (item?.tileRenderer?.onLongPressCommand?.showMenuCommand?.menu?.menuRenderer?.items
      || item?.lockupViewModel?.rendererContext?.commandContext?.onLongPress?.innertubeCommand?.showMenuCommand?.menu?.menuRenderer?.items) {
      const copiedItem = JSON.parse(JSON.stringify(item));
      const button = MenuServiceItemRenderer('Add to Queue', {
        clickTrackingParams: null,
        playlistEditEndpoint: {
          customAction: {
            action: 'ADD_TO_QUEUE',
            parameters: copiedItem
          }
        }
      })
      const menuItems = item.tileRenderer ? item.tileRenderer.onLongPressCommand.showMenuCommand.menu.menuRenderer.items
        : item.lockupViewModel.rendererContext.commandContext.onLongPress.innertubeCommand.showMenuCommand.menu.menuRenderer.items;
      menuItems.push(button);
      restoreFeedbackMenuItems(item, menuItems);
      continue;
    }
    if (!configRead('enableLongPress')) continue;
    if (!item.tileRenderer?.metadata?.tileMetadataRenderer && !item.lockupViewModel?.metadata?.lockupMetadataViewModel) continue;
    if (!item.tileRenderer?.header?.tileHeaderRenderer?.thumbnail?.thumbnails &&
      !item.lockupViewModel?.contentImage?.thumbnailViewModel?.image?.sources) continue;
    if (!item?.tileRenderer?.onSelectCommand?.watchEndpoint &&
      !item?.lockupViewModel?.rendererContext?.commandContext?.onTap?.innertubeCommand?.watchEndpoint) continue;
    const copiedItem = JSON.parse(JSON.stringify(item));
    const subtitleNode = copiedItem?.tileRenderer ? copiedItem.tileRenderer.metadata?.tileMetadataRenderer?.lines?.[0]?.lineRenderer?.items?.[0]?.lineItemRenderer?.text :
      copiedItem.lockupViewModel.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows?.[0]?.metadataParts?.[0]?.text?.content
    ;
    if (!subtitleNode) continue;
    const subtitle = subtitleNode;
    const data = longPressData({
      videoId: copiedItem?.tileRenderer?.contentId || copiedItem?.lockupViewModel?.contentId,
      thumbnails: copiedItem?.tileRenderer?.header?.tileHeaderRenderer?.thumbnail?.thumbnails || copiedItem?.lockupViewModel?.contentImage?.thumbnailViewModel?.image?.sources,
      title: copiedItem?.tileRenderer?.metadata?.tileMetadataRenderer?.title?.simpleText || copiedItem?.lockupViewModel?.metadata?.lockupMetadataViewModel?.title?.content,
      subtitle: subtitle.length && subtitle.length > 0 ? subtitle : subtitle.runs ? subtitle.runs[0].text : subtitle.simpleText,
      watchEndpointData: copiedItem?.tileRenderer?.onSelectCommand?.watchEndpoint || copiedItem?.lockupViewModel?.rendererContext?.commandContext?.onTap?.innertubeCommand?.watchEndpoint,
      item: copiedItem
    });
    restoreFeedbackMenuItems(item, data.showMenuCommand.menu.menuRenderer.items);
    item.tileRenderer ? item.tileRenderer.onLongPressCommand = data
    : item.lockupViewModel.rendererContext.commandContext.onLongPress = {
      innertubeCommand: data
    };
  }
}

// YouTube moved the "Not interested" and "Don't recommend channel" items out of the
// long press menu into an engagement panel (panelId + params) that has to be fetched
// via /youtubei/v1/get_panel before the feedback tokens can be used. If the item
// carries such a panel reference and the menu doesn't already contain feedback items,
// add them back. The actual token fetching / feedback sending happens on click via
// the NOT_INTERESTED / DONT_RECOMMEND_CHANNEL custom actions (see resolveCommand.js).
function getFeedbackPanel(item) {
  const onLongPress = item?.tileRenderer
    ? item.tileRenderer.onLongPressCommand
    : item?.lockupViewModel?.rendererContext?.commandContext?.onLongPress;
  const endpoint = onLongPress?.showEngagementPanelEndpoint
    ?? onLongPress?.innertubeCommand?.showEngagementPanelEndpoint;
  if (endpoint?.identifier?.tag && endpoint?.globalConfiguration?.params) {
    return {
      panelId: endpoint.identifier.tag,
      params: endpoint.globalConfiguration.params
    };
  }
  return null;
}

function restoreFeedbackMenuItems(item, menuItems) {
  const panel = getFeedbackPanel(item);
  if (!panel || menuHasFeedbackItems(menuItems)) return;
  for (const feedbackItem of feedbackMenuItems(panel)) {
    menuItems.push(feedbackItem);
  }
}

function menuHasFeedbackItems(menuItems) {
  // Only look at the endpoints of the menu items themselves, not their
  // parameters (which may embed a full copy of the video item).
  return menuItems?.some((menuItem) =>
    !!findFeedbackToken(menuItem?.menuServiceItemRenderer?.serviceEndpoint)
      || !!findFeedbackToken(menuItem?.menuNavigationItemRenderer?.navigationEndpoint));
}

function feedbackMenuItems(panel) {
  return [
    MenuServiceItemRenderer(t('videoMenu.notInterested'), {
      clickTrackingParams: null,
      customAction: {
        action: 'NOT_INTERESTED',
        parameters: panel
      }
    }),
    MenuServiceItemRenderer(t('videoMenu.dontRecommendChannel'), {
      clickTrackingParams: null,
      customAction: {
        action: 'DONT_RECOMMEND_CHANNEL',
        parameters: panel
      }
    })
  ];
}

function hideVideo(items) {
  return items.filter(item => {
    if (!item.tileRenderer) return true;
    const progressBar = item?.tileRenderer ? item.tileRenderer.header?.tileHeaderRenderer?.thumbnailOverlays?.find(overlay => overlay.thumbnailOverlayResumePlaybackRenderer)?.thumbnailOverlayResumePlaybackRenderer
    : item.lockupViewModel?.contentImage?.thumbnailViewModel?.overlays?.find(overlay => overlay.thumbnailBottomOverlayViewModel?.progressBar)?.thumbnailBottomOverlayViewModel?.progressBar. thumbnailOverlayProgressBarViewModel;
    if (!progressBar) return true;
    const pages = configRead('hideWatchedVideosPages');
    if (!pages.length) return true;
    const hash = location.hash.substring(1);
    const pageName = hash === '/' ? 'home' : hash.startsWith('/search') ? 'search' : hash.split('?')[1]?.split('&')[0]?.split('=')[1]?.replace('FE', '')?.replace('topics_', '') ?? '';
    if (!pages.includes(pageName)) return true;

    const percentWatched = (progressBar?.percentDurationWatched ||
      progressBar?.startPercent || 0);
    return percentWatched <= configRead('hideWatchedVideosThreshold');
  });
}
