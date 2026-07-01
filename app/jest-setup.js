// jest-expo is gone; provide the mocks its preset used to supply.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

// reanimated must be mocked in jest (native module unavailable)
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));

// react-native-config is a native module; give tests a default backend base URL
jest.mock('react-native-config', () => ({ API_BASE: 'http://127.0.0.1:8780' }));

// nitro-sound / fs / clipboard / share / picker get per-suite mocks in their tests
