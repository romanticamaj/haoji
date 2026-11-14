import React from 'react';
import { Platform, Text, type TextProps } from 'react-native';
import { colors, typography, type ColorToken } from '../lib/theme';

// The one way to put text on screen: a type variant + a colour token, never hand-written sizes or
// hex. Mirrors KEEPLACE src/components/AppText.tsx (GUIDELINE §2.2).
type Variant = keyof typeof typography;

export type AppTextProps = TextProps & {
  variant?: Variant;
  color?: ColorToken;
};

// Android pads Text above and below for accents CJK never uses, which pushes 中文 off the optical
// centre of buttons and rows; iOS has no such padding.
const ANDROID_TEXT = { includeFontPadding: false } as const;

export function AppText({ variant = 'body', color = 'body', style, ...rest }: AppTextProps) {
  return (
    <Text
      {...rest}
      style={[typography[variant], { color: colors[color] }, Platform.OS === 'android' && ANDROID_TEXT, style]}
    />
  );
}

export default AppText;
