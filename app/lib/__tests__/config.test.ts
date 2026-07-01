jest.mock('react-native-config', () => ({ API_BASE: 'http://example.test:8780' }));
import { API_BASE } from '../config';

test('API_BASE comes from native config', () => {
  expect(API_BASE).toBe('http://example.test:8780');
});
