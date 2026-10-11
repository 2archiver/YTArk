// Enable features that aren't enabled by default due to YT seeing the TV as a low-end device
import { configRead, configChangeEmitter } from '../config.js';

const MAX_WAIT_ATTEMPTS = 120;
let waitTimer = null;

// Only the previews switch is handled here. Reacting to every settings change
// rescanned the frontend's whole module registry each time.
configChangeEmitter.addEventListener('configChange', (event) => {
    if (event && event.detail && event.detail.key === 'enablePreviews') enableFeatures();
});

function enableFeatures(attempt = 0) {
    if (!window._yttv) {
        // Bounded wait for the frontend; never more than one pending retry.
        if (waitTimer === null && attempt < MAX_WAIT_ATTEMPTS) {
            waitTimer = setTimeout(() => {
                waitTimer = null;
                enableFeatures(attempt + 1);
            }, 250);
        }
        return;
    }
    const yttvValues = Object.values(window._yttv);

    // Enable preview mode
    yttvValues.find(a => a instanceof Map && a.has("ENABLE_PREVIEWS_WITH_SOUND"))?.set("ENABLE_PREVIEWS_WITH_SOUND", configRead('enablePreviews'));
}

if (document.readyState === 'complete') {
    enableFeatures();
} else window.addEventListener('load', () => enableFeatures());
