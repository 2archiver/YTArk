function parseTimestamps(input) {
  if (typeof input !== 'string') return [];
  const result = [];
  const timestampRegex = /^\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\s+(.+)$/;

  for (const line of input.split('\n')) {
    const match = line.match(timestampRegex);
    if (!match) continue;
    const hours = Number(match[1] || 0);
    const minutes = Number(match[2] || 0);
    const seconds = Number(match[3] || 0);
    const fraction = Number((match[4] || '').padEnd(3, '0'));
    const name = String(match[5] || '').trim();
    if (!name) continue;
    result.push({
      time: ((hours * 60 + minutes) * 60 + seconds) * 1000 + fraction,
      name,
    });
  }
  return result;
}

function marker(title, start, duration, videoID, index) {
  return {
    title: { simpleText: title },
    startMillis: String(start),
    durationMillis: String(duration),
    thumbnailDetails: {
      thumbnails: [{
        url: `https://i.ytimg.com/vi/${encodeURIComponent(videoID)}/hqdefault.jpg`,
        width: 320,
        height: 180,
      }],
    },
    onActive: {
      innertubeCommand: {
        clickTrackingParams: null,
        entityUpdateCommand: {
          entityBatchUpdate: {
            mutations: [{
              entityKey: `${videoID}${start}${duration}`,
              type: 'ENTITY_MUTATION_TYPE_REPLACE',
              payload: {
                markersEngagementPanelSyncEntity: {
                  key: `${videoID}${start}${duration}`,
                  panelId: 'engagement-panel-macro-markers-description-chapters',
                  activeItemIndex: index,
                  syncEnabled: true,
                },
              },
            }],
          },
        },
      },
    },
  };
}

function markerEntity(videoID, markers) {
  return {
    entityKey: `${videoID}-key`,
    type: 'ENTITY_MUTATION_TYPE_REPLACE',
    payload: {
      macroMarkersListEntity: {
        key: `${videoID}-key`,
        externalVideoId: videoID,
        markersList: {
          markerType: 'MARKER_TYPE_CHAPTERS',
          markers,
          headerTitle: { runs: [{ text: 'Chapters' }] },
          onTap: {
            innertubeCommand: {
              clickTrackingParams: null,
              changeEngagementPanelVisibilityAction: {
                targetId: 'engagement-panel-macro-markers-description-chapters',
                visibility: 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED',
              },
            },
          },
          markersEdu: {
            enterNudgeText: { runs: [{ text: 'To view chapters, press the up arrow button' }] },
            enterNudgeA11yText: 'To view chapters, press the up arrow button',
            navNudgeText: { runs: [{ text: 'Navigate between chapters' }] },
            navNudgeA11yText: 'Press the left or right arrow button to navigate between chapters',
          },
          loggingDirectives: { trackingParams: null, enableDisplayloggerExperiment: true },
        },
      },
    },
  };
}

export default function Chapters(video) {
  const metadata = video?.contents?.singleColumnWatchNextResults?.results?.results
    ?.contents?.[0]?.itemSectionRenderer?.contents?.[0]?.videoMetadataRenderer;
  const videoID = metadata?.videoId;
  const description = metadata?.description;
  const descriptionText = typeof description?.simpleText === 'string'
    ? description.simpleText
    : Array.isArray(description?.runs)
      ? description.runs.map(run => run && run.text || '').join('') : '';
  if (!videoID || !descriptionText) return null;

  const chapters = parseTimestamps(descriptionText);
  if (chapters.length < 2) return null;
  let duration = Number(document.querySelector('video')?.duration) * 1000;
  if (!Number.isFinite(duration) || duration <= 0) {
    duration = chapters[chapters.length - 1].time;
  }

  const markers = chapters.map((chapter, index) => {
    const next = chapters[index + 1];
    const markerDuration = next ? next.time - chapter.time : duration - chapter.time;
    return marker(chapter.name, chapter.time, Math.max(0, markerDuration), videoID, index);
  });
  return markerEntity(videoID, markers);
}

export { parseTimestamps };
