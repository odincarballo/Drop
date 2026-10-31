import type { LibraryItem } from '@/models/library';

export type LibraryFilter = 'all' | 'audio' | 'video';
export const librarySortOptions = [
  ['recent', 'Más recientes'],
  ['oldest', 'Más antiguos'],
  ['title-asc', 'Título A–Z'],
  ['title-desc', 'Título Z–A'],
  ['duration-asc', 'Duración ascendente'],
  ['duration-desc', 'Duración descendente'],
] as const;
export type LibrarySort = (typeof librarySortOptions)[number][0];
export function normalizeLibraryQuery(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}
function compare(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}
function recent(a: LibraryItem, b: LibraryItem) {
  return compare(b.downloadedAt, a.downloadedAt) || compare(b.id, a.id);
}
function duration(item: LibraryItem): number | null {
  const value = item.durationSeconds;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}
/** All words must match somewhere in the useful, already loaded metadata.
 * No I/O, mutations or playback side effects; unavailable rows remain eligible. */
export function selectLibraryItems(
  items: readonly LibraryItem[],
  query: string,
  filter: LibraryFilter,
  sort: LibrarySort,
): LibraryItem[] {
  const words = normalizeLibraryQuery(query).split(' ').filter(Boolean);
  return items
    .filter((item) => {
      if (filter !== 'all' && item.mediaType !== filter) return false;
      const text = normalizeLibraryQuery(
        [item.title, item.container, item.resolution, item.sourceVideoId]
          .filter(Boolean)
          .join(' '),
      );
      return words.every((word) => text.includes(word));
    })
    .sort((a, b) => {
      if (sort === 'recent') return recent(a, b);
      if (sort === 'oldest')
        return compare(a.downloadedAt, b.downloadedAt) || compare(a.id, b.id);
      if (sort.startsWith('title')) {
        const order = compare(
          normalizeLibraryQuery(a.title),
          normalizeLibraryQuery(b.title),
        );
        return (sort === 'title-asc' ? order : -order) || recent(a, b);
      }
      const ad = duration(a),
        bd = duration(b);
      if (ad === null || bd === null)
        return ad === bd ? recent(a, b) : ad === null ? 1 : -1;
      return (sort === 'duration-asc' ? ad - bd : bd - ad) || recent(a, b);
    });
}
