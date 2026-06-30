module.exports = function (api) {
  api.cache(true);
  // reanimated v4 moved its babel plugin into react-native-worklets (must be last)
  return { presets: ['babel-preset-expo'], plugins: ['react-native-worklets/plugin'] };
};
