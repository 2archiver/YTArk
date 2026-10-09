# YTArk branding — Alternative 2

This directory holds the YTArk launcher artwork: the selected **Alternative 2**
design — a light/white rounded-square tile, a red video play emblem, and a red
orbital swoosh that tucks behind the emblem at its upper-left and crosses in
front at the lower-right with a white keyline.

## Source of truth

`tools/render_launcher_art.py` is the single geometry source for the whole
artwork set. It deterministically emits every shipped asset:

| Artifact | Purpose |
|---|---|
| `branding/ytark-launcher.svg` | Master vector of the launcher mark |
| `branding/ytark-launcher-512.png` | Square raster preview of the mark |
| `android-updater/ytark_launcher_fg.xml` | Adaptive-icon foreground (mark) |
| `android-updater/ytark_launcher_bg.xml` | Adaptive-icon background (white tile) |
| `android-updater/mipmap-anydpi-v26/ytark_launcher.xml` | Adaptive icon (API 26+) |
| `android-updater/mipmap-*/ytark_launcher.png` | Legacy mipmap variants (48–192 px) |
| `android-updater/ytark_banner.xml` | Android TV banner (320×180) |

Regenerate with `python3 tools/render_launcher_art.py --write`; CI runs
`--check` to prove the committed assets match the geometry source byte for
byte. The artwork is deliberately free of any concept-poster text, patch
notes, or watermarks.

## Distinctness and rights notes

- The mark is intentionally **distinct from YouTube branding**: the emblem is
  red-on-white (not white-on-red), sits on a light rounded-square tile, and is
  wrapped by an orbital swoosh that no YouTube mark uses. The tile, swoosh and
  the **YTArk** name are the product identity.
- The icon contains **no Google or YouTube wordmarks, logos, or names**. The
  TV banner lettering spells `YTArk` only.
- A generic rounded rectangle with a play triangle is a widely used video
  motif; YTArk's combination (white tile + red emblem + orbital swoosh +
  YTArk name) is its own presentation. YTArk is an independent, unofficial
  project and must never claim endorsement by or affiliation with YouTube or
  Google (see the README disclaimer).
- Do not add YouTube/Google trademarks to YTArk artwork, release names,
  update notifications, or store listings. Keep the `YTArk` label exactly —
  never a variant such as “YTArk Solo”.
