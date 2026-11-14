# 好記 × KEEPLACE 設計規範

This guideline makes 好記 look, read and behave like **留著 KEEPLACE**, the owner's other app (`~/keeplace`).
It covers the visual style, design patterns, logo, icons and wording. It replaces the 2026-07 "Dusty Rose" tokens.

Everything below comes from KEEPLACE's shipped code: `src/theme/tokens.ts`, `src/components/*`, `design/02_DESIGN_SYSTEM.md` and `scripts/brand/make_icons.py`.
Read it next to the references in this folder.

| File | What it is |
|---|---|
| `references/keeplace-brand-reference.png` | Brand board: mark, wordmark, tagline voice, five screens. It sets the mood but is not a measured spec. |
| `references/keeplace-six-screen-reference.png` | Concept board for the six screens. |
| `references/screens/keeplace_ios_*.png` | Real KEEPLACE iOS simulator screenshots: home, empty state, form, settings, bottom sheet, suggestion card, detail, timeline. **These are the ground truth for spacing, type and colour.** |
| `theme.ts` | Drop-in replacement for `app/lib/theme.ts`. It keeps the old key names as aliases so nothing breaks on day one. |
| `brand/make_icons.py`, `brand/out/` | 好記 app-icon generator in the KEEPLACE line style, plus the rendered iOS/Android/splash PNGs. |

How to read the rules: **must** means keep it exactly. **Should** is the default; break it only with a written reason in the commit or spec.

---

## 1. Principles (what makes it feel like KEEPLACE)

1. **Calm and warm, never loud.** Warm ivory canvas, one muted sage for actions, and a peach accent used rarely. There is no bright red, no gradients, no glow.
2. **Flat with outlines.** Surfaces separate from the canvas with a **1px `outline` border, not shadows**. Corners are generously rounded (18).
3. **Editorial hierarchy.** One big title per screen and plenty of white space. Secondary information is small and `muted`, and type weight does the work.
4. **Quiet icons.** One thin-stroke icon family (Lucide, 1.8 stroke). Icons sit in 44pt round outlined buttons or inline with text, never in coloured tiles. No emoji in the UI.
5. **Speaks like a friend who keeps your things.** Short, warm sentences that address the user as 「你」. The copy always says what happens to the user's data (see §5).
6. **Local-first reassurance.** Every destructive or failing action says what is **kept**, as well as what goes.

## 2. Tokens

`theme.ts` in this folder is the source. Copy it over `app/lib/theme.ts`.

### 2.1 Colour

| Token | Hex | Use in 好記 | Replaces |
|---|---|---|---|
| `background` | `#F7F3EA` | Every screen canvas, nav header background | `paper` |
| `surface` | `#FFFCF7` | Cards, sheets, round header buttons, chips, bottom bar, player | `card` |
| `primary` | `#73836F` | Primary CTA fill, record button, selected chip, progress, waveform played part | `brand` |
| `primaryDark` | `#536550` | Active text and icons, "done" ticks, pressed primary, links | `brandPress`, `good` |
| `heading` | `#262626` | Titles, selected tab label and underline, dark snackbar | `ink` |
| `body` | `#343630` | Paragraphs, transcript text | — |
| `muted` | `#6F6C66` | Secondary text, timestamps, inactive icons | `ink2` |
| `hint` | `#A6A29A` | Placeholders only (2.3:1 contrast, so never for information) | `ink3` |
| `outline` | `#DEDCD3` | All borders and dividers | `hairline`, `neutralSoft` |
| `accent` | `#C58D75` | **Sparingly**: unnamed-speaker chip, live "recording" dot and timer | `speakerUnset` |
| `danger` | `#A44E45` | Destructive labels, field errors | — |
| `primarySoft` / `accentSoft` | `#E9EBE3` / `#F3E6DE` | Soft fills: status badge background, placeholders | `brandSoft`, `goodSoft` |
| `overlay` | `#00000066` | Modal/sheet backdrop | — |

- **Speakers:** `['#73836F', '#7A8FA6', '#B08A5B', '#9A7F94', '#5F8F8A', '#B9775F']` (sage, dusty blue, ochre, mauve, grey-teal, clay). White initials on each are at least 3:1, so initials must be 600 weight.
- **Banned:** pure white `#FFFFFF` canvases, the old rose `#C86A5C`, green `#5AA98B`, any shadow tint.
- **Known gap (same as KEEPLACE):** `muted` on `background` is 4.2:1. Use it for secondary information only, at 12pt or larger.

