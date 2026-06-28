import { createNativeStackNavigator } from '@react-navigation/native-stack';

export type RootStackParamList = {
  Home: undefined;
  Record: undefined;
  Processing: { sessionId: string };
  Results: { sessionId: string };
};

export const Stack = createNativeStackNavigator<RootStackParamList>();
