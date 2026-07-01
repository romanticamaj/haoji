module.exports = {
  preset: 'react-native',
  setupFiles: ['<rootDir>/jest-setup.js'],
  setupFilesAfterEnv: ['@testing-library/jest-native/extend-expect'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-navigation/.*|@react-native-async-storage/.*|react-native-nitro-sound|react-native-fs|react-native-share|@react-native-documents/.*|@react-native-clipboard/.*|react-native-config|react-native-reanimated|react-native-worklets|react-native-markdown-display)/)',
  ],
};
