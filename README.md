# Drop

Drop is an iPhone app for downloading authorized media and keeping it in an
offline library. The repository and the iPhone app are both named **Drop**.
This branch prepares Drop v1.4.0 (build 7) as a release candidate.

Drop is designed for public or otherwise authorized content. It does not
support DRM bypass, private accounts, memberships, paywalls, login cookies,
third-party credentials, or proxies intended to evade access controls.

## Overview

YouTube analysis and downloads run on the device for compatible individual
URLs. Direct HTTP(S) media uses a separate, self-hosted backend. The app does
not provide a public backend service: a fork must configure and operate its
own backend for direct-resource downloads.

Downloaded media is moved into Drop's persistent library. Library items can be
played offline, shared, exported to Files, or deleted. Exported Files copies
are separate from Drop's managed library.

## Features

- Local MP4/M4A playback with seeking, ±15-second jumps, persistent global
  0.75–2× speed, contextual auto-next, progress, resume, and fullscreen video.
- Global Now Playing state follows the native playback session, resolves the
  active title and local artwork from Library, reflects auto-next, and
  reconciles when the app returns to the foreground.
- A persistent mini-player shows artwork, title, and Play/Pause throughout
  general navigation. Tapping its main area opens the active full player; it
  stays hidden inside `/player/*` and fullscreen.
- Background audio, Lock Screen/Control Center metadata and controls,
  AirPods/Bluetooth transport controls, and video Picture in Picture where
  supported by iOS.
- Persistent offline library with local artwork, metadata, storage usage,
  deletion, sharing, and friendly export filenames.
- Persistent local Collections organize Library items without duplicating media;
  an item can belong to multiple Collections or appear in Uncollected.
- A persistent Manual Queue supports adding next/last, reordering, removing,
  clearing pending entries, and independent repeated occurrences. Native
  AVQueuePlayer selection plays CURRENT, then Manual Queue, then Playback Context.
- YouTube range downloads with bounded retries, integrity checks, a narrowly
  scoped audio-403 URL refresh, and dynamic iPhone storage preflight.

## Architecture and technical highlights

`mobile/` uses React Native, Expo Router, and Expo Modules. Versioned Swift
modules implement the downloader, persistent library, file export, and one
AVQueuePlayer-based playback service with a bounded current/next window. The
library stores metadata in SQLite and media/artwork in the iOS app container.
The root `PlaybackProvider` exposes native Now Playing state to the UI, while
the mini-player consumes that shared state without creating another player.
The on-device YouTube path embeds
CPython, pinned yt-dlp, and QuickJS. The direct-media path is a separate
FastAPI backend under `backend/`.

The implementation validates untrusted URLs and redirects, TLS, media
metadata and byte ranges, file sizes, and available storage. It avoids
persisting signed stream URLs and keeps the backend Bearer token in iOS
SecureStore rather than source code or an `EXPO_PUBLIC_*` variable. Lockfiles,
pinned preparation inputs, checksums, automated suites, and documented
physical-device checks support reproducible verification; a fresh public
clone has been verified anonymously. Clean-checkout Release verification was
completed during repository preparation. The author subsequently completed a
fresh public-clone Release self-validation, including build, signed installation,
and physical smoke testing. Independent third-party end-to-end verification
remains pending.

## Requirements

- macOS, Xcode with iOS device support, an Apple ID/Team for device signing,
  and an iPhone for physical installation.
- Node.js 22 (`mobile/.nvmrc`; `mobile/package.json` requires at least 22.13),
  npm, Ruby 2.6–3.1, Bundler 2.4.22, and CocoaPods from
  `mobile/Gemfile.lock`. The current lock includes `CFPropertyList` 3.0.9,
  which rejects Ruby 3.2 and newer; check `ruby --version` before bootstrap.
- Internet access to install dependencies and the pinned on-device Python
  runtime during bootstrap.
- For a local backend: Python 3.13 and `uv`. The default `auto` provider also
  checks FFmpeg/ffprobe at startup and uses Node.js for compatible yt-dlp
  challenges; see `backend/Dockerfile` for its pinned container environment.
  Docker is optional for mobile development.

