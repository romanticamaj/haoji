import { NativeModules, DeviceEventEmitter, Platform } from 'react-native';

// A tap must open the meeting exactly once, whether it launched the app or arrived while running.
const mockAttach = jest.fn();
beforeEach(() => {
  jest.resetModules();
  Platform.OS = 'ios';
  (NativeModules as any).PushNotifications = { register: jest.fn(), attach: mockAttach };
});

test('the tap that launched the app is delivered once JS attaches', async () => {
  mockAttach.mockResolvedValue('local-9');
  const push = require('../push');
  const cb = jest.fn();
  push.onOpen(cb);
  await new Promise((r) => setTimeout(r, 0));
  expect(cb).toHaveBeenCalledWith('local-9');
});

test('a tap while running arrives as an event; unsubscribing stops delivery', async () => {
  mockAttach.mockResolvedValue(null);
  const push = require('../push');
  const cb = jest.fn();
  const off = push.onOpen(cb);
  await new Promise((r) => setTimeout(r, 0));
  expect(cb).not.toHaveBeenCalled();

  DeviceEventEmitter.emit('pushOpened', { session: 'local-3' });
  expect(cb).toHaveBeenCalledWith('local-3');
  off();
  DeviceEventEmitter.emit('pushOpened', { session: 'local-4' });
  expect(cb).toHaveBeenCalledTimes(1);
});

test('register never rejects — a failure just means no notification', async () => {
  (NativeModules as any).PushNotifications.register.mockRejectedValue(new Error('nope'));
  const push = require('../push');
  await expect(push.register()).resolves.toBeNull();
});
