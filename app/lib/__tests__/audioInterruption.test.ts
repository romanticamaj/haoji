import { DeviceEventEmitter, NativeModules } from 'react-native';
import { onAudioInterruption } from '../audioInterruption';

const prepare = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  (NativeModules as any).AudioInterruption = { prepare };
});

// The bug this guards: React Native builds native modules lazily. Subscribing through
// DeviceEventEmitter alone never touched the module, so it was never created, its observer was
// never registered, and a phone call mid-recording never reached the app.
test('subscribing brings the native observer into existence', () => {
  const off = onAudioInterruption(() => {});
  expect(prepare).toHaveBeenCalled();
  off();
});

test('a build without prepare() still subscribes instead of throwing', () => {
  (NativeModules as any).AudioInterruption = {};
  const cb = jest.fn();
  const off = onAudioInterruption(cb);
  DeviceEventEmitter.emit('audioInterruption', { type: 'began' });
  expect(cb).toHaveBeenCalledWith({ type: 'began' });
  off();
});

test('both interruption edges reach the callback', () => {
  const cb = jest.fn();
  const off = onAudioInterruption(cb);
  DeviceEventEmitter.emit('audioInterruption', { type: 'began' });
  DeviceEventEmitter.emit('audioInterruption', { type: 'ended', shouldResume: true });
  expect(cb).toHaveBeenNthCalledWith(1, { type: 'began' });
  expect(cb).toHaveBeenNthCalledWith(2, { type: 'ended', shouldResume: true });
  off();
  DeviceEventEmitter.emit('audioInterruption', { type: 'began' });
  expect(cb).toHaveBeenCalledTimes(2);          // unsubscribed
});

test('an empty body from an older native build is treated as began', () => {
  const cb = jest.fn();
  const off = onAudioInterruption(cb);
  DeviceEventEmitter.emit('audioInterruption', undefined);
  expect(cb).toHaveBeenCalledWith({ type: 'began' });
  off();
});
