import React from 'react';
import { Text, type TextProps } from 'react-native';
import { colors, typography, type ColorToken } from '../lib/theme';

// The one way to put text on screen: a type variant + a colour token, never hand-written sizes or
// hex. Mirrors KEEPLACE src/components/AppText.tsx (GUIDELINE §2.2).
type Variant = keyof typeof typography;

export type AppTextProps = TextProps & {
  variant?: Variant;
  color?: ColorToken;
};

export function AppText({ variant = 'body', color = 'body', style, ...rest }: AppTextProps) {
  return <Text {...rest} style={[typography[variant], { color: colors[color] }, style]} />;
}

export default AppText;
