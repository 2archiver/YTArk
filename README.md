# YTArk

YTArk

An enhanced YouTube experience for Android TV and Google TV.

YTArk is an independent, open-source YouTube TV client built upon TizenTubeCobalt. It combines the familiar YouTube television interface with additional playback controls, customization options, privacy features, and Android-native update management.

Designed for remote-controlled devices, YTArk aims to preserve the simplicity of the original YouTube TV experience while providing greater control over how the application looks and behaves.



⸻

Overview

YTArk extends the TizenTubeCobalt platform with Android-focused application packaging, dedicated settings, interface enhancements, and update functionality.

Rather than replacing YouTube’s television interface with a mobile layout, YTArk retains the Cobalt-based frontend and its native television navigation model.

The project focuses on four principles:

* Familiarity: Preserve the recognizable YouTube TV interface and existing navigation behavior.
* Customization: Give users additional control over playback, appearance, and interface preferences.
* Accessibility: Make enhanced YouTube functionality straightforward to install and use on supported Android TV devices.
* Maintainability: Improve reliability, simplify settings, and provide a consistent release and update process.

Features

Playback and Content Enhancements

Feature	Description
Ad Blocking	Client-side filtering designed to reduce advertising during playback.
SponsorBlock	Integration with community-submitted timestamps to skip supported sponsored and promotional segments.
DeArrow	Alternative video titles and thumbnails where supported by the integration.
Return YouTube Dislike	Restores estimated dislike information through a community-supported service.
Playback Quality	Additional controls for selecting supported video quality levels.
Player Customization	Options for modifying supported playback interface elements.

These integrations rely on external services and upstream compatibility. Their availability and effectiveness can vary.

Interface and Appearance

YTArk extends the standard YouTube TV experience with additional interface controls while maintaining remote-friendly navigation.

Customization includes:

* Dedicated YTArk Settings.
* Appearance and theme preferences.
* Optional cosmetic YouTube Premium branding.
* Player interface customization.
* Organized settings categories.
* Integration with the existing YouTube TV navigation experience.

Cosmetic Premium branding is a visual preference only. It does not provide a YouTube Premium subscription or unlock paid account benefits.

YTArk Settings

YTArk provides its own settings interface for managing application-specific functionality without replacing the standard YouTube settings experience.

Settings are organized around playback, appearance, privacy, navigation, application information, and updates.

The interface is designed for television remotes, with an emphasis on predictable focus behavior, clear labels, and minimal unnecessary navigation.

Update Management

YTArk includes an Android-native update system designed to simplify the process of obtaining and installing new releases.

The update architecture supports:

* Checking official GitHub Releases.
* Identifying newer compatible versions.
* Downloading supported APK updates.
* Update-check preferences.
* Download and package validation.
* Android installation-permission handling.
* User-confirmed installation through the Android package installer.

Android remains responsible for approving application installation. YTArk does not bypass operating-system security prompts.

Updater reliability and individual interface capabilities may vary by release. Consult the relevant release notes for the latest implementation status.

Performance and Reliability

YTArk development also focuses on application responsiveness and stability.

Key priorities include reducing unnecessary startup overhead, maintaining smooth remote navigation, improving settings consistency, and minimizing regressions introduced by upstream changes.

Performance improvements are evaluated against compatibility and reliability rather than presented as guaranteed speed increases.

⸻

Download and Installation

The official GitHub Releases page is the primary distribution source for YTArk.

View Available Releases

Requirements

* A compatible Android TV, Google TV, or Android-based streaming device.
* A supported CPU architecture.
* Permission to install APK files from the selected installation source.
* An internet connection for YouTube playback and online integrations.

YTArk’s release APK (`YTArk-v<version>-armv7.apk`) is a 32-bit armeabi-v7a build, repacked from the 32-bit `cobalt-arm.apk` base of TizenTubeCobalt v2.0.2. It is not an arm64 build, and YTArk does not claim arm64 support. A device with a 64-bit processor is not necessarily incompatible, but its Android environment must be able to install 32-bit armeabi-v7a APKs. Whether a particular TV does so is a device question; device installation is not verified by this repository.

Installation

1. Open the official YTArk GitHub Releases page.
2. Download the latest published APK compatible with your device.
3. Transfer the APK to your television or streaming device if necessary.
4. Open the APK using a compatible file manager.
5. Approve Android’s installation permission request when prompted.
6. Complete installation and launch YTArk.