Do not put signing identities, provisioning profiles, or Bearer tokens in Git.

## Run Drop on your iPhone

The author completed Release self-validation from an anonymous fresh clone of
the published repository: build, signing, side-by-side installation, and launch
without Metro succeeded. Independent third-party end-to-end validation of the
workflow below remains pending.

1. Clone this repository and install the locked JavaScript dependencies:

   ```bash
   git clone https://github.com/odincarballo/Drop.git
   cd Drop/mobile
   npm ci
   ```

2. Set your own Bundle ID, for example
   `export DROP_BUNDLE_IDENTIFIER=com.yourcompany.drop`. Do not use the
   repository author's Bundle ID. Prepare the pinned runtime with
   `node scripts/prepare_on_device_youtube.mjs`.
3. Select a compatible Ruby (`ruby --version` must report 2.6–3.1; on a Mac
   where a newer Homebrew Ruby takes precedence, select a compatible Ruby
   before running these commands). Install the locked Ruby dependencies with
   `gem install --user-install bundler --version 2.4.22 --no-document` if that
   Bundler version is not already available, then
   `bundle _2.4.22_ config set --local path vendor/bundle` and
   `bundle _2.4.22_ install --frozen`. Generate iOS with
   `EXPO_USE_PRECOMPILED_MODULES=0 npx expo prebuild --platform ios --no-install`.
4. Run `bundle _2.4.22_ exec ruby scripts/configure_on_device_youtube.rb`,
   then install Pods with the project-specific environment:

   ```bash
   RUBYOPT="-rbundler/setup -r$PWD/scripts/cocoapods_compat.rb" \
     CP_HOME_DIR="$PWD/.cocoapods" RCT_SKIP_CACHES=1 \
     EXPO_USE_PRECOMPILED_MODULES=0 \
     bundle _2.4.22_ exec pod install --project-directory=ios
   ```

5. Open the generated `.xcworkspace` in `mobile/ios/`, select your Apple Team
   for the app target in Xcode, build, and install on your iPhone. For a Metro
   development session, run `npx expo start --dev-client --lan` from `mobile/`.

These commands must run from `mobile/` after cloning; no absolute path tied to
the author's Mac is required. The generated `mobile/ios/` directory is ignored
and should not be edited as the source of truth.

### Configure signing and Bundle ID

`DROP_BUNDLE_IDENTIFIER` feeds Expo's versioned dynamic app config and the
native project integration script. Without it, Expo may resolve the example
ID `com.example.drop` for non-Release tooling. The clean-checkout Release
script rejects a missing or example ID. For that script, also
export your own 10-character `DROP_DEVELOPMENT_TEAM`; there is no fallback to
the original author's Team. Xcode users may select their Team in the UI.

To update the author's existing installation while preserving its app data,
the author must explicitly set the original Bundle ID and Team in their local
environment. A fork should use its own values and will have a separate iOS
app container.

### Backend and Bearer token

YouTube uses the on-device path. Direct HTTP(S) resources require a backend
you operate. For development on this Mac only, configure `backend/.env` from
`backend/.env.example`, replace the example token, then start the backend with
the locked Python dependencies:

```bash
cd ../backend
cp .env.example .env
uv sync --frozen --extra dev
uv run --frozen uvicorn app.main:app --host 127.0.0.1 --port 8000
```

The example token is not functional: the backend refuses to start with it or
without an explicit token in every environment. Production requires a unique
token of at least 32 characters. To test from a physical iPhone on a trusted
LAN, explicitly use `--host 0.0.0.0` instead and set the URL in
`mobile/.env.development` to your Mac's LAN origin (copy it from
`mobile/.env.development.example`). Plain HTTP on a LAN transmits the Bearer
token without TLS encryption; do not use it on an untrusted network. The
development example contains no secret. Enter the corresponding backend token
in Drop's private-access UI; the app stores it in SecureStore.

