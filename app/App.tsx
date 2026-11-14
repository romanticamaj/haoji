import React, { useEffect } from 'react';
import { Linking } from 'react-native';
import {
  NavigationContainer, DefaultTheme, type Theme, createNavigationContainerRef,
} from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Stack, RootStackParamList } from './navigation';
import { StoreProvider, useStore } from './lib/store-context';
import * as push from './lib/push';
import { colors } from './lib/theme';
import HomeScreen from './screens/HomeScreen';
import RecordScreen from './screens/RecordScreen';
import ImportConfirmScreen from './screens/ImportConfirmScreen';
import ReviewScreen from './screens/ReviewScreen';
import ProcessingScreen from './screens/ProcessingScreen';
import ResultsScreen from './screens/ResultsScreen';
import SettingsScreen from './screens/SettingsScreen';
import PairScreen from './screens/PairScreen';
import OnboardingScreen from './screens/OnboardingScreen';
import { linking } from './lib/linking';
import { shouldShowOnboarding } from './lib/store';

// Paint every scene with the app's paper background from frame one. Without this the native push
// briefly reveals the default (black) window layer behind the incoming screen, which read as buttons
// "flashing black" mid-transition. Setting the theme's background + card (header) fixes it globally.
const navTheme: Theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.background,
    card: colors.background,
    primary: colors.primary,
    text: colors.heading,
    border: colors.outline,
  },
};

const navRef = createNavigationContainerRef<RootStackParamList>();

/**
 * Tapping "逐字稿完成" opens that meeting — whether the tap launched the app or arrived while it was
 * running. A meeting deleted since the push was sent is simply ignored.
 */
function PushOpener({ ready }: { ready: boolean }) {
  const store = useStore();
  useEffect(() => {
    if (!ready) return;           // attach only once navigation can take us there
    return push.onOpen(async (sessionId) => {
      const s = await store.get(sessionId);
      if (s && navRef.isReady()) navRef.navigate('Results', { sessionId, session: s });
    });
  }, [ready, store]);
  return null;
}

/**
 * First run: show Onboarding once, only when the phone is neither onboarded nor pointed at a server.
 * A launch from a pair link goes straight to Pair instead — that person already has a server.
 */
function OnboardingGate({ ready }: { ready: boolean }) {
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    (async () => {
      const initial = await Linking.getInitialURL().catch(() => null);
      if (initial && /^haoji:\/\/pair/i.test(initial)) return;
      if (alive && (await shouldShowOnboarding()) && navRef.isReady()) navRef.navigate('Onboarding');
    })();
    return () => { alive = false; };
  }, [ready]);
  return null;
}

export default function App() {
  const [navReady, setNavReady] = React.useState(false);
  return (
    <SafeAreaProvider>
      <StoreProvider>
        <PushOpener ready={navReady} />
        <OnboardingGate ready={navReady} />
        {/* linking: haoji://pair → Pair (prefilled). haoji://e2e/… is consumed natively and filtered out. */}
        <NavigationContainer theme={navTheme} ref={navRef} linking={linking} onReady={() => setNavReady(true)}>
          <Stack.Navigator
            screenOptions={{
              // KEEPLACE native header: ivory, no shadow, 17/600 heading title, chevron-only back.
              headerShadowVisible: false,
              headerTintColor: colors.heading,
              headerStyle: { backgroundColor: colors.background },
              headerTitleStyle: { fontSize: 17, fontWeight: '600', color: colors.heading },
              headerBackButtonDisplayMode: 'minimal',
              // Belt-and-suspenders with the theme: the scene container is explicitly paper so there's
              // never an unpainted (black) frame during the slide-in.
              contentStyle: { backgroundColor: colors.background },
              title: '好記',
            }}
          >
            {/* Home keeps its custom in-body title, but we give it an invisible (transparent, empty)
                native header so the header is PRESENT on every screen. Popping from a screen with a
                header to one without forced react-native-screens to animate the header away, which is
                when the back button + pencil flashed dark during the swipe. Symmetric headers = no flash. */}
            <Stack.Screen
              name="Home"
              component={HomeScreen}
              options={{ headerTransparent: true, headerTitle: '', headerStyle: { backgroundColor: 'transparent' } }}
            />
            <Stack.Screen name="Record" component={RecordScreen} options={{ title: '錄音' }} />
            <Stack.Screen name="ImportConfirm" component={ImportConfirmScreen} options={{ title: '確認音檔' }} />
            <Stack.Screen name="Review" component={ReviewScreen} options={{ title: '錄音檢視', headerBackVisible: false }} />
            <Stack.Screen name="Processing" component={ProcessingScreen} options={{ title: '整理中', headerBackVisible: false }} />
            <Stack.Screen name="Results" component={ResultsScreen} options={{ title: '' }} />
            <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: '設定' }} />
            <Stack.Screen name="Pair" component={PairScreen} options={{ title: '連接主機' }} />
            <Stack.Screen
              name="Onboarding"
              component={OnboardingScreen}
              options={{ headerShown: false, presentation: 'fullScreenModal', gestureEnabled: false }}
            />
          </Stack.Navigator>
        </NavigationContainer>
      </StoreProvider>
    </SafeAreaProvider>
  );
}
