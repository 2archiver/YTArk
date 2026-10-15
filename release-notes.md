YTArk 3.4 — candidate, not published

Cleaner About and settings, permission-ready Updates, and clearer release checks.

- Release checks distinguish offline, timeout, HTTP, metadata and runtime failures with sanitized diagnostics.
- About and settings are cleaner; the row reads “YouTube Premium” and faster startup stays opt-in.
- Updates asks for install authorization on entry; denial leaves a manual action and never blocks checks.

The existing package identity, signing identity and TizenTubeCobalt v2.0.2 ARMv7 base remain unchanged. The s33 userscript endpoint becomes live only through the existing release publication workflow.

TV permission screens, startup speed, session-preserving upgrades and ARMv7 runtime remain unverified in this environment. A download does not continue across process death; a partial can resume only when its stored ETag still matches.

<!-- Package io.github.twoarchiver.ytark; 3.4.0; versionCode 3040000; base TizenTubeCobalt v2.0.2. -->
