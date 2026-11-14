// The mapping table is the whole contract: three feelings, never per scroll (spec §5.3 E).
const mockTrigger = jest.fn();
jest.mock('react-native-haptic-feedback', () => ({ __esModule: true, default: { trigger: (...a: any[]) => mockTrigger(...a) } }));

import { haptic, HAPTIC_MAP } from '../haptics';

beforeEach(() => mockTrigger.mockReset());

test('mapping table: light for start/pause/tab, success for stop/ready, warning for delete', () => {
  expect(HAPTIC_MAP).toEqual({
    recordStart: 'impactLight',
    pause: 'impactLight',
    tab: 'impactLight',
    recordStop: 'notificationSuccess',
    ready: 'notificationSuccess',
    delete: 'notificationWarning',
  });
});

test.each(Object.entries({
  recordStart: 'impactLight', pause: 'impactLight', tab: 'impactLight',
  recordStop: 'notificationSuccess', ready: 'notificationSuccess', delete: 'notificationWarning',
}))('haptic(%s) triggers %s', (event, type) => {
  haptic(event as any);
  expect(mockTrigger).toHaveBeenCalledTimes(1);
  expect(mockTrigger.mock.calls[0][0]).toBe(type);
});

test('a throwing native module is swallowed', () => {
  mockTrigger.mockImplementation(() => { throw new Error('no native module'); });
  expect(() => haptic('tab')).not.toThrow();
});
