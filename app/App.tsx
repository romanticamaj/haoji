import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Stack } from './navigation';
import { StoreProvider } from './lib/store-context';
import HomeScreen from './screens/HomeScreen';
import RecordScreen from './screens/RecordScreen';
import ProcessingScreen from './screens/ProcessingScreen';
import ResultsScreen from './screens/ResultsScreen';

export default function App() {
  return (
    <SafeAreaProvider>
      <StoreProvider>
        <NavigationContainer>
          <Stack.Navigator screenOptions={{ headerShadowVisible: false, headerTintColor: '#E5342B', title: '好記' }}>
            <Stack.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
            <Stack.Screen name="Record" component={RecordScreen} options={{ title: '錄音' }} />
            <Stack.Screen name="Processing" component={ProcessingScreen} options={{ title: '分析中', headerBackVisible: false }} />
            <Stack.Screen name="Results" component={ResultsScreen} options={{ title: '結果' }} />
          </Stack.Navigator>
        </NavigationContainer>
      </StoreProvider>
    </SafeAreaProvider>
  );
}
