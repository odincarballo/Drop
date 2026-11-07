export type LibrarySourceKind = 'youtube' | 'direct' | 'local';
export type LibraryMediaType = 'video' | 'audio';
export type LibraryLifecycle = 'pending' | 'ready' | 'deleting';

// Derived from storage on each read; never persisted as lifecycle.
export type LibraryAvailability =
  'available' | 'missing' | 'invalid' | 'unreadable';

export type LibraryMetadata = {
  sourceKind: LibrarySourceKind;
  sourceVideoId?: string | null;
  title: string;
  mediaType: LibraryMediaType;
  durationSeconds?: number | null;
  resolution?: string | null;
  height?: number | null;
  fps?: number | null;
  videoCodec?: string | null;
  audioCodec?: string | null;
  container?: string | null;
  thumbnailUrl?: string | null;
};

export type LibraryItem = LibraryMetadata & {
  id: string;
  relativeMediaPath: string;
  relativeArtworkPath: string | null;
  sizeBytes: number;
  artworkSizeBytes: number;
  downloadedAt: string;
  playbackPositionSeconds: number;
  completedAt: string | null;
  lifecycle: LibraryLifecycle;
  availability: LibraryAvailability;
  mediaSizeOnDisk: number | null;
  uri: string | null;
  artworkUri: string | null;
};

export type AvailableLibraryItem = LibraryItem & { uri: string };

export function isAvailableLibraryItem(
  item: LibraryItem,
): item is AvailableLibraryItem {
  return (
    item.availability === 'available' &&
    typeof item.uri === 'string' &&
    item.uri.length > 0
  );
}
