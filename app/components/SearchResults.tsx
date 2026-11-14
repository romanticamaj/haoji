import React from 'react';
import { FlatList, Pressable, StyleSheet } from 'react-native';
import { AppText } from './AppText';
import { colors, layout, radius, spacing } from '../lib/theme';
import type { SearchField, SearchHit } from '../lib/search';

// Home's search results: one row per hit, the meeting title on top and — for anything but a title
// match — where it was found plus a snippet. The matched characters sit on a `primarySoft` fill.
const WHERE: Record<Exclude<SearchField, 'title'>, string> = {
  speaker: '講者',
  notes: '會議記錄',
  transcript: '逐字稿',
};

export function SearchResults({ hits, titleOf, onOpen }: {
  hits: SearchHit[];
  titleOf(sessionId: string): string;
  onOpen(hit: SearchHit): void;
}) {
  return (
    <FlatList
      data={hits}
      keyExtractor={(h, i) => `${h.sessionId}-${h.field}-${i}`}
      contentContainerStyle={styles.list}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      renderItem={({ item }) => {
        const title = titleOf(item.sessionId);
        const where = item.field === 'title' ? null : WHERE[item.field];
        return (
          <Pressable
            testID="search-hit"
            accessibilityRole="button"
            accessibilityLabel={where ? `${title}，${where}：${item.snippet}` : title}
            onPress={() => onOpen(item)}
            style={({ pressed }) => [styles.card, pressed && styles.pressed]}
          >
            {item.field === 'title'
              ? <Marked variant="cardTitle" color="heading" hit={item} numberOfLines={1} />
              : <AppText variant="cardTitle" color="heading" numberOfLines={1}>{title}</AppText>}
            {where ? (
              <>
                <AppText variant="small" color="muted">{where}</AppText>
                <Marked variant="body" color="body" hit={item} numberOfLines={2} />
              </>
            ) : null}
          </Pressable>
        );
      }}
    />
  );
}

function Marked({ hit, variant, color, numberOfLines }: {
  hit: SearchHit; variant: 'cardTitle' | 'body'; color: 'heading' | 'body'; numberOfLines: number;
}) {
  const { snippet, matchStart, matchLen } = hit;
  return (
    <AppText variant={variant} color={color} numberOfLines={numberOfLines}>
      {snippet.slice(0, matchStart)}
      <AppText variant={variant} color="heading" testID="search-hit-mark" style={styles.mark}>
        {snippet.slice(matchStart, matchStart + matchLen)}
      </AppText>
      {snippet.slice(matchStart + matchLen)}
    </AppText>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: layout.screenPaddingH, paddingTop: spacing.lg, paddingBottom: spacing.xxl, gap: layout.itemGap },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.card, padding: spacing.lg, gap: spacing.xs,
    borderWidth: layout.border, borderColor: colors.outline,
  },
  pressed: { opacity: 0.8 },
  mark: { backgroundColor: colors.primarySoft, fontWeight: '600' },
});

export default SearchResults;
