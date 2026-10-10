const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const path = require('node:path');

const {
  EXAMPLE_BUNDLE_IDENTIFIER,
  bundleIdentifierForExpo,
  validateBackendOrigin,
  validateReleaseConfiguration,
} = require('../public_build_config.cjs');
const appConfig = require('../../app.config.js');

const valid = {
  DROP_DEVELOPMENT_TEAM: 'A1B2C3D4E5',
  DROP_BUNDLE_IDENTIFIER: 'org.acme.drop',
  EXPO_PUBLIC_API_URL: 'https://api.acme.org',
};

test('Expo config uses one explicit Bundle ID and preserves app metadata', () => {
  const original = process.env.DROP_BUNDLE_IDENTIFIER;
  delete process.env.DROP_BUNDLE_IDENTIFIER;
  try {
    const config = appConfig({
      config: { name: 'Drop', ios: { buildNumber: '3' } },
    });
    assert.equal(config.name, 'Drop');
    assert.equal(config.ios.buildNumber, '3');
    assert.equal(config.ios.bundleIdentifier, EXAMPLE_BUNDLE_IDENTIFIER);
    process.env.DROP_BUNDLE_IDENTIFIER = valid.DROP_BUNDLE_IDENTIFIER;
    assert.equal(
      appConfig({ config: { ios: {} } }).ios.bundleIdentifier,
      valid.DROP_BUNDLE_IDENTIFIER,
    );
  } finally {
    if (original === undefined) delete process.env.DROP_BUNDLE_IDENTIFIER;
    else process.env.DROP_BUNDLE_IDENTIFIER = original;
  }
  assert.equal(bundleIdentifierForExpo(valid), valid.DROP_BUNDLE_IDENTIFIER);
});

test('Release preflight CLI exits before bootstrap for missing or example values', () => {
  const script = path.join(__dirname, '..', 'public_build_config.cjs');
  const missing = spawnSync(process.execPath, [script], {
    env: {},
    encoding: 'utf8',
  });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /DROP_DEVELOPMENT_TEAM/);

  const placeholder = spawnSync(process.execPath, [script], {
    env: { ...valid, EXPO_PUBLIC_API_URL: 'https://your-backend.example.com' },
    encoding: 'utf8',
  });
  assert.equal(placeholder.status, 1);
  assert.match(placeholder.stderr, /EXPO_PUBLIC_API_URL/);

  const accepted = spawnSync(process.execPath, [script], {
    env: valid,
    encoding: 'utf8',
  });
  assert.equal(accepted.status, 0);
});

test('Release requires fork-owned Team, Bundle ID and HTTPS backend', () => {
  assert.deepEqual(validateReleaseConfiguration(valid), {
    team: valid.DROP_DEVELOPMENT_TEAM,
    bundleIdentifier: valid.DROP_BUNDLE_IDENTIFIER,
  });
  assert.throws(
    () => validateReleaseConfiguration({ ...valid, DROP_DEVELOPMENT_TEAM: '' }),
    /DROP_DEVELOPMENT_TEAM/,
  );
  assert.throws(
    () =>
      validateReleaseConfiguration({ ...valid, DROP_BUNDLE_IDENTIFIER: '' }),
    /DROP_BUNDLE_IDENTIFIER/,
  );
  assert.throws(
    () =>
      validateReleaseConfiguration({
        ...valid,
        DROP_BUNDLE_IDENTIFIER: 'com.example.drop',
      }),
    /DROP_BUNDLE_IDENTIFIER/,
  );
  assert.throws(
    () => validateReleaseConfiguration({ ...valid, EXPO_PUBLIC_API_URL: '' }),
    /EXPO_PUBLIC_API_URL/,
  );
});

test('Release rejects placeholder, local and malformed backend origins', () => {
  for (const url of [
    'https://your-backend.example.com',
    'https://api.example.org',
    'http://api.acme.org',
    'https://localhost:8000',
    'https://192.168.1.10',
    'https://[fd00::1]',
    'https://user:secret@api.acme.org',
    'https://api.acme.org/path',
    'https://api.acme.org/?token=secret',
    'not-a-url',
  ]) {
    assert.throws(() => validateBackendOrigin(url), undefined, url);
  }
  assert.equal(
    validateBackendOrigin('https://api.acme.org/'),
    'https://api.acme.org',
  );
});

test('Expo config rejects invalid explicit Bundle IDs', () => {
  assert.throws(
    () => bundleIdentifierForExpo({ DROP_BUNDLE_IDENTIFIER: '../drop' }),
    /DROP_BUNDLE_IDENTIFIER/,
  );
});
