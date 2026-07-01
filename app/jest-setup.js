// jest-expo is gone; provide the mocks its preset used to supply.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

// reanimated must be mocked in jest (native module unavailable)
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));

// react-native-config is a native module; give tests a default backend base URL
jest.mock('react-native-config', () => ({ API_BASE: 'http://127.0.0.1:8780' }));

// react-native-fs constructs a NativeEventEmitter at import → crashes in jest without a
// native module. Provide a default surface so any suite that transitively imports it loads.
// Suites that assert fs calls (recordings/AnalysisTab) declare their own jest.mock and win.
jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/doc',
  CachesDirectoryPath: '/cache',
  mkdir: jest.fn().mockResolvedValue(undefined),
  exists: jest.fn().mockResolvedValue(false),
  moveFile: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
}));

// nitro-sound / clipboard / share / picker get per-suite mocks in their tests
