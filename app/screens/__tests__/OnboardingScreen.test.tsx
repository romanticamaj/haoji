import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const mockNavigate = jest.fn();
const mockReplace = jest.fn();
jest.mock('@react-navigation/native', () => {
  const nav = { navigate: (...a: any[]) => mockNavigate(...a), replace: (...a: any[]) => mockReplace(...a) };
  return { useNavigation: () => nav };
});

import OnboardingScreen from '../OnboardingScreen';
import { isOnboarded } from '../../lib/store';

beforeEach(async () => { jest.clearAllMocks(); await AsyncStorage.clear(); });

test('three cards: what it is, where it runs, connect', async () => {
  const { getByText } = await render(<OnboardingScreen />);
  getByText('把說過的話，好好記下來。');
  getByText('逐字稿在你自己的主機上處理，不經過任何雲端。');
  getByText('連接你的主機');
});

test('skip sets the flag and lands on Home (recording still works)', async () => {
  const { getByRole } = await render(<OnboardingScreen />);
  await fireEvent.press(getByRole('button', { name: '先不用，直接錄音' }));
  expect(await isOnboarded()).toBe(true);
  expect(mockNavigate).toHaveBeenCalledWith('Home');
});

test('connect sets the flag and opens Pair in its place', async () => {
  const { getByRole } = await render(<OnboardingScreen />);
  await fireEvent.press(getByRole('button', { name: '掃描或輸入網址' }));
  expect(await isOnboarded()).toBe(true);
  expect(mockReplace).toHaveBeenCalledWith('Pair');
});
