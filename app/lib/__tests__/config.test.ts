import { API_BASE } from '../config';

test('API_BASE is a non-empty http url', () => {
  expect(typeof API_BASE).toBe('string');
  expect(API_BASE).toMatch(/^https?:\/\//);
});
