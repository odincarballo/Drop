# Third-party software in Drop

Drop's `LICENSE` applies only to original Drop material. The components below
retain their own licenses and copyright notices. Versions here describe the
current lockfiles and pinned preparation inputs; a final distributable must be
checked against its actual contents before public release.

## iOS application

| Component                                            | Version / origin                                                                                                                                                            | License and applicable notice                                                                           | Distribution / notice location                                                                                                                                                                  |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Expo and Expo modules                                | Expo 57.0.20 and runtime modules pinned in `mobile/package-lock.json`; [Expo](https://github.com/expo/expo)                                                                 | MIT; retain each package's upstream copyright and MIT text                                              | React Native JS/native app; generated native Pod notices are copied to `Drop.app/ThirdPartyNotices/CocoaPods.md`. Pure-JS bundle membership cannot be inferred exactly from the lockfile alone. |
| React, React Native, Hermes and React Native modules | React 19.2.3, React Native 0.86.3, Hermes from the generated Pod lock; [React](https://github.com/facebook/react), [React Native](https://github.com/facebook/react-native) | MIT and upstream copyright notices; retain the relevant package/Pod license text                        | App JS/native code. Generated native CocoaPods acknowledgements are copied to `ThirdPartyNotices/CocoaPods.md`; exact Metro module attribution remains a binary-distribution review item.       |
| BeeWare Python-Apple-support                         | 3.13-b15 support archive, SHA-256 pinned by `mobile/scripts/prepare_on_device_youtube.mjs`; [source](https://github.com/beeware/Python-Apple-support/tree/3.13)             | MIT; Russell Keith-Magee notice reproduced below                                                        | Its iOS support build is used to embed CPython. This file is copied to `Drop.app/ThirdPartyNotices/Drop.md`.                                                                                    |
| CPython                                              | 3.13.15 in the pinned BeeWare archive; [Python licensing](https://docs.python.org/3/license.html)                                                                           | PSF License Version 2 plus incorporated third-party terms; preserve the full bundled `LICENSE.txt`      | Embedded framework and standard library; `python/lib/LICENSE.txt` is copied by BeeWare's installer and a copy is placed at `ThirdPartyNotices/CPython.txt`.                                     |
| yt-dlp                                               | 2026.8.19 pinned wheel; [source](https://github.com/yt-dlp/yt-dlp)                                                                                                          | Unlicense; preserve its wheel `LICENSE`                                                                 | Embedded in `md_packages`; wheel `.dist-info/licenses/LICENSE` is retained.                                                                                                                     |
| yt-dlp-ejs                                           | 0.8.0 pinned wheel; [source](https://github.com/yt-dlp/ejs)                                                                                                                 | Unlicense **and** bundled ISC/MIT code; preserve wheel license and bundled JS notices                   | Embedded in `md_packages`; its wheel license and `yt/solver/lib.min.js` copyright/license header remain present.                                                                                |
| meriyah                                              | 6.1.4, declared in the pinned yt-dlp-ejs 0.8.0 wheel's `yt/solver/lib.min.js` header; [source](https://github.com/meriyah/meriyah)                                          | ISC; copyright KFlash and others; retain the ISC notice in EJS `lib.min.js`                             | Included inside the embedded EJS JS bundle, not a separate npm package in the app.                                                                                                              |
| astring                                              | 1.9.0, declared in the pinned yt-dlp-ejs 0.8.0 wheel's `yt/solver/lib.min.js` header; [source](https://github.com/davidbonnet/astring)                                      | MIT; copyright David Bonnet; retain the MIT notice in EJS `lib.min.js`                                  | Included inside the embedded EJS JS bundle.                                                                                                                                                     |
| QuickJS-NG                                           | 0.16.2 pinned archive; [source](https://github.com/quickjs-ng/quickjs)                                                                                                      | MIT; Fabrice Bellard, Charlie Gordon, Ben Noordhuis and Saúl Ibarra Corretgé; retain upstream `LICENSE` | C sources compiled into the native module; full license copied to `Drop.app/ThirdPartyNotices/QuickJS-NG.txt`.                                                                                  |
| certifi                                              | 2026.7.22 pinned wheel; [source](https://github.com/certifi/python-certifi)                                                                                                 | MPL-2.0; retain wheel `LICENSE`                                                                         | Embedded CA bundle/package in `md_packages`; `.dist-info/licenses/LICENSE` is retained.                                                                                                         |
| SQLite                                               | 3.50.3 vendored by expo-sqlite 57.0.3; [SQLite rights statement](https://www.sqlite.org/copyright.html)                                                                     | Public domain; no SQLite copyright notice required                                                      | SQLite amalgamation is compiled into the iOS module. Expo's MIT notice is separate.                                                                                                             |

The direct JavaScript runtime dependencies in `mobile/package-lock.json` have
MIT package metadata: `@react-native-async-storage/async-storage` 2.2.0,
`expo-asset` 57.0.18, `expo-clipboard` 57.0.1, `expo-constants` 57.0.20,
`expo-dev-client` 57.0.18, `expo-file-system` 57.0.6, `expo-linking` 57.0.9,
`expo-router` 57.0.19, `expo-secure-store` 57.0.3, `expo-sharing` 57.0.18,
`expo-sqlite` 57.0.3, `expo-status-bar` 57.0.1, `expo-symbols` 57.0.2,
`expo-system-ui` 57.0.3, `react-dom` 19.2.3, `react-native-gesture-handler`
2.32.0, `react-native-reanimated` 4.5.1, `react-native-safe-area-context`
5.7.0, `react-native-screens` 4.26.2, `react-native-worklets` 0.10.1 and `zod`
4.5.4. Their sources and individual copyright/license files are in the
corresponding npm packages. This lockfile list is **not** proof that every
listed package's code ships, nor a complete inventory of transitive code in
the final JS bundle.

The pinned BeeWare archive's `VERSIONS` lists BZip2 1.0.8-2, libFFI
3.4.7-2, mpdecimal 4.0.0-2, OpenSSL 3.0.22-1 and XZ 5.6.4-2. Its iOS
slice contains `_bz2`, `_ctypes`, `_decimal`, `_ssl`/`_hashlib` and
`_lzma` extensions. `otool -L` shows no separate dynamic dependency for
these five libraries, so their code is linked into the extensions. The
original upstream notices are versioned under
`mobile/modules/on-device-youtube/notices/` and copied into
`Drop.app/ThirdPartyNotices/NativePython/`:

| Component                        | Source of the notice                                                                                                                                                                                   | License and copyright                                                                                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BZip2                            | [BZip2 1.0.8 `LICENSE`](https://sourceware.org/pub/bzip2/bzip2-1.0.8.tar.gz) → `BZip2.txt`                                                                                                             | BZip2 license; Copyright (C) 1996–2019 Julian R Seward.                                                                                                                   |
| libFFI                           | [libffi v3.4.7 `LICENSE`](https://github.com/libffi/libffi/blob/v3.4.7/LICENSE) → `libFFI.txt`                                                                                                         | MIT-like permissive license; Copyright (c) 1996–2024 Anthony Green, Red Hat, Inc and others.                                                                              |
| mpdecimal                        | [mpdecimal 4.0.0 `COPYRIGHT.txt`](https://www.bytereef.org/software/mpdecimal/releases/mpdecimal-4.0.0.tar.gz) → `mpdecimal.txt`                                                                       | BSD-style license; Copyright (c) 2008–2024 Stefan Krah.                                                                                                                   |
| OpenSSL                          | [OpenSSL 3.0.22 `LICENSE.txt`](https://github.com/openssl/openssl/blob/openssl-3.0.22/LICENSE.txt) → `OpenSSL.txt`                                                                                     | Apache-2.0; [upstream copyright statement](https://github.com/openssl/openssl/blob/openssl-3.0.22/README.md) credits The OpenSSL Project and Eric A. Young/Tim J. Hudson. |
| XZ/liblzma                       | [XZ 5.6.4 `COPYING`](https://github.com/tukaani-project/xz/blob/v5.6.4/COPYING) and [`COPYING.0BSD`](https://github.com/tukaani-project/xz/blob/v5.6.4/COPYING.0BSD) → `XZ-COPYING.txt`, `XZ-0BSD.txt` | liblzma is 0BSD; Copyright (C) The XZ Utils authors and contributors. The GPL/LGPL portions described in `COPYING` are not part of the embedded liblzma.                  |
| BeeWare dependency build scripts | [`cpython-apple-source-deps/LICENSE`](https://github.com/beeware/cpython-apple-source-deps/blob/main/LICENSE) → `BeeWare-source-deps.txt`                                                              | MIT; Copyright (c) Russell Keith-Magee. Included conservatively for BeeWare's dependency build modifications.                                                             |
| Expat                            | [CPython 3.13.15 bundled `Modules/expat/COPYING`](https://github.com/python/cpython/blob/v3.13.15/Modules/expat/COPYING) → `Expat.txt`                                                                 | MIT; Copyright (c) 1998–2000 Thai Open Source Software Center Ltd and Clark Cooper; Copyright (c) 2001–2025 Expat maintainers. The iOS slice includes `pyexpat`.          |

The `-1`/`-2` suffixes are BeeWare support-library build revisions, not
separate upstream license versions. The native notices above are additional
to, not replacements for, the bundled CPython license. The archive's `zlib`
extension links Apple's `/usr/lib/libz.1.dylib` and `_sqlite3` links
Apple's `/usr/lib/libsqlite3.dylib`; those two system libraries are not
separate BeeWare binaries copied into Drop.

The build scripts copy the pinned Python wheel license files with the wheels
into `Drop.app/md_packages` and copy the generated CocoaPods acknowledgements
and explicit notices above. A clean ARM64 inspection build confirmed that
`ThirdPartyNotices/CocoaPods.md`, `CPython.txt`, `QuickJS-NG.txt`, all eight
`NativePython` notices, and the three wheel license files are present. The
generated CocoaPods acknowledgement contains 17 license sections covering
the root native families; numerous Podfile entries are subspecs or share
parent license texts. It is not a one-to-one list of every Podfile line.

### BeeWare Python-Apple-support MIT notice

Copyright (c) 2014-2018 Russell Keith-Magee.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

## Backend and backend container

These components belong to the separately deployable backend, **not** the iOS
application. Python package versions below come from `backend/uv.lock` and
license expressions from the installed package metadata in the pinned backend
environment.

| Component         | Version / origin                                                        | License / notice to retain                                            | Distribution                                               |
| ----------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------- |
| CPython           | 3.13.5 `python:3.13.5-slim-bookworm`; [Python](https://www.python.org/) | PSF-2.0 and bundled notices                                           | Backend image.                                             |
| FastAPI           | 0.141.1; [source](https://github.com/fastapi/fastapi)                   | MIT, package `LICENSE`                                                | Backend environment/image.                                 |
| Pydantic          | 2.13.5; [source](https://github.com/pydantic/pydantic)                  | MIT, package `LICENSE`                                                | Backend environment/image.                                 |
| pydantic-settings | 2.15.0; [source](https://github.com/pydantic/pydantic-settings)         | MIT, package `LICENSE`                                                | Backend environment/image.                                 |
| aiohttp           | 3.14.3; [source](https://github.com/aio-libs/aiohttp)                   | Apache-2.0 AND MIT; package `LICENSE.txt` and `vendor/llhttp/LICENSE` | Backend environment/image. Preserve both applicable texts. |
| Uvicorn           | 0.52.4; [source](https://github.com/encode/uvicorn)                     | BSD-3-Clause, package `LICENSE.md`                                    | Backend environment/image.                                 |
| yt-dlp            | 2026.8.19; [source](https://github.com/yt-dlp/yt-dlp)                   | Unlicense, package `LICENSE`                                          | Backend environment/image.                                 |
| certifi           | 2026.7.22; [source](https://github.com/certifi/python-certifi)          | MPL-2.0, package `LICENSE`                                            | Backend environment/image.                                 |

The remaining transitive backend packages and Debian base-image packages
require an image-level license inventory before distributing a backend image.

## Conditional distribution notes

The source repository contains `backend/Dockerfile`, not a tracked FFmpeg
binary or a prebuilt backend image. It installs Debian's pinned
`ffmpeg=7:5.1.9-0+deb12u1` during image construction. Publication of this
Dockerfile alone does not establish the precise licensing of a resulting
FFmpeg binary and is not a blocker for publication of Drop's source code.
Before **redistributing a built backend image**, inspect the actual image's
`ffmpeg -buildconf`, Debian copyright metadata, and source/build provenance,
then comply with the terms of that concrete build; optional FFmpeg components
can change the applicable terms. The same image includes Node.js 22.23.2 and
uv 0.12.9 copied from pinned stages, so their licenses and bundled
third-party notices, along with all runtime and base-image packages, also
require image-level verification before image distribution. No signed IPA
or prebuilt Docker image is part of this Block 1 source-release scope.

## Build and development tools

Xcode, CocoaPods/Bundler, npm, Jest, TypeScript, ESLint, Prettier, uv on the
developer host, and the Expo CLI participate in builds/tests. They are not
automatically iOS-app contents merely because they occur in a lockfile.
Versions are defined by `mobile/Gemfile.lock`, `mobile/package-lock.json` and
the build scripts. Node.js and uv **are** separately included in the backend
container as noted above.

## Binary-distribution verification boundary

The iOS product was inspected as part of Block 1, but this source-repository
preparation does **not** authorize distribution of a signed IPA. Before any
future IPA distribution, review the exact final Metro/Hermes JS bundle
composition and ensure all applicable pure-JS license texts are delivered;
the npm production dependency tree is a conservative inventory, not proof
that each package is bundled. Recheck notices against that release's actual
app, including the generated CocoaPods acknowledgements, native Python
notices, and wheel licenses. The pinned EJS wheel's bundled ISC/MIT headers
must remain present. Before distributing a backend image, inventory its
concrete runtime and base-image packages, including the Debian FFmpeg build
and Node.js/uv.

This document records verified direct components and explicitly unresolved
items; it is **not** a declaration that binary redistribution is cleared.
