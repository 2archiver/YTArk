# YTArk 4.5.0 — Liquid Glass redesign

Status: implementation candidate; not a published release.

## Implemented in this branch

- Live Liquid Glass panel discovery rejects full-width overlay hosts and only themes measured, bounded side-panel renderers.
- Settings and dialog surfaces use a much more opaque glass base, with supported backdrop blur, to reduce the double-text effect caused by sharp content showing through the overlay.
- Glass uses inset edge highlights rather than borders. No padding, margins, width, height or box-sizing overrides are added, preserving the native component's geometry.
- Tab lists receive a shared glass surface; unselected tabs remain transparent and the selected tab receives a subtle highlight. Focus and layout properties are not changed.
- OLED Black + Liquid Glass uses near-black panel surfaces; opt-out restores original inline styles.
- Bounded player popup/side panels receive glass; video, artwork, captions, fullscreen stages and native player focus controls remain excluded.
- Regression coverage checks bounded versus fullscreen panel selection, media exclusion, style restoration, no layout-affecting declarations, tab treatment and managed-node stability.

## Remaining before publication

- Confirm the Settings overlay no longer produces visible double text on the target Google TV frontend.
- Review tab appearance and D-pad focus on the actual TV. Semantic role-based tab selectors may not cover every YouTube TV tab implementation.
- Validate bounded player popup menus and all other appearance surfaces on the actual player; transport buttons intentionally retain native focus styling.
- Run the complete Node, bundle, updater, ARMv7 package, signing and release metadata checks.
- Perform physical ARMv7 Google TV testing for exact geometry, D-pad focus, transitions, responsiveness and playback.

## Validation honesty

The source and regression coverage have been updated, but no current CI pass or physical Google TV test is claimed. Publication must wait for the candidate pipeline and device acceptance.