For an existing installation, use the supported update workflow or install a compatible, properly signed newer APK over the existing application.

Uninstalling an application may remove its stored settings and sign-in data. Avoid uninstalling solely to troubleshoot an update unless necessary.

⸻

How YTArk Works

YTArk is based on TizenTubeCobalt, which provides the underlying Cobalt-based YouTube TV application environment.

YTArk builds on this foundation with project-specific modifications, Android packaging, native components, and additional user-facing functionality.

The architecture can be understood in three layers:

YouTube TV Frontend

Provides the familiar browsing, search, account, and playback experience.

TizenTubeCobalt Foundation

Supplies the upstream application environment and core modifications used by the project.

YTArk Enhancements

Adds application-specific settings, customization, packaging, update management, and integration improvements.

This approach allows YTArk to concentrate on the Android TV user experience without unnecessarily rebuilding the entire YouTube frontend.

Compatibility and Limitations

YTArk is an independent modification project. Compatibility depends on the underlying Cobalt environment, Android firmware, device architecture, and changes made by YouTube.

Not every feature is available on every device or release.

In particular:

* Video resolution depends on available streams, hardware, and codec support.
* Ad blocking cannot guarantee removal of every advertisement.
* SponsorBlock and DeArrow depend on their respective services and available data.
* Update installation requires Android approval.
* Experimental features may be modified, removed, or temporarily unavailable.

YTArk does not claim to provide paid YouTube subscriptions, system-wide ad blocking, or unsupported YouTube account entitlements.

Privacy

YTArk is designed to retain the upstream YouTube TV account and authentication experience rather than introduce a separate account system.

The project does not require users to provide Google credentials directly to YTArk’s developer.

Additional integrations may communicate with external services for segment information, alternative metadata, update discovery, and application resources.

YTArk should not be considered an anonymity tool. YouTube and other external services retain their own privacy practices.

For additional technical information, see the repository’s Privacy Documentation.

Development

YTArk is an actively evolving open-source project.

Development is focused on improving the existing application rather than introducing unnecessary complexity.

Current areas of ongoing work include:

* Application startup and responsiveness.
* Native updater reliability.
* Interface consistency and settings organization.
* Remote-control navigation.
* Playback integration compatibility.
* Android packaging and release validation.
* Regression testing and maintenance.

Changes are developed and validated through the repository’s source code and build workflows. Successful automated checks do not automatically establish compatibility with every physical device.

Source Code

The source code, build scripts, configuration, and project documentation are available in the official repository.

Explore the YTArk Source Code

Release History

Published changes and downloadable builds are available through GitHub Releases.

For detailed development history, refer to the project’s changelog rather than relying on historical README descriptions.

View Releases | View Changelog

Issues and Contributions

Bug reports, compatibility feedback, and constructive contributions are welcome.

Before reporting an issue, check whether it has already been documented.

Useful bug reports should include:

* Device manufacturer and model.
* Android or Google TV version.
* Installed YTArk release.
* Description of the problem.
* Steps required to reproduce it.
* Relevant screenshots or logs, where available.

Never include account credentials, authentication tokens, or other sensitive information in public reports.

Open an Issue

Acknowledgements

YTArk builds upon work from the open-source YouTube TV community.

Particular acknowledgement goes to:

* TizenTubeCobalt — the upstream application foundation.
* SponsorBlock — community-driven segment skipping.
* DeArrow — community-driven title and thumbnail alternatives.
* Return YouTube Dislike — estimated dislike information.

YTArk is an independent project and is not an official continuation or replacement for these upstream projects.

Support YTArk

YTArk is independently maintained and distributed as an open-source project.

If you find the project useful and would like to support its continued development, you can contribute through Ko-fi.

Support Development on Ko-fi

Support is optional and does not provide paid YouTube features or preferential application access.

⸻



Disclaimer

YTArk is an independent, unofficial open-source project.

It is not affiliated with, endorsed by, or sponsored by Google LLC or YouTube.

YouTube and related trademarks belong to their respective owners. Third-party services and upstream projects retain their own licenses, terms, and attribution requirements.

⸻

YTArk — YouTube TV, enhanced for Android.