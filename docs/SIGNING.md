# YTArk release signing, key status, and migration plan

## Recorded package and signing identity

| Item | Value |
|---|---|
| Android package (applicationId) | `io.github.twoarchiver.ytark` |
| Release signing certificate SHA-256 | `b9cb7e4b4d5179870e672e850f5d3661f02c248f943dbaf10cd78cd0c047eaae` |
| Certificate subject | PhairPlay Community Build (Hearth community key) |
| Latest published versionCode | `20017` (`2.0.4-ytark.17`) |
| Target YTArk 2.1 versionCode | `2010000` (`2.1.0`, display version `2.1`) |
| Key material location (upstream) | `2archiver/Hearth` commit `79ffcfa4d718662985e706f2425418da01e15de0`, `app/signing/phairplay.p12` (blob `1bbeb049cb87e85569fdeee9713291bd8402c579`) |

Login depends on the package name, the shared-Cobalt account storage under the
app's data directory, and component names such as `dev.cobalt.app.MainActivity`
and the updater components under `io.github.twoarchiver.ytark.updater`. These
must never change across releases.

## Key exposure status — treat the current key as compromised

The current release key is Hearth's **intentionally public community keystore**.
The PKCS#12 file *and its passwords* are published in a public repository.
This is by design (it lets a community project sign releases without storing
secrets), and it means:

- The key has **always** been exposed. It provides *Android signer continuity*
  only. A matching certificate **does not prove publisher identity**, and the
  key provides **no security against a malicious signer** — anyone can sign a
  "valid upgrade" for this package. This is disclosed to users in the README.
- Removing the keystore from this repository's history would change nothing
  about its exposure; it remains public upstream.

Because ordinary Android installs cannot accept an unrelated signing
certificate as an in-place update, switching keys today would strand every
existing installation (Android would refuse the update; uninstalling would
erase login and settings). YTArk therefore **keeps signing with the pinned
community key for compatibility** and mitigates at the distribution layer:
users are told to install only from the official repository and to verify
`SHA256SUMS.txt`.

## Explicit key-migration strategy (future, coordinated)

1. **Generate a private YTArk release key offline** (never in CI, never in
   Git). Store base64-encoded keystore bytes and passwords only in protected
   GitHub Actions secrets (base64 is encoding, not encryption — the secrets
   store supplies access control) or in a dedicated signing service. Keep an
   encrypted offline backup in two separate physical locations.
2. **Do not rely on APK Signature Scheme v3 rotation for security.** Rotation
   lineages are anchored to the oldest certificate in the chain; because that
   anchor (the community key) is public, an attacker could mint their own
   rotation. Rotation keeps installs compatible but cannot add trust.
3. **Choose an explicit migration path when moving to a private key:**
   - *Path A — same package, accept residual risk:* ship a final same-signer
     bridge release that exports settings and explains the change, then a
     v3-rotated release signed with the private key. In-place upgrades keep
     working, but users must be told the old key is compromised and to verify
     release checksums.
   - *Path B — new package id:* publish under a new applicationId signed with
     the private key. This is the only path with real signer security, at the
     cost of a manual migration (re-sign-in and settings re-import; Android
     cannot merge app data across packages).
   - *Path C — store distribution:* if YTArk is ever published on Google Play,
     use Play App Signing and let the store own the key.
4. **Never silently ship an incompatible update.** Any signer change requires
   release-note warnings, a documented migration path, and a versionCode that
   still increases for the same package.

## CI signing runbook (current pipeline)

- `tools/prepare_signing_key.sh` decodes the keystore into a `chmod 700`
  temporary directory under `RUNNER_TEMP` (umask 077), reads passwords from
  files (never argv or logs), and **verifies the certificate fingerprint
  against `signing/YTArk-cert-sha256.txt` before any signing happens**.
- `tools/sign_apks.sh` signs, then re-verifies each output APK's certificate
  fingerprint, and deletes the temporary key directory on exit.
- Signing secrets (if cached in Actions) are never printed; workflows must not
  echo `${{ secrets.* }}` values or pass them to `echo`/`printf` diagnostics.
- The release workflow runs only on `push` to `main` or manual
  `workflow_dispatch` **in the canonical repository** — never on pull_request
  or fork builds — and write permissions are limited to the publishing jobs.
- Actions are pinned to full commit SHAs. Workflow default permissions are
  `contents: read`.
- `tools/check_no_secrets.py` runs in CI (tree and git history) and fails the
  build on private key material, keystore binaries, or credential tokens.
  Repo administrators should additionally enable GitHub **secret scanning**
  and **push protection** (repository settings) as defense in depth.

## If the release key is ever replaced

- Record the new certificate SHA-256 in `signing/YTArk-cert-sha256.txt` and
  `docs/SIGNING.md` in the same release that starts using it.
- The updater pins the fingerprint at build time (`UpdaterBuildConfig`); a key
  change requires a release whose updater expects the new fingerprint, and its
  release notes must explain the migration to users (see strategy above).
