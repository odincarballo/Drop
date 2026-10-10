const {
  bundleIdentifierForExpo,
} = require('./scripts/public_build_config.cjs');

module.exports = ({ config }) => ({
  ...config,
  ios: {
    ...config.ios,
    bundleIdentifier: bundleIdentifierForExpo(process.env),
  },
});
