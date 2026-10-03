export type LibrarySourceKind = 'youtube' | 'direct';
export type LibraryMediaType = 'video' | 'audio';
export type LibraryLifecycle = 'pending' | 'ready' | 'deleting';

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
  uri: string;
  artworkUri: string | null;
};
