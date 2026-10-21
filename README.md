<h1 align="center">YTArk</h1>

<p align="center"><strong>YouTube TV, enhanced for Android TV &amp; Google TV.</strong></p>

<p align="center">
  <a href="https://ko-fi.com/2archiver"><strong>☕ Support YTArk on Ko-fi</strong></a>
</p>

<p align="center">
  <a href="https://github.com/2archiver/YTArk/releases/latest"><strong>Download the latest published release</strong></a>
  &nbsp; · &nbsp;
  <a href="https://github.com/2archiver/YTArk/releases">All releases</a>
  &nbsp; · &nbsp;
  <a href="https://github.com/2archiver/YTArk/issues/new">Report a bug</a>
</p>

<p align="center">
  <a href="https://github.com/2archiver/YTArk/actions/workflows/ci.yml">
    <img src="https://github.com/2archiver/YTArk/actions/workflows/ci.yml/badge.svg?branch=main" alt="YTArk continuous integration status">
  </a>
  &nbsp; · &nbsp;
  <a href="https://github.com/2archiver/YTArk"><strong>Star YTArk on GitHub</strong></a>
</p>

<p align="center"><sub>3.7 documentation refresh · Download links list published builds only.</sub></p>

YTArk brings the familiar YouTube TV interface to compatible Android TV and Google TV devices, with a remote-friendly settings layer and an Android-native updater. It builds on the TizenTubeCobalt foundation and maintains selected TizenTube userscript features.

## Why YTArk?

YTArk keeps the television-style YouTube experience instead of replacing it with a mobile layout. The project adds Android packaging, TV-oriented controls, customization and update management around the upstream Cobalt-based app.

## Features

### TizenTube capabilities maintained in YTArk

These features originate in the upstream TizenTube userscript; YTArk maintains and adapts them rather than claiming to have created the integrations.

- **Client-side ad filtering** in the YouTube TV frontend. It cannot guarantee that every advertisement is removed.
- **SponsorBlock** skips supported community-submitted segments when enabled and when the service has matching data.
- **DeArrow** can use community title alternatives; thumbnail replacements are a separate opt-in setting.
- **Playback controls** include preferred video quality, speed and codec options, plus a video queue.
- **Navigation options** include sidebar customization and a guide entry for direct Settings access. Shorts remain available through YouTube's normal navigation. "Disable channels on sidebar" was removed in 4.0: it hid every entry with a thumbnail instead of controlling individual channels, so the normal guide returns and a stale stored value is dropped at migration.

### YTArk additions

- **Remote-friendly Settings** for playback, appearance, privacy, navigation and app information.
- **Appearance options**, including OLED Black and supported player/interface adjustments. Cosmetic Premium branding does not provide a subscription or paid YouTube features.
- **Android-native updater** for official stable GitHub releases. It validates the update package before handing installation to Android; the operating system still controls authorization and confirmation.
- **Optional browser diagnostics** for local startup and playback summaries. Collection is off by default; recorded samples stay on the device.

No Return YouTube Dislike integration is present in the current source tree, so it is not advertised as a YTArk feature.

## Download and installation

