const { isIP } = require('node:net');

const EXAMPLE_BUNDLE_IDENTIFIER = 'com.example.drop';

function validBundleIdentifier(value) {
  return (
    typeof value === 'string' &&
    value.length <= 255 &&
    /^(?:[A-Za-z][A-Za-z0-9-]*\.)+[A-Za-z][A-Za-z0-9-]*$/.test(value)
  );
}

function bundleIdentifierForExpo(env) {
  const value = env.DROP_BUNDLE_IDENTIFIER;
  if (value === undefined || value === '') return EXAMPLE_BUNDLE_IDENTIFIER;
  if (!validBundleIdentifier(value)) {
    throw new Error(
      'DROP_BUNDLE_IDENTIFIER must be a valid reverse-DNS identifier',
    );
  }
  return value;
}

function isPrivateIpv4(hostname) {
  if (isIP(hostname) !== 4) return false;
  const [first, second] = hostname.split('.').map(Number);
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function validateBackendOrigin(value) {
  if (!value)
    throw new Error('EXPO_PUBLIC_API_URL is required for a Release build');
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('EXPO_PUBLIC_API_URL must be a valid HTTPS backend origin');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== '/' && url.pathname !== '')
  ) {
    throw new Error(
      'EXPO_PUBLIC_API_URL must be an HTTPS origin without credentials, path, query or fragment',
    );
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    (isIP(host) === 6 &&
      (host === '::1' ||
        host.startsWith('fc') ||
        host.startsWith('fd') ||
        host.startsWith('fe8') ||
        host.startsWith('fe9') ||
        host.startsWith('fea'))) ||
    isPrivateIpv4(host) ||
    /(^|\.)(example\.(com|net|org)|example|invalid|test)$/.test(host)
  ) {
    throw new Error(
      'EXPO_PUBLIC_API_URL must name your publicly reachable backend, not a placeholder or local address',
    );
  }
  return url.origin;
}

function validateReleaseConfiguration(env) {
  const team = env.DROP_DEVELOPMENT_TEAM;
  if (!team || !/^[A-Z0-9]{10}$/.test(team)) {
    throw new Error(
      'DROP_DEVELOPMENT_TEAM must be your 10-character Apple Team ID',
    );
  }
  const bundleIdentifier = env.DROP_BUNDLE_IDENTIFIER;
  if (
    !validBundleIdentifier(bundleIdentifier) ||
    bundleIdentifier
      .toLowerCase()
      .split('.')
      .some((part) => part.includes('example') || part === 'yourcompany')
  ) {
    throw new Error(
      'DROP_BUNDLE_IDENTIFIER must be your own non-placeholder iOS Bundle ID',
    );
  }
  validateBackendOrigin(env.EXPO_PUBLIC_API_URL);
  return { team, bundleIdentifier };
}

if (require.main === module) {
  try {
    validateReleaseConfiguration(process.env);
    console.log('Public Release configuration validated.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  EXAMPLE_BUNDLE_IDENTIFIER,
  bundleIdentifierForExpo,
  validateBackendOrigin,
  validateReleaseConfiguration,
};
