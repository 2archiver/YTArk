# YTArk 4.5.0 — Liquid Glass redesign

Status: implementation candidate; not a published release.

## Implemented in this branch

- Live Liquid Glass panel discovery now rejects full-width overlay hosts and only themes measured, bounded side-panel renderers.
- Decorative glass edges use inset box shadows instead of borders. The theme no longer changes `box-sizing` or consumes layout pixels, preserving the native component's measured footprint.
- Clone restoration accepts the new managed `box-shadow` property, so navigation clones can still restore their original inline styles.
- Static CSS no longer paints the generic overlay-panel content renderer, which could span the fullscreen host.
- Host regression coverage checks that glass adds no border width or box-sizing override.

## Remaining 4.5 work

- Reproduce and fix the reported YTArk Settings double-text/stacked-layer issue against a captured Google TV DOM. Do not conceal text or disable the native settings renderer as a workaround.
- Finish the connected tab/navigation treatment while preserving the exact original width, height, inset, padding and focus geometry of every native surface.
- Extend glass selectively to player controls and playback menus only after identifying their exact renderer nodes; never blur or paint the video, thumbnails, artwork, captions or fullscreen stage.
- Tune OLED Black + Liquid Glass together for legible focus, contrast and non-flat black surfaces.
- Add captured-DOM browser coverage and run the complete Node/build/release metadata checks.
- Verify on the target ARMv7 Google TV device for sizing, D-pad focus, text duplication, transitions, responsiveness and playback.

## Validation honesty

The changes above are source-level implementation only. No CI run or physical Google TV test is claimed by this document. The candidate must not be published until generated changelog metadata, bundle contracts, tests, Android packaging and device acceptance are complete.
