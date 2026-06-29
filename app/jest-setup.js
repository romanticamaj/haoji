// jest-expo@54 does not auto-mock AsyncStorage; store.ts imports it at module load,
// so without this every suite that touches the store fails with "AsyncStorage is null".
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
