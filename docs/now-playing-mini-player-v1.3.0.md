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

## Block B: persistent mini-player

`MiniPlayer` is mounted once beside the root route slot. The flex layout
reserves space for it rather than overlaying screen content, and its bottom
padding uses the current safe-area inset. It is visible on non-player routes
when native playback has a usable session and matching Library metadata.
Idle, failed, fullscreen, or an unresolved item hides it, so auto-next cannot
briefly show the previous item's title or artwork. PiP may continue while the
mini-player is visible on another Drop screen.

The artwork, one-line title, and play/pause control consume `usePlayback()`.
The separate transport button delegates to `togglePlayPause()` without
navigating; the main area opens `/player/{libraryId}`. The native player,
Playback Context, rate, and PiP ownership are unchanged. Manual Queue and
Playlist management, manual next/previous, repeat, and shuffle remain outside
the scope of v1.3.0 Blocks A and B.

## Release-candidate scope

v1.3.0 includes Blocks A and B. The shared state stays synchronized with native
playback, resolves active Library metadata, follows auto-next, and reconciles
on foreground. The mini-player persists across Home, Library, Collections,
collection detail, Settings, and other non-player routes while a usable session
exists. It shows local artwork and title, offers Play/Pause, and opens the
active full player without restarting playback; it is hidden on `/player/*`.

The functional Blocks A and B were physically checked in the separate test
bundle, including Library navigation, mini-player controls, position
continuity, auto-next metadata, and hiding on PlayerScreen. The version-bumped
v1.3.0 build 6 release candidate has not yet been built or installed. This is
not an App Store or TestFlight validation. Manual Queue, Playlist, manual
Next/Previous, Repeat, and Shuffle remain out of scope.
