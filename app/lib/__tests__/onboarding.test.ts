import AsyncStorage from '@react-native-async-storage/async-storage';
import { isOnboarded, setOnboarded, shouldShowOnboarding, ONBOARDED_KEY } from '../store';
import * as server from '../server';
import * as config from '../config';

beforeEach(async () => { await server.forgetServer(); await AsyncStorage.clear(); });
afterEach(() => jest.restoreAllMocks());

test('the flag lives at haoji.onboarded and starts false', async () => {
  expect(ONBOARDED_KEY).toBe('haoji.onboarded');
  expect(await isOnboarded()).toBe(false);
  await setOnboarded();
  expect(await isOnboarded()).toBe(true);
  expect(await AsyncStorage.getItem('haoji.onboarded')).toBe('1');
});

test('shown on a fresh, unpaired install', async () => {
  jest.replaceProperty(config, 'API_BASE', null);
  expect(await shouldShowOnboarding()).toBe(true);
});

test('not shown once onboarded (even if still unpaired)', async () => {
  jest.replaceProperty(config, 'API_BASE', null);
  await setOnboarded();
  expect(await shouldShowOnboarding()).toBe(false);
});

test('not shown when paired', async () => {
  jest.replaceProperty(config, 'API_BASE', null);
  await server.saveServer({ url: 'http://box:7780', pairedAt: 1 });
  expect(await shouldShowOnboarding()).toBe(false);
});

test('not shown when the build already points at a server', async () => {
  expect(await shouldShowOnboarding()).toBe(false);   // jest-setup's API_BASE
});
