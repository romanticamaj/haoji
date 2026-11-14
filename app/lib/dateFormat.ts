// zh-TW date + time for titles the app writes itself: 「10月29日 下午4:31」.
// `toLocaleString()` follows the device/JS-engine default and produced en-US stamps such as
// "10/29/2026, 4:31:07 PM" in the middle of Chinese copy.
const FMT = new Intl.DateTimeFormat('zh-TW', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function zhDateTime(ts: number): string {
  return FMT.format(new Date(ts));
}
