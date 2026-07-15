import React from 'react';
import Svg, { Path, Rect, Circle, Line, Polyline, Polygon } from 'react-native-svg';
import { colors } from '../lib/theme';

// Small hand-drawn icon set (Feather-style 24×24 stroke paths) so the UI has NO emoji — every glyph
// is a crisp vector that scales and takes the palette. Stroke icons take `color`; solid icons (play/
// pause) take `color` as fill. Keep additions here so screens import from one place.
export type IconProps = { size?: number; color?: string; strokeWidth?: number };

const Stroke = ({ size = 24, color = colors.ink, strokeWidth = 2, children }: IconProps & { children: React.ReactNode }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
    {children}
  </Svg>
);

// Solid play triangle (fill) — for the rose play button.
export const IconPlay = ({ size = 24, color = '#fff' }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24"><Polygon points="6 4 20 12 6 20 6 4" fill={color} /></Svg>
);

// Solid pause bars (fill).
export const IconPause = ({ size = 24, color = '#fff' }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Rect x="6" y="4" width="4.2" height="16" rx="1.4" fill={color} />
    <Rect x="13.8" y="4" width="4.2" height="16" rx="1.4" fill={color} />
  </Svg>
);

// Circular "rewind" arrow (counter-clockwise) — skip back. Number is overlaid by the caller.
export const IconRewind = ({ size = 24, color = colors.ink, strokeWidth = 2 }: IconProps) => (
  <Stroke size={size} color={color} strokeWidth={strokeWidth}>
    <Polyline points="1 4 1 10 7 10" />
    <Path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
  </Stroke>
);

// Circular "fast-forward" arrow (clockwise) — skip forward. Number is overlaid by the caller.
export const IconForward = ({ size = 24, color = colors.ink, strokeWidth = 2 }: IconProps) => (
  <Stroke size={size} color={color} strokeWidth={strokeWidth}>
    <Polyline points="23 4 23 10 17 10" />
    <Path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
  </Stroke>
);

// Warning triangle with exclamation — for a missing/unreadable audio file.
export const IconAlert = ({ size = 24, color = colors.brand, strokeWidth = 2 }: IconProps) => (
  <Stroke size={size} color={color} strokeWidth={strokeWidth}>
    <Path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <Line x1="12" y1="9" x2="12" y2="13.5" />
    <Line x1="12" y1="17" x2="12.01" y2="17" />
  </Stroke>
);

// Pencil — rename affordance.
export const IconPencil = ({ size = 24, color = colors.ink, strokeWidth = 2 }: IconProps) => (
  <Stroke size={size} color={color} strokeWidth={strokeWidth}>
    <Path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
  </Stroke>
);

// Check — copy-success / confirmation feedback.
export const IconCheck = ({ size = 24, color = colors.good, strokeWidth = 2.4 }: IconProps) => (
  <Stroke size={size} color={color} strokeWidth={strokeWidth}>
    <Polyline points="20 6 9 17 4 12" />
  </Stroke>
);

// Padlock — the IAP paywall.
export const IconLock = ({ size = 24, color = colors.brand, strokeWidth = 2 }: IconProps) => (
  <Stroke size={size} color={color} strokeWidth={strokeWidth}>
    <Rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <Path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </Stroke>
);

// Photo/library — the "從圖庫選影片" action.
export const IconImage = ({ size = 24, color = '#fff', strokeWidth = 2 }: IconProps) => (
  <Stroke size={size} color={color} strokeWidth={strokeWidth}>
    <Rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <Circle cx="8.5" cy="8.5" r="1.5" />
    <Polyline points="21 15 16 10 5 21" />
  </Stroke>
);
