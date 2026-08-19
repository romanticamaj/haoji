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
