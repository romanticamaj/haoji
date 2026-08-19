import React from 'react';
import { render } from '@testing-library/react-native';
jest.mock('../../lib/api', () => ({ analyze: jest.fn(), getModels: jest.fn().mockResolvedValue({ ok: true, models: [], default: '' }) }));
jest.mock('@react-native-clipboard/clipboard', () => ({ setString: jest.fn() }));
jest.mock('react-native-share', () => ({ open: jest.fn().mockResolvedValue({}) }));
jest.mock('react-native-fs', () => ({ DocumentDirectoryPath: '/doc', writeFile: jest.fn().mockResolvedValue(undefined), unlink: jest.fn().mockResolvedValue(undefined) }));
import AnalysisTab from '../AnalysisTab';
import { StoreProvider } from '../../lib/store-context';
import { createMemoryStore, SavedSession } from '../../lib/store';

const s: SavedSession = { id: 's', createdAt: 1, title: 't', unlocked: true, names: {},
  notes: '## 會議摘要\n**重點**一行\n\n## 待辦\n- [ ] 做事', transcript: { speakers: [], segments: [] }, parts: [] };

test('notes render through react-native-markdown-display (heading text present)', async () => {
  const { getByText } = await render(
    <StoreProvider store={createMemoryStore([s])}>
      <AnalysisTab session={s} onUpdate={() => {}} onUnlock={() => {}} />
    </StoreProvider>);
  // Markdown renders the heading text as a node (without the literal "## ")
  // If this passes, Markdown is stripping the "## " — plain <Text> would include it
  getByText('會議摘要');
  getByText('待辦');
});
