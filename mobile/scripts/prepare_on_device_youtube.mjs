// Pinned build-time dependencies only. No binaries are committed or fetched on iOS.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../modules/on-device-youtube/vendor',
);
mkdirSync(root, { recursive: true });
const dependencies = [
  [
    'python-ios.tar.gz',
    'https://github.com/beeware/Python-Apple-support/releases/download/3.13-b15/Python-3.13-iOS-support.b15.tar.gz',
    '80175765a31babe43b0910395cf86ba4e8412adf1902b069d55b74d523ecc5d1',
    'python',
  ],
  [
    'quickjs.tar.gz',
    'https://api.github.com/repos/quickjs-ng/quickjs/tarball/v0.16.2',
    '6ee0c983477c9b145909d873ed1a57422001927f7706b63859abf8e816d2d88c',
    'quickjs',
  ],
  [
    'yt_dlp.whl',
    'https://files.pythonhosted.org/packages/69/b2/8cd1613f56eed7ceb64fbd4df3f1c01246bfb098e6f398228bafda22b80b/yt_dlp-2026.8.19-py3-none-any.whl',
    '1d57897e94c6665a0a6f9bc54b34e584284e32c034ffab3a7df25d8f7b24eedf',
    'packages',
  ],
  [
    'yt_dlp_ejs.whl',
    'https://files.pythonhosted.org/packages/e3/bd/520769863744b669440a924271a6159ddd82ad5ae26b4ac4d4b69e9f8d44/yt_dlp_ejs-0.8.0-py3-none-any.whl',
    '79300e5fca7f937a1eeede11f0456862c1b41107ce1d726871e0207424f4bdb4',
    'packages',
  ],
  [
    'certifi.whl',
    'https://files.pythonhosted.org/packages/0b/a7/71ac2cff56fec219ed242bb11b8efb69fcc4bec75db06fb7bfe35de520e6/certifi-2026.7.22-py3-none-any.whl',
    '62f22742b58a1a33014a2b6b706588a8d7e2a88ae7bd1a6ebe8c992928483775',
    'packages',
  ],
];
for (const [name, url, hash, directory] of dependencies) {
  const archive = resolve(root, name);
  if (!existsSync(archive)) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Dependency download failed: ${name}`);
    writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
  }
  if (createHash('sha256').update(readFileSync(archive)).digest('hex') !== hash)
    throw new Error(`Dependency checksum mismatch: ${name}`);
  const destination = resolve(root, directory);
  mkdirSync(destination, { recursive: true });
  if (name.endsWith('.whl')) {
    execFileSync('/usr/bin/unzip', ['-oq', archive, '-d', destination]);
  } else {
    execFileSync('/usr/bin/tar', [
      '-xzf',
      archive,
      '-C',
      destination,
      ...(directory === 'quickjs' ? ['--strip-components=1'] : []),
    ]);
  }
  console.log(`Verified: ${name}`);
}
