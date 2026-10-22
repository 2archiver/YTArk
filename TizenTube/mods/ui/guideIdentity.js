// Shared identity for guide settings, learning, ordering and hiding.
// Never infer an endpoint from a translated title, icon, or list position.
export function guideEntryIdentity(item) {
    const endpoint = item?.guideEntryRenderer?.navigationEndpoint;
    if (!endpoint || typeof endpoint !== 'object') return null;
    const browseId = endpoint.browseEndpoint?.browseId;
    // Preserve existing browse IDs, including distinct UC... channel IDs.
    if (typeof browseId === 'string' && browseId.length) return browseId;
    if (endpoint.searchEndpoint && typeof endpoint.searchEndpoint === 'object') return 'search';
    // Captured guest TVHTML5 guide, 2026-10-22: seedless Shorts pivot.
    // A generic reelWatchEndpoint alone does not establish a guide identity.
    const reel = endpoint.reelWatchEndpoint;
    if (reel?.watchEndpointSource === 'REEL_WATCH_ENDPOINT_SOURCE_SHORTS_PIVOT_BAR'
        || reel?.overlay?.reelPlayerOverlayRenderer?.style === 'REEL_PLAYER_OVERLAY_STYLE_SHORTS') return 'FEshorts';
    // Exact route evidence only. Arbitrary watch/reel commands are not Search.
    const url = endpoint.commandMetadata?.webCommandMetadata?.url;
    if (typeof url === 'string' && /^\/shorts(?:[/?#]|$)/.test(url)) return 'FEshorts';
    if (typeof url === 'string' && /^\/results(?:[?#]|$)/.test(url)) return 'search';
    return null;
}

export function guideOrderIdentity(value) {
    const id = typeof value === 'string' ? value : value?.browseId;
    return typeof id === 'string' && id.length ? id : null;
}

export function guideSections(response) {
    if (!Array.isArray(response?.items)) return [];
    return response.items.map(item => item?.guideSectionRenderer)
        .filter(section => section && Array.isArray(section.items));
}

// Restore the unfiltered snapshot on repeated loads before applying changes.
// Endpoint objects are retained intact, including tracking and command payloads.
export function arrangeGuideSection(section, order, hidden) {
    const source = (Array.isArray(section.originalItems) ? section.originalItems : section.items)
        .filter(item => !item?.__ytarkGuideEntry);
    const ranks = new Map();
    for (const value of order) {
        const id = guideOrderIdentity(value);
        if (id && !ranks.has(id)) ranks.set(id, ranks.size);
    }
    const sorted = source.map((item, index) => ({ item, index }))
        .sort((a, b) => {
            const ar = ranks.get(guideEntryIdentity(a.item));
            const br = ranks.get(guideEntryIdentity(b.item));
            return (ar ?? ranks.size) - (br ?? ranks.size) || a.index - b.index;
        }).map(entry => entry.item);
    section.originalItems = sorted.slice();
    const disabled = new Set(hidden);
    section.items = sorted.filter(item => {
        const id = guideEntryIdentity(item);
        return !id || !disabled.has(id);
    });
}
