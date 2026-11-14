// A build without API_BASE in .env (e.g. a self-hoster's own build) must start unpaired rather than
// silently pointing at someone else's address.
jest.mock('react-native-config', () => ({}));
import { API_BASE } from '../config';

test('no build-time API_BASE → null (no hardcoded fallback address)', () => {
  expect(API_BASE).toBeNull();
});
