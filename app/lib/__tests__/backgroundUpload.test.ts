import { taskIdFor, parseTaskId, available } from '../backgroundUpload';

test('taskId round-trips a session id that itself contains colons', () => {
  expect(taskIdFor('local-1', 2)).toBe('local-1:2');
  expect(parseTaskId('local-1:2')).toEqual({ sessionId: 'local-1', index: 2 });
  // ids are generated as `local-<ts>-<rand>` but be safe: split on the LAST colon
  expect(parseTaskId('a:b:7')).toEqual({ sessionId: 'a:b', index: 7 });
});

test('malformed task ids are rejected rather than producing a bogus index', () => {
  expect(parseTaskId('nocolon')).toBeNull();
  expect(parseTaskId(':3')).toBeNull();
  expect(parseTaskId('local-1:abc')).toBeNull();
});

test('degrades gracefully when the native module is absent (jest/Android)', () => {
  expect(available).toBe(false);   // no native module in tests → callers use the foreground upload
});

describe('enqueue with the pairing token', () => {
  const load = (native: any) => {
    let mod: any;
    jest.isolateModules(() => {
      const RN = require('react-native');
      RN.Platform.OS = 'ios';
      RN.NativeModules.BackgroundUpload = native;
      mod = require('../backgroundUpload');
    });
    return mod;
  };

  test('passes the Bearer header to the native uploader when it supports headers', async () => {
    const native = { enqueue: jest.fn(), enqueueWithHeaders: jest.fn(async () => 't'), pendingTasks: jest.fn() };
    const m = load(native);
    await m.enqueue('http://h/p/0', 'file:///a.wav', 's:0', { Authorization: 'Bearer x' });
    expect(native.enqueueWithHeaders).toHaveBeenCalledWith('http://h/p/0', 'file:///a.wav', 's:0', { Authorization: 'Bearer x' });
    expect(native.enqueue).not.toHaveBeenCalled();
  });

  test('without headers (or an older native build) uses the plain enqueue', async () => {
    const native = { enqueue: jest.fn(async () => 't'), pendingTasks: jest.fn() };
    const m = load(native);
    await m.enqueue('http://h/p/0', 'file:///a.wav', 's:0', { Authorization: 'Bearer x' });
    await m.enqueue('http://h/p/1', 'file:///b.wav', 's:1');
    expect(native.enqueue).toHaveBeenCalledTimes(2);
  });
});
