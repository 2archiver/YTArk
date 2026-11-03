# YTArk 4.4 candidate evidence

Scope: 4.4.0 / 4040000 / s45 on the unchanged TizenTubeCobalt v2.0.3 ARMv7 base.

## Implemented behaviour

- Playback → Subtitles: opt-in caption fallback, preferred audio language and fallback caption language. No captions are changed if audio languages or current caption state are unknown. Only existing matching tracks are selected; a manually selected/off caption or audio command takes priority for that video. Does not synthesize captions or change the audio track.
- Playback → Video player: a default-on quality notification using the native YouTube TV toast. Reads decoded video dimensions after playback is ready, coalesces changes for 1.2 seconds and spaces notifications by at least eight seconds within a video. No persistent HUD or focus interception.
- Appearance: new default-off OLED Black and Liquid Glass toggles. The old `uiTheme` remains retired; existing users are not silently re-themed. Solid surfaces use black; glass uses a scoped translucent treatment with a CSS capability fallback and reduced-transparency/reduced-motion support.
- Faster startup: removes the Experimental label, excludes optional guide work from the critical pass, and delays its first deferred attempt by 150 ms. Normal mode retains its existing path and fallback timing.
- Diagnostics: controls mounting and interactive readiness are distinct browser intervals. The latter includes resolver readiness and startup navigation. Wake-up/probe counts are bounded. Local comparison needs at least three valid samples per mode, matches build, userscript, base, startup destination and reload preference, and excludes partial/interrupted/fallback captures. Median/p95 are observations, not proof of an Android startup speedup.

## Executed local validation

- `node --test tests/*.test.mjs` from `TizenTube/mods`: 442 passed, zero failures.
- `python3 -m unittest discover -s tools/tests -v`: 279 tests, OK; three existing environment-dependent checks skipped.
- `npm run build` and `node --check ../dist/userScript.js`: passed. The built bundle passed the shared contract (52 required/forbidden symbol checks).
- Generated build metadata and JS/Kotlin changelog validation: passed.
- Workflow policy, source-image launcher art, Premium vector provenance, APK repacker self-tests, shell syntax, worktree secret scan and `git diff --check`: passed.
- `tools/check_appearance_browser.mjs` in real headless Chromium: passed for default/OLED/glass/combined states, preserved media backgrounds/artwork/caption colour, readable focus, and reduced-motion glass fallback. Screenshots were rendered and the combined state visually inspected. These are representative HTML/CSS fixtures, not live TV screenshots or proof of frontend selector coverage.

Reproduce the optional browser check using installed Playwright and Chromium. `PLAYWRIGHT_MODULE_PATH` can point to Playwright's `index.mjs`; `PLAYWRIGHT_EXECUTABLE` can select an existing Chromium executable. Screenshots go to ignored `work/appearance-browser/`.

## Device and package work still required

No Android/ADB target is attached. Physical Google TV validation is NOT RUN. In particular: confirm available audio/caption APIs, manual caption priority, no quality notifications during ads, full theme coverage on Home/search/account/settings/player, Liquid Glass performance, and D-pad focus. Record alternating normal/Faster launches locally; the screenshot supplied by the user reports Android 14, 3.78 GB RAM and 24.46 GB storage but does not establish model, CPU or supported APK ABIs.

The repository's candidate CI builds and signs the APK on a same-repository pull request, without publishing a stable release. Android compilation, packaged-manifest/DEX checks and candidate signing must be evaluated from that run; source/fixture tests are not APK or device tests.
