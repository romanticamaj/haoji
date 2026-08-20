import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SavedSession } from './lib/store';

export type RootStackParamList = {
  Home: undefined;
  // appendTo = an existing meeting id: the take is added to it rather than starting a new meeting.
  Record: { appendTo?: string } | undefined;
  // Picked files, before committing: confirm what they actually are and whether to join them.
  ImportConfirm: { files: { uri: string; name: string }[] };
  // After recording stops we land here to listen back and decide whether to analyze or discard.
  Review: { sessionId: string };
  Processing: { sessionId: string; regen?: boolean };
  // `session` is an optional preloaded snapshot (the Home list already has it) so Results can render
  // fully during the push animation instead of flashing an empty loading state while it reads storage.
  Results: { sessionId: string; session?: SavedSession };
};

export const Stack = createNativeStackNavigator<RootStackParamList>();
