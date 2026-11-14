import { linking } from '../linking';

const pairing = require('../../../backend/tests/fixtures/contracts/pairing.json');
const state = (url: string) => linking.getStateFromPath!(url.replace(/^haoji:\/\//, ''), linking.config as any) as any;
const top = (s: any) => s.routes[s.routes.length - 1];

test('haoji://pair opens Pair with the url and token prefilled, Home underneath', () => {
  const s = state(pairing.qr_payload);
  expect(s.routes.map((r: any) => r.name)).toEqual(['Home', 'Pair']);
  expect(top(s).params).toEqual({ url: 'http://100.64.0.5:7780', token: 'pTk_example_token_value' });
});

test('a bad pair link opens Pair with the reason instead of a prefilled address', () => {
  const s = state('haoji://pair?url=javascript%3Aalert(1)&token=t');
  expect(top(s)).toMatchObject({ name: 'Pair', params: { error: '這不是好記主機的配對連結。' } });
  expect(top(s).params.url).toBeUndefined();
});

test('e2e hook URLs never reach navigation (they are handled natively)', () => {
  expect(linking.filter!('haoji://e2e/interrupt?type=began')).toBe(false);
  expect(linking.filter!('haoji://E2E/deactivate')).toBe(false);
  expect(linking.filter!(pairing.qr_payload)).toBe(true);
});

test('only the haoji:// scheme is linked', () => {
  expect(linking.prefixes).toEqual(['haoji://']);
});
