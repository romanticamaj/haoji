// Drop-in replacement for app/lib/theme.ts — KEEPLACE visual language for 好記.
// Source of truth: design/keeplace-style/GUIDELINE.md. Values copied from KEEPLACE src/theme/tokens.ts
// (sage on warm ivory, 1px outlines instead of shadows, radius 18). The old "Dusty Rose" key names are
// kept as aliases so every screen still compiles on day one; migrate call sites to the semantic names
// (background/surface/heading/body/muted/outline/primary/…) screen by screen, then delete the aliases.

const k = {
  background: '#F7F3EA',  // warm ivory — screen canvas
  surface: '#FFFCF7',     // cards, sheets, header buttons, bottom bars
  primary: '#73836F',     // muted sage — primary CTA, selected chip, active state
  primaryDark: '#536550', // active text/icons on light surfaces, pressed primary
  heading: '#262626',     // titles, selected tab label, dark snackbar
  body: '#343630',        // body text
  muted: '#77746E',       // secondary text, inactive icons, tab labels
  hint: '#A6A29A',        // placeholder / tertiary text (derived: between muted and outline)
  outline: '#DEDCD3',     // 1px borders and dividers
  accent: '#C58D75',      // warm peach — KEEPLACE "wishlist"; used sparingly (unnamed speaker, live recording)
  danger: '#A44E45',      // destructive text, field errors
  overlay: '#00000066',   // sheet / modal backdrop
  onPrimary: '#FFFCF7',   // text/icons on primary or heading fills
  primarySoft: '#E9EBE3', // ~15% sage over background — soft fills, done badges
  accentSoft: '#F3E6DE',  // ~15% peach over background
} as const;

export const colors = {
  ...k,
  // --- legacy aliases (Dusty Rose names) → KEEPLACE values. Remove once no screen uses them. ---
  paper: k.background,
  card: k.surface,
  ink: k.heading,
  ink2: k.muted,
  ink3: k.hint,
  hairline: k.outline,
  neutralSoft: k.outline,
  chipBg: k.surface,       // chips are now surface + 1px outline, not a filled grey
  brand: k.primary,
  brandSoft: k.primarySoft,
  brandPress: k.primaryDark,
  good: k.primaryDark,     // "done" reads as sage + check icon; no separate green
  goodSoft: k.primarySoft,
  speakerUnset: k.accent,
  speakerUnsetText: k.accent,
} as const;

export type ColorToken = keyof typeof k;

// Earthy, low-saturation speaker set that sits beside sage/ivory. Index 0 is the brand sage so a lone
// speaker reads on-brand; white initials on every entry are ≥3:1 (large/bold text).
export const speakerPalette = ['#73836F', '#7A8FA6', '#B08A5B', '#9A7F94', '#5F8F8A', '#B9775F'] as const;
export const speakerColor = (i: number) => speakerPalette[((i % speakerPalette.length) + speakerPalette.length) % speakerPalette.length];

/** 4-pt grid. */
export const spacing = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;

export const layout = {
  screenPaddingH: 20,
  screenPaddingV: 16,
  itemGap: 12,
  sectionGap: 24,
  headerTopMargin: 12,
  chipHeight: 36,
  buttonHeight: 52,
  bottomBarHeight: 70,
  bottomActionSize: 52, // the round sage action in the bottom bar
  minTouchTarget: 44,
  border: 1,
} as const;

export const radius = {
  chip: 18,
  button: 18,
  card: 18,
  sheet: 24,
  input: 12,
  round: 999,
  // legacy names
  pill: 18,
  control: 12,
} as const;

type TextStyleToken = {
  fontSize: number;
  lineHeight: number;
  fontWeight: '400' | '500' | '600' | '700';
  letterSpacing?: number;
};

export const typography = {
  display: { fontSize: 30, lineHeight: 36, fontWeight: '600' },
  screenTitle: { fontSize: 24, lineHeight: 30, fontWeight: '600' },
  section: { fontSize: 19, lineHeight: 26, fontWeight: '600' },
  cardTitle: { fontSize: 15, lineHeight: 22, fontWeight: '500' },
  body: { fontSize: 15, lineHeight: 24, fontWeight: '400' },
  small: { fontSize: 12, lineHeight: 17, fontWeight: '400' },
  /** Latin wordmark next to 好記 — wide tracking as in the KEEPLACE brand reference. */
  wordmark: { fontSize: 11, lineHeight: 14, fontWeight: '500', letterSpacing: 4 },
  tabLabel: { fontSize: 11, lineHeight: 14, fontWeight: '500' },
} as const satisfies Record<string, TextStyleToken>;

export const motion = { maxDurationMs: 250 } as const;

// Apply to any Text that shows times/durations so digits line up.
export const tabularNums = { fontVariant: ['tabular-nums' as const] };

// KEEPLACE has no drop shadows: surfaces separate from the ivory canvas with a 1px outline.
// Kept as an export so existing `...cardShadow` spreads still compile; it now draws the outline.
export const cardShadow = { borderWidth: 1, borderColor: k.outline } as const;

/** Branded copy — see GUIDELINE.md §4. Tagline is a proposal until the owner confirms it. */
export const brand = {
  nameZh: '好記',
  nameEn: 'HAOJI',
  tagline: '把說過的話，好好記下來。',
} as const;
