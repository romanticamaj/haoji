// Jest runs in Node, but this RN project ships no Node type declarations — type just what we use.
declare const __dirname: string;
const fs: { readFileSync(p: string, enc: 'utf8'): string } = require('fs');
const path: { join(...p: string[]): string } = require('path');

// Issue #32 item 2: with the app's development region left at `en`, iOS lays CJK punctuation out
// with the Latin glyph metrics, so 「，。」 sit at the bottom-left of their cell. Declaring zh-Hant as the
// development region and the only localization makes the system pick the Traditional Chinese forms.
const IOS = path.join(__dirname, '..', '..', 'ios');
const plist = fs.readFileSync(path.join(IOS, 'Haoji', 'Info.plist'), 'utf8');
const pbx = fs.readFileSync(path.join(IOS, 'Haoji.xcodeproj', 'project.pbxproj'), 'utf8');

const plistValue = (key: string) => plist.match(new RegExp(`<key>${key}</key>\\s*(<string>[^<]*</string>|<array>[\\s\\S]*?</array>)`))?.[1];

test('Info.plist: CFBundleDevelopmentRegion is zh-Hant', () => {
  expect(plistValue('CFBundleDevelopmentRegion')).toBe('<string>zh-Hant</string>');
});

test('Info.plist: CFBundleLocalizations lists zh-Hant', () => {
  const arr = plistValue('CFBundleLocalizations') ?? '';
  expect(arr.match(/<string>([^<]*)<\/string>/g)).toEqual(['<string>zh-Hant</string>']);
});

test('Xcode project: zh-Hant is the development region and a known region', () => {
  expect(pbx).toMatch(/developmentRegion = "zh-Hant";/);
  const known = pbx.match(/knownRegions = \(([^)]*)\);/)?.[1] ?? '';
  expect(known).toMatch(/"zh-Hant"/);
  expect(known).toMatch(/Base/);
});
