// The native Android updater is responsible for release discovery, checksum
// and certificate verification, downloads, and Android's installer flow. This
// module only opens its TV-remote-friendly controls from the settings screen.

import { showToast } from '../ui/ytUI.js';

export default function openYtArkUpdates() {
    if (!window.h5vcc || !window.h5vcc.tizentube) {
        showToast('YTArk Updates', 'Update controls are available in the YTArk Android app.');
        return;
    }

    // Cobalt delegates registered external schemes to Android. The manifest
    // maps this private scheme to YTArk's native update activity.
    const link = document.createElement('a');
    link.href = 'ytark://updates';
    link.tabIndex = -1;
    link.setAttribute('aria-hidden', 'true');
    link.style.position = 'absolute';
    link.style.left = '-10000px';
    document.body.appendChild(link);
    try {
        link.click();
    } catch (error) {
        console.warn('Could not open YTArk update controls:', error);
        showToast('YTArk Updates', 'Open the YTArk update notification to check again.');
    }
    setTimeout(() => link.parentNode && link.parentNode.removeChild(link), 1000);
}
