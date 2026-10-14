# YTArk 3.2 presentation patch

## Scope

- Neutral YouTube dark native Updates controls, light/dark focus inversion,
  readable disabled styling, content-width buttons and stable view IDs.
- Focus falls back to an enabled control if a download/check changes the
  focused control's availability. Back from notes/frequency restores focus.
- Concise status avoids repeating the latest version. Existing error,
  cancellation, permission and installation guidance is preserved.
- About links to the existing Changelog / Version history picker. Current
  highlights use the maintained summary, not the full release description.
- `tools/build_changelog.py` generates the same bounded, plain-text summary
  field for JS and Kotlin. Unknown versions have a short fallback; full notes
  are explicit actions. The build's notes are available offline.
- Identity: 3.2.0 / 3020000 / s31. 3.1 publication metadata was verified via
  GitHub (2026-10-14 11:46 UTC). No invented publication date for 3.2.

The 3.1 repository/discovery, download, validation, install/permission,
scheduling, persisted-state and JNI bridge code is unchanged. No dependency
upgrades, package/signing changes, engine changes or extra launcher entry.

## Local validation

- 266 JavaScript tests passed; focused About/changelog rerun: 27 passed.
- Python suite: 196 tests, passed with one skipped (host JDK unavailable).
- Userscript Rollup build, JS syntax and 45-symbol bundle contract passed.
- Generated changelog/build metadata, workflow policy, shell syntax, repacker
  self-tests and whitespace checks passed.
- Added Kotlin presentation cases for up-to-date, newer release, unknown
  latest, download progress, error/permission guidance and concise summaries.
- Added native focus/disabled contrast assertions and static focus/state
  contracts. These are not a physical TV navigation test.

## Release workflow / remaining checks

The existing PR CI compiles all native Kotlin, runs JVM policy/presentation
assertions and D8, then exercises an unsigned ARMv7 repack and DEX/JNI checks.
The existing `build-apk.yml` can be dispatched on this branch to prepare the
signed `ytark-armv7-candidate` artifact without publishing (publication requires
main). Normal main-branch release publication remains unchanged.

Do not claim Android compilation, a signed APK, or device success from the local
checks above; consult the linked Actions run for build results. The APK's s31
remote userscript URL will not be live until the normal release publication.

Still requires physical ARMv7 TV verification: D-pad Up/Down/OK/Back through
all controls and dialogs at 720p/1080p; text wrapping/font scaling and contrast;
no-update/download-disabled and update-available states; progress/cancel focus;
About -> history -> full notes -> Back; unknown-sources permission return,
installer cancellation, installation and session-preserving 3.1 -> 3.2 upgrade.