### 2.2 Typography

Use the system font (PingFang TC on iOS, Noto Sans CJK on Android). Do not bundle font files.

| Variant | Size/line | Weight | Use |
|---|---|---|---|
| `display` | 30/36 (brand header uses 32/40, tracking 2) | 600 | 「好記」 in the brand header only |
| `screenTitle` | 24/30 | 600 | Meeting title on Results, big screen titles |
| `section` | 19/26 | 600 | Group headers (今天/本週/更早), sheet titles, settings card titles, notes H2 |
| `cardTitle` | 15/22 | 500 (600 when selected) | Card titles, chip labels, button labels |
| `body` | 15/24 | 400 | Transcript, notes paragraphs, descriptions |
| `small` | 12/17 | 400 | Meta lines (time · duration · speakers), hints, counters |
| `wordmark` | 11/14, letterSpacing 4 | 500 | `HAOJI` next to 好記 |
| `tabLabel` | 11/14 | 500 | Bottom-bar labels |

- Times and durations always use `tabularNums`.
- Set `maxFontSizeMultiplier` to 1.3 for chrome (header, bar) and 1.5–1.6 for content. Body text keeps Dynamic Type.
- Recommended: add an `AppText` component (`variant` + `color` token), like KEEPLACE `src/components/AppText.tsx`. Do not hand-write font sizes in screens.

### 2.3 Spacing, size, radius

- **4pt grid:** 2 / 4 / 8 / 12 / 16 / 20 / 24 / 32.
- **Screen padding:** horizontal 20, vertical 16. Gap between items 12; between sections 24.
- **Heights:**
  - Buttons: 52, radius 18.
  - Chips: 36, radius 18, horizontal padding 16.
  - Inputs: 48, radius 12, with a 1px outline on `surface`.
  - Minimum touch target: 44.
- **Card:** radius 18, padding 16, `surface`, 1px `outline`. **No shadow.**
- **Sheet:** top radius 24, `surface`, padding top 20 / sides 20, plus the bottom safe-area inset + 16.
- **Motion:** at most 250 ms and no bounces. Respect Reduce Motion (`AccessibilityInfo.isReduceMotionEnabled`); `BreathingRing` must hold still when it is on.

## 3. Logo & app icon

- **Wordmark lock-up**, as in the home header of `references/screens/keeplace_ios_home.png`:
  - Line 1: 「好記」 (display 32/40, 600, tracking 2, `heading`), followed by `HAOJI` (`wordmark`, `muted`). They sit on one baseline with an 8pt gap.
  - Line 2: the tagline in `small` / `muted`.
  - The whole block is a single accessibility header: `好記 HAOJI，把說過的話，好好記下來。`
- **Mark** (`brand/out/icon-1024.png`): KEEPLACE draws an open-stroke map pin with a peach "seed" inside. 好記 uses the same hand: an open-stroke **speech bubble**, with a three-bar **waveform** as the seed.
  - The stroke is 1.7% of the canvas in `primaryDark` on ivory.
  - The centre bar is peach at 45% over ivory.
  - `HAOJI` sits underneath in tracked Avenir Next Regular.
  - Small sizes (under 120px) drop the wordmark.
- **To regenerate:** `python3 design/keeplace-style/brand/make_icons.py`. The output names match the iOS asset catalog (`icon-40/58/60/80/87/120/180/1024.png`) and the Android adaptive layers.
- **To install:**
  - iOS: copy `brand/out/icon-*.png` over `app/ios/Haoji/Images.xcassets/AppIcon.appiconset/`. The existing names match.
  - Android: produce mipmaps from the adaptive foreground/background/monochrome layers.
  - Launch screen: ivory background with `splash-icon.png`.
  - The current icon is the leftover Expo blueprint "A" placeholder and must go.
