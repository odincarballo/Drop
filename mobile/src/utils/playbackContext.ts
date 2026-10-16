import type { LibraryItem } from '@/models/library';

export type PlaybackContext = { orderedIds: string[] };

export function isPlayableLibraryItem(item: LibraryItem): boolean {
  const extension = item.relativeMediaPath.split('.').at(-1)?.toLowerCase();
  return (
    (item.mediaType === 'video' && extension === 'mp4') ||
    (item.mediaType === 'audio' && extension === 'm4a')
  );
}

// Input order is already the exact list order produced by Library/Collections.
export function playbackContextFromVisibleItems(
  items: readonly LibraryItem[],
): PlaybackContext {
  return {
    orderedIds: items.filter(isPlayableLibraryItem).map((item) => item.id),
  };
}
