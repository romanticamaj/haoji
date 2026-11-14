import { zhDateTime } from '../dateFormat';

test('formats a timestamp in zh-TW: month, day, 上午/下午 and the time', () => {
  expect(zhDateTime(new Date(2026, 9, 29, 16, 31).getTime())).toBe('10月29日 下午4:31');
  expect(zhDateTime(new Date(2026, 0, 3, 9, 5).getTime())).toBe('1月3日 上午9:05');
});

test('never falls back to an en-US format', () => {
  const s = zhDateTime(new Date(2026, 6, 15, 0, 7).getTime());
  expect(s).not.toMatch(/AM|PM|\//);
  expect(s).toMatch(/^7月15日 /);
});