- The mark is a **draft**. The owner can ask for a different seed (for example, a dot like KEEPLACE's) without touching the rest.

## 4. Brand copy

| | KEEPLACE | 好記 |
|---|---|---|
| Chinese name | 留著 | **好記** |
| Latin wordmark | KEEPLACE | **HAOJI** |
| Tagline | 把去過的地方，留給未來的自己。 | **把說過的話，好好記下來。** (proposal) |
| Brand verb on the main action | 留著 (centre ＋) | **記下來** (centre mic) |

The tagline follows KEEPLACE's pattern: an object clause 「把…」, a soft verb, and a full stop.

Alternatives if the owner prefers:
- 「把說過的話，留給之後的自己。」
- 「每一場對話，都好好記著。」

Until the owner chooses, use the bold one and keep it **only** in `brand.tagline`, so it is a one-line change.

## 5. Wording & voice

KEEPLACE copy rules. Apply them to every string in 好記.

1. **Use 「你」, a warm tone, and short sentences.** End with 「。」. No 「！」 and no 「您」.
2. **Use full-width punctuation:** `，。？：「」（）`. The ellipsis is the single character `…`. Use `「」` around user content: 刪除「週會」？
3. **No tech words in the UI.**
   - Never say LLM, AI 模型, 後端, server, API, job, upload ID, or 段 *N* (unless the user picks parts).
   - Say instead: 整理, 會議記錄, 逐字稿, 在手機上, 處理中.
4. **Confirmation dialogs** use title, consequence, then buttons:
   - The title is a question about the object: `刪除「{title}」？`
   - The body says what goes **and what stays**: 「錄音、逐字稿和會議記錄都會從這支手機移除，刪除後無法復原。」
   - Buttons: `取消` (cancel style) and `刪除` (destructive). Never 「確定」.
5. **Errors** use what failed, what is still safe, and what to do:
   - Title: 「沒有儲存」 / 「刪除失敗」 / 「無法開啟相簿」.
   - Body example: 「資料沒有變更，請再試一次。」 / 「內容還在畫面上，請再試一次。」
6. **Discarding a dirty form:** 「要放棄這次的編輯嗎？」 with the body 「還沒儲存的內容會不見。」 and the buttons `繼續編輯` / `放棄`.
7. **Empty states** have a title that states the situation plus a description that gives the next step, and optionally a primary button. For example:
   - 「還沒有任何會議」 / 「按下方的「記下來」開始錄音，或匯入一段音檔。」
8. **Optional fields:** label + `（選填）`.
9. **Progress** says what is happening in plain words, ending with 「…」:
   - 「正在整理逐字稿…」, 「正在寫會議記錄…」
   - Add reassurance when it helps: 「離開 App 也會繼續。」
10. **Accessibility labels** are full phrases ("設定與資料", "搜尋會議", "復原「週會」"). They are never icon names.

### 5.1 Existing 好記 strings to rewrite (first pass)

| Now | Change to |
|---|---|
| 本機 LLM 生成中… | 正在寫會議記錄… |
| 已送出給後端處理，離開 App 也會繼續。 | 已開始整理，離開 App 也會繼續。 |
| 上傳完成後就會在後端繼續處理。 | 上傳完成後會自己繼續整理，不用一直開著 App。 |
| 刪除後無法復原，確定要刪除嗎？ | title `刪除「{title}」？` + body 「錄音、逐字稿和會議記錄都會從這支手機移除，刪除後無法復原。」 |
| 檔案複製失敗，請再試一次 | title 「沒有匯入」 + body 「檔案複製失敗，原本的檔案沒有變動，請再試一次。」 |
| 分析中 (screen title) | 整理中 |
| 結果 (screen title) | The meeting title |
| AI 分析 (tab) | 會議記錄 |
| 沒有麥克風權限，請到「設定 … | title 「沒有麥克風權限」 + body 「到「設定」開啟麥克風後，就能開始錄音。」 + button 「前往設定」 |
| 找不到可辨識的錄音檔。 | 「這段錄音裡沒有可以辨識的聲音。」 |

Do a full string audit once screens are migrated. Check that tests asserting the old strings are updated rather than deleted.

## 6. Icons

- **Family:** Lucide (`lucide-react-native`). It is pure JS on `react-native-svg`, which 好記 already ships, so there is **no new native dependency and no pod change**.
- **Jest:** add the same mapping KEEPLACE uses: `transformIgnorePatterns` includes `lucide-react-native`, and `moduleNameMapper` `'^lucide-react-native$' → 'node_modules/lucide-react-native/dist/cjs/lucide-react-native.js'`.
- If adding the package is unwanted, keep `components/icons.tsx` but redraw it to Lucide geometry with `strokeWidth` 1.8.
- **Stroke and colour:** 1.8 by default, 2 when active or selected. Colour is always a token: `heading` in header buttons, `muted` when inactive, `primaryDark` when active, `onPrimary` on fills.
- **Sizes:**
  - Header buttons: 20 inside a 44 circle.
  - Bottom bar: 24.
  - Inline badges: 13–16.
  - Empty states: 28–32 inside a 72 circle.
- **Suggested mapping:**

| Use | Icon |
|---|---|
| Record | `Mic` |
| Stop / pause / play | `Square`, `Pause`, `Play` (play/pause filled) |
| Skip back / forward | `RotateCcw`, `RotateCw` with a 15/30 overlay |
| Import | `FileAudio` |
| Search | `Search` |
| Settings | `UserRound` (same as KEEPLACE) |
| Transcript | `FileText` |
| Notes | `NotebookPen` |
| Speakers | `UsersRound` |
| Copy | `Copy` → `Check` |
| Share / export | `Share` |
| Delete | `Trash2` |
| Done badge | `Check` |
| In progress | `Loader` |
| Error | `CircleAlert` |
| Empty list | `AudioLines` |

- **No emoji anywhere**, including checkmarks: 「✓ 已複製」 becomes a `Check` icon plus 已複製.

## 7. Components & patterns (KEEPLACE → 好記)

Every pattern below exists in KEEPLACE. The source file is named so you can read the real implementation.

| KEEPLACE pattern (file) | Spec | 好記 use |
|---|---|---|
| **BrandHeader** (`components/BrandHeader.tsx`) | Wordmark lock-up (§3) on the left. On the right, 44pt round `surface` buttons with a 1px `outline`; the active one gets a `primary` border. `paddingTop` 12, sides 20. | Home header: 好記 HAOJI + tagline; buttons 搜尋會議 (`Search`) and 設定 (`UserRound`, if a settings screen exists). Hide the native header on Home. |
| **Native stack header** | Background `background`, no shadow (`headerShadowVisible: false`), title 17/600 `heading`, tint `heading`. Back is the chevron only (no title). Form screens show 「取消」 on the left. | All non-Home screens. |
| **StatusTabs** (`components/StatusTabs.tsx`) | Equal-width tabs. Label `cardTitle`, `muted` → `heading`+600 when selected, with a 2px `heading` underline over a 1px `outline` rule. | Results: 逐字稿 / 會議記錄 / 講者 (replace segmented pills). Optional Home filter 全部 / 已整理 / 處理中. |
| **Chips** (`components/CategoryChips.tsx`, `form/ChoiceChips.tsx`) | Height 36, radius 18, `surface` + 1px `outline`. Selected: `primary` fill with `onPrimary` text. The row scrolls horizontally with 8pt gaps. | Speaker filter chips, playback speed 1.0×/1.5×/2.0×, keyword chips. |
| **Card / list row** (`app/settings.tsx` `card`, `PlaceCard.tsx`) | `surface`, radius 18, 1px `outline`, padding 16, gap 8. Title `cardTitle` `heading`; meta `small` `muted`, joined by 「 · 」. | Meeting card: title / 「今天 14:30 · 42 分鐘」 / avatars. Badges are inline icon+text (`Check` 13 `primaryDark` + 「逐字稿」), **not** coloured pills. |
| **Group header** (Timeline) | `section` 19/26 `heading`, 24 above, 12 below. | 今天 / 本週 / 更早. |
| **Bottom bar with centre action** (`KeeplaceTabBar.tsx`) | `surface`, hairline top `outline`, min height 70 + bottom inset. The centre is a 52 round `primary` button with an `onPrimary` icon at 26/stroke 2, labelled below with the brand verb in `tabLabel` `muted`. Side items: icon 24 + label. | Home: left 「匯入」 (`FileAudio`), centre **記下來** (`Mic`) → Record, right 「搜尋」 (`Search`), or leave the sides empty. The centre button is an action, not a tab. Do **not** add a tab navigator. |
| **Primary button** (`EmptyState`, `FormScreen` sticky CTA) | Height 52, radius 18, `primary` fill, label `cardTitle`/600 `onPrimary`. Pressed: opacity 0.8. Disabled: opacity 0.4. Loading: `ActivityIndicator` `onPrimary` in place of the label. | 生成逐字稿, 生成會議記錄, 上傳, 合併成一段並繼續. |
| **Secondary button** (settings `action`) | Height 48, radius 12, `background` fill, 1px `outline`, icon 18 + label `body`. | 複製 Markdown, 複製純文字, 匯出, 修正關鍵字. |
| **DangerButton** (`form/DangerButton.tsx`) | Outline button, label and icon in `danger`, placed last on the page. | 刪除這場會議. |
| **Sticky CTA** (`FormScreen`) | Fixed above the keyboard and safe area. `background` canvas behind it, 1px `outline` top rule. | Review / ImportConfirm primary action. |
| **OptionSheet** (`components/OptionSheet.tsx`) | `Modal` slide over `overlay`. Sheet `surface` with top radius 24. Title `section`. Rows are 52 high with hairline dividers and a `Check` 18 `primaryDark` on the selected row. Tapping the backdrop closes it (label 「關閉」). | Speaker rename sheet, keyword sheet, playback speed, sort. |
| **EmptyState** (`components/EmptyState.tsx`) | Centred. A 72 `surface` circle with a 1px `outline` holding the icon, then `section` title, `body` `muted` description, and an optional primary button. Padding 40 horizontal / 64 vertical. | Empty meeting list, no transcript yet, no notes yet, search with no results. |
| **UndoSnackbar** (`components/UndoSnackbar.tsx`) | `heading` fill, radius 18, height 52, 20 from the sides above the bottom bar. Text `onPrimary`, underlined action 「復原」, live region, 10 s timeout. | **Should:** swipe-to-delete becomes soft-delete + 復原 (keep the hard delete after timeout). If not done, keep the confirm alert using §5 wording. |
| **Suggestion card** (`form/LocationSuggestions.tsx`) | `surface` card with a small `muted` eyebrow (「可能是…」). Actions are text buttons in `primaryDark`. | Keyword-fix suggestions; "merge these files?" prompt on ImportConfirm. |
| **Form field** (`form/FormField.tsx`) | Label `cardTitle`/600 + 「（選填）」 `muted`. Input: height 48, radius 12, `surface`, 1px `outline` (`danger` on error). Error text `small` `danger`. Counter right-aligned `small` `muted`. | Meeting title, speaker name input, keyword fields. |
| **Settings cards** (`app/settings.tsx`) | A stack of cards with gap 12. Each card has a `section` title, `body` `muted` explanation, then controls. | A settings/about screen if added: server status, privacy copy. |

### 7.1 好記-specific surfaces in this language

- **Record screen:**
  - Canvas `background`.
  - Timer: `display` with tabularNums, `heading`. While recording, a 8pt `accent` dot plus 「錄音中」 in `small` `muted`.
  - `BreathingRing` and `Waveform` in `primary` at about 25% (ring) / 100% (bars) over `primarySoft`.
  - Stop is a 72 round `primary` button with a `Square` icon in `onPrimary`. Pause is a 52 round outlined `surface` button.
  - Neither red nor rose.
- **Player:**
  - The card is `surface` + outline.
  - The waveform's played part is `primary`; the unplayed part is `outline`.
  - Play/pause is a 56 round `primary` button.
  - ±15/30 use `muted` icons with the number overlaid in `small`.
  - Speed is a chip.
- **Transcript:**
  - Each turn: avatar 28 (speaker colour, initial in `onPrimary` 600) + name `cardTitle` + time `small` `muted` tabular, then text in `body`.
  - An unnamed speaker gets a dashed `accent` chip labelled 「點一下命名」 in `accent`.
- **Notes document:**
  - H2 → `section` with 24 above.
  - Paragraphs → `body`.
  - Bullet lists use an 8pt indent.
  - 待辦 becomes a checklist with Lucide `Square`/`SquareCheck` in `primaryDark`.
  - No coloured section bars and no emoji markers.
- **Processing:**
  - EmptyState-like centre layout: a 72 circle with a `Loader` icon, the title 「正在整理逐字稿…」, and the description 「離開 App 也會繼續，完成後會通知你。」
  - A progress bar 4pt high with radius 2: `primary` on `outline`.

## 8. Accessibility & states (KEEPLACE definition of done)

- Every `Pressable` needs `accessibilityRole` and a Chinese `accessibilityLabel`. Tabs set `accessibilityState.selected`; sheets set `accessibilityViewIsModal`.
- Every list or screen needs empty, loading, error and permission-denied states.
- Touch targets are at least 44; use `hitSlop={8}` on text buttons.
- Pressed feedback is opacity: 0.6 on icons, 0.7–0.85 on rows/cards, 0.8 on filled buttons. Do not change colour on press.

## 9. Do / Don't

- **Do:** keep the ivory canvas, put 1px outlines on everything raised, use one primary per screen, and keep the meta line in muted 12pt.
- **Don't:** add shadows, gradients, pure white, red, more than one filled button per view, emoji, coloured pill badges, a hard blur paywall, or tech words in copy.
