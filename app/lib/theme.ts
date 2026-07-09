// Central design tokens for the presentation-level redesign. Derived from the approved mockup
// (docs/spec/2026-07-redesign-goal.md). Keep the red brand for accents only; neutrals are chosen
// (slight cool bias), status uses a semantic green, and speakers get a calm 6-hue set.
export const colors = {
  paper: '#F4F4F7',
  card: '#FFFFFF',
  ink: '#16161A',
  ink2: '#6E6E76',
  ink3: '#A2A2AC',
  hairline: '#EAEAEF',
  brand: '#E5342B',
  brandSoft: '#FDECEA',
  brandPress: '#C42A22',
  good: '#1FA971',
  goodSoft: '#E7F6EF',
  chipBg: '#F2F2F7',
} as const;

// Distinct-but-calm palette for diarized speakers; index by speaker order.
export const speakerPalette = ['#2C6BED', '#12A150', '#DE8500', '#8256E0', '#0E9AA5', '#E5342B'] as const;
export const speakerColor = (i: number) => speakerPalette[((i % speakerPalette.length) + speakerPalette.length) % speakerPalette.length];

export const radius = { card: 16, pill: 20, sheet: 22, control: 12 } as const;

// Apply to any Text that shows times/durations so digits line up.
export const tabularNums = { fontVariant: ['tabular-nums' as const] };

// Soft card elevation used across list/detail surfaces.
export const cardShadow = {
  shadowColor: '#141423',
  shadowOpacity: 0.06,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 6 },
  elevation: 2,
} as const;
