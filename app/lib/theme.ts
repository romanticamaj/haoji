// Central design tokens. Palette: "Dusty Rose" (approved 2026-07) — a muted, earthy terracotta-rose
// brand at lower saturation/brightness than the old fire-red, on warm-biased neutrals. The brand is
// for primary actions & accents; neutrals carry a warm (not cool) bias so the whole UI reads calm and
// modern; status uses a muted green; speakers get a low-saturation macaron hue set.
export const colors = {
  paper: '#F5F1EE',      // screen canvas — warm off-white
  card: '#FFFFFF',       // raised surfaces (cards, sheets, player)
  ink: '#322A2C',        // primary text — warm near-black
  ink2: '#8A7E80',       // secondary text — warm grey
  ink3: '#B9AEAF',       // tertiary text / hints — light warm grey
  hairline: '#EAE1DD',   // dividers / faint borders
  neutralSoft: '#E4DCD8', // filled neutral chips, avatar-overflow, grab handles
  brand: '#C86A5C',      // dusty rose — primary
  brandSoft: '#F5E4E0',  // brand tint background (soft fill behind brand accents)
  brandPress: '#B2564A', // brand pressed
  good: '#5AA98B',       // status: done / success — muted green
  goodSoft: '#E6F1EB',
  chipBg: '#EDE6E2',     // warm neutral chips
  speakerUnset: '#E3A79E',     // rose used for an as-yet-unassigned speaker chip/avatar
  speakerUnsetText: '#C0796F', // hint text paired with speakerUnset
} as const;

// Distinct-but-calm macaron hue set for diarized speakers; index by speaker order. Lower saturation
// to sit beside the Dusty Rose brand (last entry IS the brand, so a lone speaker reads on-brand).
export const speakerPalette = ['#7B9DC4', '#79BD9C', '#DDAE73', '#B49BD0', '#6FB6BC', '#C86A5C'] as const;
export const speakerColor = (i: number) => speakerPalette[((i % speakerPalette.length) + speakerPalette.length) % speakerPalette.length];

export const radius = { card: 16, pill: 20, sheet: 22, control: 12 } as const;

// Apply to any Text that shows times/durations so digits line up.
export const tabularNums = { fontVariant: ['tabular-nums' as const] };

// Soft card elevation used across list/detail surfaces. Warm-tinted shadow to match the palette.
export const cardShadow = {
  shadowColor: '#3A2A26',
  shadowOpacity: 0.08,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 6 },
  elevation: 2,
} as const;
