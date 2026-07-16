// jest-expo is gone; provide the mocks its preset used to supply.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

// reanimated must be mocked in jest (native module unavailable)
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));

// react-native-config is a native module; give tests a default backend base URL
jest.mock('react-native-config', () => ({ API_BASE: 'http://127.0.0.1:8780' }));

// react-native-fs constructs a NativeEventEmitter at import → crashes in jest without a
// native module. Provide a default surface so any suite that transitively imports it loads.
// Suites that assert fs calls (recordings/AnalysisTab) declare their own jest.mock and win.
jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/doc',
  CachesDirectoryPath: '/cache',
  mkdir: jest.fn().mockResolvedValue(undefined),
  exists: jest.fn().mockResolvedValue(false),
  moveFile: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
}));

// react-native-safe-area-context needs a provider at runtime; give tests zero insets so screens
// using useSafeAreaInsets() (e.g. RecordScreen) render without a SafeAreaProvider wrapper.
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const inset = { top: 0, right: 0, bottom: 0, left: 0 };
  const frame = { x: 0, y: 0, width: 390, height: 844 };
  return {
    SafeAreaProvider: ({ children }) => children,
    SafeAreaConsumer: ({ children }) => children(inset),
    SafeAreaView: ({ children }) => children,
    useSafeAreaInsets: () => inset,
    useSafeAreaFrame: () => frame,
    SafeAreaInsetsContext: React.createContext(inset),
  };
});

// react-native-image-picker is a native module; default to a cancelled pick. Suites that exercise
// the 圖庫 video path (RecordScreen) override launchImageLibrary per-test.
jest.mock('react-native-image-picker', () => ({
  launchImageLibrary: jest.fn().mockResolvedValue({ didCancel: true }),
}));

// react-native-audio-waveform is a native module (the audio player). Mock the Waveform component as a
// forwardRef View whose imperative player methods drive onPlayerStateChange, plus a useAudioPlayer
// hook exposing shared seek/stop spies. Suites can import useAudioPlayer to assert on seekToPlayer.
jest.mock('@simform_solutions/react-native-audio-waveform', () => {
  const React = require('react');
  const { View } = require('react-native');
  const PlayerState = { playing: 'playing', paused: 'paused', stopped: 'stopped' };
  const RecorderState = { recording: 'recording', paused: 'paused', stopped: 'stopped' };
  const FinishMode = { loop: 0, pause: 1, stop: 2 };
  const seekToPlayer = jest.fn().mockResolvedValue(true);
  const stopAllPlayers = jest.fn().mockResolvedValue(true);
  const Waveform = React.forwardRef((props, ref) => {
    React.useImperativeHandle(ref, () => ({
      startPlayer: jest.fn(async () => { props.onPlayerStateChange && props.onPlayerStateChange(PlayerState.playing); return true; }),
      pausePlayer: jest.fn(async () => { props.onPlayerStateChange && props.onPlayerStateChange(PlayerState.paused); return true; }),
      resumePlayer: jest.fn(async () => { props.onPlayerStateChange && props.onPlayerStateChange(PlayerState.playing); return true; }),
      stopPlayer: jest.fn(async () => { props.onPlayerStateChange && props.onPlayerStateChange(PlayerState.stopped); return true; }),
      currentState: PlayerState.stopped,
      playerKey: 'PlayerFor' + props.path,
    }));
    return React.createElement(View, { testID: 'waveform', accessibilityLabel: 'waveform-' + props.path });
  });
  return {
    Waveform,
    FinishMode,
    PlayerState,
    RecorderState,
    UpdateFrequency: {},
    useAudioPlayer: () => ({ seekToPlayer, stopAllPlayers }),
    useAudioPermission: () => ({}),
  };
});

// Clipboard + Share are native modules used by several screens (transcript/notes copy, recording
// export). Mock them globally so any suite that renders those screens works; suites that assert on
// the calls declare their own jest.mock and win.
jest.mock('@react-native-clipboard/clipboard', () => ({ setString: jest.fn(), getString: jest.fn() }));
jest.mock('react-native-share', () => ({ open: jest.fn().mockResolvedValue({}) }));

// nitro-sound / picker get per-suite mocks in their tests
