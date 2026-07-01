module.exports = {
  presets: ['module:@react-native/babel-preset'],
  // reanimated v4 moved its babel plugin into react-native-worklets (must be last)
  plugins: ['react-native-worklets/plugin'],
};
