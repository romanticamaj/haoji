import React from 'react';
import { render } from '@testing-library/react-native';
jest.mock('../../lib/api', () => ({ analyze: jest.fn(), getModels: jest.fn().mockResolvedValue({ ok: true, models: [], default: '' }) }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn().mockResolvedValue(false), shareAsync: jest.fn() }));
jest.mock('expo-file-system/legacy', () => ({ cacheDirectory: 'file:///c/', writeAsStringAsync: jest.fn() }));
import AnalysisTab from '../AnalysisTab';
import { SavedSession } from '../../lib/store';

const s: SavedSession = { id: 's', createdAt: 1, title: 't', unlocked: true, names: {},
  notes: '## 會議摘要\n**重點**一行\n\n## 待辦\n- [ ] 做事', transcript: { speakers: [], segments: [] }, parts: [] };

test('notes render through react-native-markdown-display (heading text present)', async () => {
  const { getByText } = await render(<AnalysisTab session={s} onUpdate={() => {}} onUnlock={() => {}} />);
  // Markdown renders the heading text as a node (without the literal "## ")
  // If this passes, Markdown is stripping the "## " — plain <Text> would include it
  getByText('會議摘要');
  getByText('待辦');
});
