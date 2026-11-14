import { parsePairLink, PAIR_LINK_ERROR } from '../pairLink';

const pairing = require('../../../backend/tests/fixtures/contracts/pairing.json');

test('parses the backend qr_payload (url-encoded url + token)', () => {
  expect(parsePairLink(pairing.qr_payload)).toEqual({ url: 'http://100.64.0.5:7780', token: 'pTk_example_token_value' });
});

test('token is optional (server that does not require one)', () => {
  expect(parsePairLink('haoji://pair?url=http%3A%2F%2Fbox%3A7780')).toEqual({ url: 'http://box:7780' });
});

test('an empty token is treated as no token', () => {
  expect(parsePairLink('haoji://pair?url=http%3A%2F%2Fbox%3A7780&token=')).toEqual({ url: 'http://box:7780' });
});

test('parameter order does not matter and the url is normalised', () => {
  expect(parsePairLink('haoji://pair?token=t%2Bx&url=https%3A%2F%2Fbox.ts.net%2F'))
    .toEqual({ url: 'https://box.ts.net', token: 't+x' });
});

test('pairLink rejects non-http', () => {
  for (const bad of [
    'haoji://pair?url=javascript%3Aalert(1)&token=t',
    'haoji://pair?url=javascript:alert(1)&token=t',
    'haoji://pair?url=ftp%3A%2F%2Fbox&token=t',
    'haoji://pair?url=file%3A%2F%2F%2Fetc%2Fpasswd',
  ]) {
    expect(parsePairLink(bad)).toEqual({ error: '這不是好記主機的配對連結。' });
  }
});

test('rejects links that are not a haoji pair link', () => {
  for (const bad of [
    '', 'https://example.com/pair?url=http%3A%2F%2Fbox',
    'haoji://e2e/interrupt?type=began',
    'haoji://pair', 'haoji://pair?token=t', 'haoji://pair?url=',
    'haoji://pair?url=%E0%A4%A',   // malformed percent-encoding
  ]) {
    expect(parsePairLink(bad)).toEqual({ error: PAIR_LINK_ERROR });
  }
  expect(PAIR_LINK_ERROR).toBe('這不是好記主機的配對連結。');
});
