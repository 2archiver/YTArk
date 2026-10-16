# YTArk notices and provenance

YTArk is built on the Android/Cobalt application from
[TizenTubeCobalt](https://github.com/reisxd/TizenTubeCobalt). Cobalt and Chromium
components include Apache-2.0 and BSD-style licensed code; consult upstream
notices and license files for their respective terms.

The userscript source under `TizenTube/` is based on the
[TizenTube](https://github.com/reisxd/TizenTube) project and is licensed under
GPL-3.0-only. The full corresponding source and local modifications are included
in this repository. Each release attaches its exact userscript bundle and
checksums.

## Cosmetic header wordmark

The optional cosmetic header wordmark renders "YouTube Premium logo 2024.svg"
from Wikimedia Commons
(https://commons.wikimedia.org/wiki/File:YouTube_Premium_logo_2024.svg, author
Google, Inc., retrieved 2026-10-11, revision SHA-1
`9ec3ad62f293d10e98cb637d0303a7e7e4188947`, bundled sanitized SHA-256
`e2ba301c01340c2cc0163447a388d9f578c7ae1e8b434c1ebcfe8ad263c00ecf`). The file is
public domain on Commons (`{{PD-simple}}` / `{{PD-text}}`: simple geometry and
non-copyrightable lettering) and originates from Logopedia
(`Ringo2_premium.svg`). Trademark rights remain with Google LLC: YouTube and
YouTube Premium are trademarks of Google LLC, the mark is drawn locally as a
cosmetic header preference, it grants no entitlement, and YTArk is not
affiliated with, endorsed by, or sponsored by Google or YouTube. The vector
geometry is bundled inside the release userscript; no device requests it from
Wikimedia or from any other external image host, and no runtime asset request is
made for it.

## Compiled-manifest test fixtures

`tools/tests/data/axml/*.xml` and `tools/tests/data/apk/AndroidManifest_ShortName.apk`
are unmodified compiled-manifest test data from
[androguard](https://github.com/androguard/androguard) (Apache-2.0; consult that
project's LICENSE). They let the test suite check `tools/apk_manifest.py`
against binary Android XML that a real build tool produced, instead of only
against documents YTArk encoded itself. They contain no YTArk code, no user
data and no telemetry, and the suite only reads them.

YTArk is not affiliated with YouTube, Google, TizenTube, or TizenTubeCobalt.
