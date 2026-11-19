// Expo's Metro config auto-detects the npm workspace monorepo and resolves
// @waylix/engine through its "react-native" export condition (TypeScript source).
const { getDefaultConfig } = require('expo/metro-config');

module.exports = getDefaultConfig(__dirname);
