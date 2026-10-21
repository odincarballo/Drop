# Drop v1.3.0 — Now Playing and mini-player

## Block A: global Now Playing state

`PlaybackProvider` is mounted once in the app root. It subscribes to the
existing `DropPlayback` service and obtains an initial native snapshot. The
native service remains authoritative for the active `libraryId`, transport
status, position, duration, selected rate, completion, errors, and PiP
presentation. The provider never creates a player or starts playback on mount.

The active title, local artwork URI, and media type are resolved from Library
using the native `libraryId`. Library change notifications refresh those
details. Requests are generation-guarded so a late response for an older item
cannot replace the current one; idle or closed native state clears metadata.
An unavailable Library item leaves playback state intact with null metadata.

AVQueuePlayer auto-next can change the native `libraryId` without a player
route mounted. Its playback event updates the global state and triggers a new
Library lookup. When React returns to the foreground, `getState()` reconciles
changes that occurred while JavaScript was suspended. A snapshot cannot
overwrite a newer playback event. Commands exposed by `usePlayback()` delegate
to the existing playback service; navigation remains with the consumer.

`PlayerScreen` temporarily retains its route-local subscription for scrubbing,
PiP restoration, and route replacement. It is not the global source of truth.
Block B will use `usePlayback()` to render the persistent mini-player. Manual
Queue and Playlist management, shuffle, repeat, and a mini-player UI are not
part of Block A.
