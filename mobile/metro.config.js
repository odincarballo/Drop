const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
// Optional build-only dependency location; normal installations keep Expo defaults.
const externalModules = process.env.DROP_METRO_NODE_MODULES;
if (externalModules) {
  if (!path.isAbsolute(externalModules)) {
    throw new Error('DROP_METRO_NODE_MODULES must be an absolute path');
  }
  config.watchFolders = [...new Set([...config.watchFolders, externalModules])];
  config.resolver.nodeModulesPaths = [
    ...new Set([...config.resolver.nodeModulesPaths, externalModules]),
  ];
}

module.exports = config;