Use the [latest published release](https://github.com/2archiver/YTArk/releases/latest) or browse [all releases](https://github.com/2archiver/YTArk/releases). The 3.7 documentation refresh does not itself publish a build.

YTArk publishes a **32-bit ARM (`armeabi-v7a`) APK only**. There is no `arm64-v8a` APK. A 64-bit processor alone does not establish that the device's Android system can install 32-bit apps; an arm64-only system is not compatible with this package. 4K capability does not change APK architecture.

1. Download the `YTArk-v<version>-armeabi-v7a.apk` asset from the official release page. From 3.8.0 the attached asset uses the full ABI name; releases up to 3.7.x used the shorter `YTArk-v<version>-armv7.apk` name. Each release attaches exactly one APK.
2. Transfer it to the TV if needed and open it with a compatible file manager or installer.
3. If Android blocks installation, follow its prompts to grant install permission to the app that opened the APK, if your device exposes that setting. Some TV firmware may not provide a working settings route.
4. Return to the installer, review Android's package-installer prompt, and confirm the installation yourself.

For an existing installation, use YTArk Updates or install a compatible, properly signed newer APK **over** the existing app. The package identity and signing lineage are maintained for in-place updates, but Android firmware and device behavior vary. Do not uninstall just to troubleshoot: uninstalling can erase app-local settings and YouTube session data.

## Settings and updating

Open YTArk Settings from the app's settings entry or the YTArk row in the TV guide. About keeps release history, technical details, credits and project access in separate, navigable pages; the full [changelog](CHANGELOG.md) remains available.

The native updater checks stable releases from GitHub and distinguishes a current installation, a newer release, an installed build ahead of the latest stable version, and check or asset failures. A current result can be checked again; it does not start a download. Android's per-app install authorization is shown and rechecked after returning from Android Settings, but the updater cannot bypass the operating system or promise that every TV exposes a working permission route.

The updater downloads into YTArk's own private files directory (`files/ytark-updates-v31`) and needs no storage or "all files" permission. Its readiness probe is a plain create/write/close; it no longer fsyncs a temp file or treats a failed probe cleanup as a storage failure, which were the fragile steps behind the 3.9 "local update storage is unavailable" report. The technical-details panel now names the failing operation (for example `mkdirs` or `write-probe`) and keeps a typed storage cause, so a denied write cannot be described as a full disk. "Not enough storage" is shown only when a reported capacity or a real out-of-space error proves it. A partial download is reused only when its stored ETag, size and hash still match the candidate.

**Startup initialization is staged.** YTArk waits for its own controls, command resolver and navigation in that order, then performs optional work such as the guide refresh. The optional refresh no longer decides when the controls are ready. A cold start that already sits on Home skips the extra Home soft reload; an explicit launch destination and a restored non-Home route keep their normal behaviour.

**Faster startup is experimental and opt-in.** It changes only YTArk's own optional hand-off: the guide refresh is dispatched after the controls are ready instead of holding the critical path, and dependency discovery is probed sooner and shared. It does not skip or accelerate YouTube's engine, splash, session restore or playback. Browser diagnostics measure only a narrow userscript/UI-bootstrap interval, not Android app start, playback readiness or first frame, and a completed startup stays measurable after a long playback session. Local comparisons require at least three complete, comparable launches per actual mode; five alternating matched pairs are recommended. No performance benefit is promised.

## Privacy and security

Read the full [privacy disclosure](docs/PRIVACY.md). YTArk has no project-operated analytics or account service; YouTube still receives its normal app traffic, and selected integrations contact their own services. The disclosure lists what those services receive—for example, DeArrow thumbnail requests include a video ID only when that separate option is enabled.

Browser startup/playback diagnostics are **opt-in, local and bounded** (up to 20 retained sessions). They are not uploaded. The native updater's diagnostics are a separate Android-side report. Project provenance and license notices are in [NOTICE.md](NOTICE.md).

## FAQ and troubleshooting

### Will the APK install on a 64-bit TV?

Only if the device's Android system supports 32-bit `armeabi-v7a` apps. YTArk does not currently publish an arm64 APK. Check the device's supported app architectures; CPU bitness by itself is not enough.

### Why does Android ask for install permission?

Android requires the user to authorize package installation for the app that requests it, and the package installer asks for confirmation separately. YTArk reports the state it can read and rechecks after a Settings detour; it cannot repair every vendor-specific permission screen. Update checks and release notes remain available when installation authorization is unavailable.

### An update check failed. Should I reinstall?

No. Check the network connection and try **Check again** later, or use the official [Releases page](https://github.com/2archiver/YTArk/releases). A failed check does not establish that the installed app is broken. Do not uninstall or clear app data as a routine update fix.

### Will an in-place update preserve my account and settings?

A compatible update over the existing package is intended to keep app data; uninstalling may remove it. Package and signing continuity are maintained, but device-specific upgrade and session behavior are not guaranteed by host tests. Never share passwords, cookies or tokens in an issue report.

## Development and contributions

The repository contains the [TizenTube userscript source](TizenTube/), [Android updater](android-updater/), [build and validation tools](tools/) and [project notices](NOTICE.md). The [CI workflow](.github/workflows/ci.yml) runs automated checks; a passing host build is not proof of behavior on every physical TV.

Please [report a bug](https://github.com/2archiver/YTArk/issues/new) with the device model, Android version, YTArk version and reproducible steps. You can also browse [open issues](https://github.com/2archiver/YTArk/issues) or submit a [pull request](https://github.com/2archiver/YTArk/pulls). Remove account identifiers, credentials, cookies and tokens from logs before sharing them.

## Credits and acknowledgements

YTArk builds on the [TizenTubeCobalt](https://github.com/reisxd/TizenTubeCobalt) Android/Cobalt application and the [TizenTube](https://github.com/reisxd/TizenTube) userscript. Relevant integrations include [SponsorBlock](https://github.com/ajayyy/SponsorBlock) and [DeArrow](https://github.com/ajayyy/DeArrow). See [NOTICE.md](NOTICE.md) for project provenance and license notices.

## Support YTArk

If YTArk is useful to you, you can [support its development on Ko-fi](https://ko-fi.com/2archiver). Support is optional and does not unlock YouTube Premium or other paid features.

## Disclaimer

YTArk is an independent, unofficial project. It is not affiliated with, endorsed by or sponsored by Google or YouTube. YouTube and related marks belong to their respective owners; upstream projects and third-party services retain their own terms and licenses.
