// Expo's Metro config auto-detects the npm workspace monorepo and resolves
// @waylix/engine through its "react-native" export condition (TypeScript source).
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Web preview (UI review, screenshots, CI): MapLibre Native has no web build,
// so on the web platform it is swapped for a stand-in that renders the app's
// real GeoJSON layers without basemap tiles. Native builds are unaffected.
const WEB_SHIMS = {
  '@maplibre/maplibre-react-native': 'maplibre-stub.tsx',
  'expo-location': 'expo-location-shim.ts',
};
const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && WEB_SHIMS[moduleName]) {
    return { type: 'sourceFile', filePath: path.join(__dirname, 'web-preview', WEB_SHIMS[moduleName]) };
  }
  return upstream ? upstream(context, moduleName, platform) : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
