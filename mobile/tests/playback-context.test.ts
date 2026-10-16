import type { LibraryItem } from '@/models/library';
import {
  isPlayableLibraryItem,
  playbackContextFromVisibleItems,
} from '@/utils/playbackContext';

const ids = [1, 2, 3, 4].map(
  (number) => `00000000-0000-0000-0000-${String(number).padStart(12, '0')}`,
) as [string, string, string, string];

function item(id: string, mediaType: 'audio' | 'video', extension: string) {
  return {
    id,
    mediaType,
    relativeMediaPath: `Media/${id}.${extension}`,
  } as LibraryItem;
}

test('context is an ordered snapshot of the exact visible playable rows', () => {
  const visible = [
    item(ids[2], 'video', 'mp4'),
    item(ids[0], 'audio', 'm4a'),
    item(ids[1], 'video', 'webm'),
    item(ids[3], 'audio', 'm4a'),
  ];
  const snapshot = playbackContextFromVisibleItems(visible);
  expect(snapshot.orderedIds).toEqual([ids[2], ids[0], ids[3]]);
  visible.reverse();
  expect(snapshot.orderedIds).toEqual([ids[2], ids[0], ids[3]]);
  expect(isPlayableLibraryItem(visible[1]!)).toBe(false);
});

test('filtered video and audio contexts never insert another media type', () => {
  const videos = [item(ids[2], 'video', 'mp4'), item(ids[0], 'video', 'mp4')];
  const audio = [item(ids[1], 'audio', 'm4a'), item(ids[3], 'audio', 'm4a')];
  expect(playbackContextFromVisibleItems(videos).orderedIds).toEqual([
    ids[2],
    ids[0],
  ]);
  expect(playbackContextFromVisibleItems(audio).orderedIds).toEqual([
    ids[1],
    ids[3],
  ]);
});
