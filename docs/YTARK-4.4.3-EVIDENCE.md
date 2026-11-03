# YTArk 4.4.3 validation

Device feedback confirms 4.4.2 themes are visible but reports patchy menu
headers, a lighter left edge, an awkward sidebar and slower/buggier playback
with both themes enabled. Existing high-quality playback was reported working.

## Changes and evidence

- The inline OLED fallback clears background images as well as setting black.
  A regression test verifies native gradients restore when the setting is off.
- Semantic panel hosts may fill the viewport. The controller instead finds a
  bounded side panel around the semantic header; the fullscreen host is excluded.
  Headers remain transparent and native focus styling is preserved.
- Glass uses a clearer static tint on the guide and full-height panels. Blur is
  limited to small browsing surfaces and disabled in watch/shorts mode.
- Theme observers no longer monitor descendant class changes. The body route
  observer repaints only on a transition into or out of playback mode.
- Real-browser fixture checks confirm a transparent fullscreen host, a transparent
  header over a themed side panel, native focus contrast, no guide blur, no blur
  during playback, zero theme style writes across 100 focus/body-class changes,
  bounded cloned-surface tracking and full restoration on opt-out.
- The legacy browser appearance matrix and caption timer regression pass.
- Stream selection, codecs, buffering and quality notifications are unchanged.

## Validation

446 JavaScript tests pass. 279 Python tests pass with one skipped. Production
bundle generation, all 55 required bundle symbols, metadata/changelog checks,
workflow policy, the secret scan and whitespace checks pass.

## Limits

The browser layout is a regression fixture, not a fresh live frontend or physical
TV run. The original 4.4.2 device screenshots motivate these targeted changes;
physical Google TV timing, remaining left-edge shading and the clearer visual
result need confirmation. No measured device speedup or exact reproduction of
Apple's proprietary Liquid Glass renderer is claimed.