For a Release, export `EXPO_PUBLIC_API_URL` as the HTTPS **origin** of your
own reachable backend before running the clean-checkout script. The script
rejects missing, local, non-HTTPS, and example/placeholder origins. The
versioned `mobile/.env.production.example` is documentation only; the script
does not source it. `EXPO_PUBLIC_API_URL` is public and embedded in the app.
Never put the Bearer token there: configure the token on your own backend and
enter it in Drop's private-access UI, which stores it in SecureStore.

The clean-checkout Release procedure is documented in
[docs/reproducible-ios-release.md](docs/reproducible-ios-release.md).
Clean-checkout Release verification was completed during repository
preparation. A Release was subsequently built, signed, installed side by side,
and physically smoke-tested from a fresh clone of the published repository by
the author. Independent third-party verification remains pending.

## Security model and authorized content

Input URLs are untrusted. Direct-resource requests enforce SSRF and redirect
validation, TLS, size and media-integrity limits, and bounded job lifetimes.
The on-device YouTube path validates stream identity, format, host, metadata,
HTTP ranges, and storage capacity. Logs should not contain Bearer tokens,
cookies, or signed URL queries. See [SECURITY.md](SECURITY.md) for responsible
reporting; do not post sensitive material in public issues.

Drop uses a pinned on-device yt-dlp integration for compatible individual
YouTube URLs and public/authorized content. Source-side changes may affect
compatibility. Drop is not affiliated with YouTube and does not claim
universal source compatibility.

## Project structure

| Path              | Purpose                                                         |
| ----------------- | --------------------------------------------------------------- |
| `mobile/src/`     | Expo Router UI, state, models, and services                     |
| `mobile/modules/` | Swift/Expo modules for downloads, library, export, and playback |
| `mobile/scripts/` | Native bootstrap and clean-checkout Release tooling             |
| `backend/`        | Optional self-hosted direct-media API and tests                 |
| `docs/`           | Architecture, validation history, and release procedures        |

## Tests and reproducibility

From `mobile/`, run `npm test`, `npm run typecheck`, `npm run lint`, and
`npm run format:check`. The fork-configuration checks run with
`node --test scripts/tests/public_build_config.test.cjs`. From `backend/`, use
the locked `uv` environment and run `uv run --frozen pytest -q`; additional
Ruff and mypy checks are configured in `backend/pyproject.toml`.

The repository contains Swift unit-test sources alongside native modules.
Automated tests do not replace physical verification of signing, background
audio, PiP, file export, or iOS storage behavior. The versioned Release script
uses pinned dependencies and verifies bootstrap inputs. The clean-checkout
Release workflow was verified during repository preparation; independent
third-party end-to-end verification from a fresh public clone remains pending.
In the author's fresh public-clone self-validation, the Release built and
installed, launched without Metro, downloaded an authorized YouTube video, and
passed local playback, controls, background audio, PiP, and library-persistence
checks across an app restart, including playback after reopening.

For Manual Queue, integrated Release ARM64 compilation and a signed test-app
update were verified from the functional commit before the version bump. The
user subsequently reported 15/15 physical checks passing; these are distinct
from Codex's automated checks. The new 1.4.0 build 7 artifact still needs its
own build/signing and device verification. See the [physical-validation report](docs/manual-queue-v1.4.0-physical-validation.md)
and [candidate release notes](docs/release-notes-v1.4.0.md).

## Known limitations and roadmap

Support is deliberately scoped to compatible individual YouTube URLs and
validated direct resources. Audio-only playback currently targets M4A/AAC;
video playback targets compatible local MP4. The 1080p download policy remains
more conservative than 360p/720p. Downloads do not continue in the background;
background playback is separate. v1.4.0 does not include Playlists,
manual Next/Previous, global Repeat, Shuffle, sleep timer, cloud sync, or
import of old Files exports. Source compatibility and available storage may
vary by device and source.

The repository is now public, and its publication security/distribution review
and author fresh public-clone self-validation are complete. The remaining
distribution-validation item is independent third-party end-to-end build and
installation verification from a fresh public clone.

## Third-party software and license

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for components and
distribution notes. Original Drop material is licensed under the [MIT
License](LICENSE); dependencies retain their own licenses.
