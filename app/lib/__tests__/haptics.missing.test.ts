// A build without the native module (or a module that throws at import) must make haptics a no-op,
// never a crash: the feedback is decoration.
jest.mock('react-native-haptic-feedback', () => { throw new Error('TurboModuleRegistry.getEnforcing: not found'); });

test('haptic() is a safe no-op when the native module is missing', () => {
  const { haptic } = require('../haptics');
  expect(() => { haptic('recordStart'); haptic('delete'); }).not.toThrow();
});
