# Manual Queue — v1.4.0 Block A

Block A defines and persists a manual queue. It does **not** change playback or add UI. The planned order for later blocks is **current item → manual queue → remaining playback context**.

## Boundaries

- **Library** owns each media file, artwork, metadata and playback progress. Queue entries only reference Library IDs; they never copy files or metadata.
- **Collections** organize Library items. They do not prescribe playback order.
- **Playback Context** is the existing automatic sequence derived from the user's Library/Collection selection.
- **Manual Queue** is the durable ordered list of _pending_ user-requested occurrences. The current item is not a Queue row. Queue is not cleared by an idle player, route close, React restart or app relaunch.
- A future **Playlist** would be a reusable saved sequence; Manual Queue is not one.

## SQLite contract

The existing `library.sqlite` advances from `user_version=2` to `3`. The additive `playback_queue` table has `id` (opaque per-occurrence UUID primary key), `itemId` (foreign key to `library_items(id)` with `ON DELETE CASCADE`), nonnegative integer `position`, and UTC ISO-8601 `addedAt`. The named unique index `playback_queue_position` enforces one entry per position; `playback_queue_by_item(itemId, position)` supports lookup of all occurrences of an item. Multiple rows may share one `itemId` but never an `id` or `position`.

The authoritative order is `position ASC`, compacted to `0…N-1`. `addedAt` is audit data, not a sort key. IDs come from the native DropLibrary UUID bridge, independently of Collection IDs. The Queue does not own Media, Artwork or any Library metadata.

Fresh databases and v0/v1/v2 databases migrate within the existing schema transaction, adding only missing schema versions and setting `user_version=3` last. Failure rolls back the entire migration; a future version or malformed declared v3 schema is rejected without destructive repair. Existing Library rows, progress, completion, Collections and memberships remain unchanged.

## Service contract

`mobile/src/services/queue.ts` is the sole public Queue persistence API:

| Operation                                 | Result                                                                                                      |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `listQueue()`                             | All pending occurrences, ordered by position.                                                               |
| `enqueueNext(itemId)`                     | A new occurrence at position 0; existing entries retain relative order.                                     |
| `enqueueLast(itemId)`                     | A new occurrence at the tail.                                                                               |
| `removeQueueEntry(entryId)`               | Removes only that occurrence; repeating it is a no-op.                                                      |
| `clearQueue()`                            | Deletes only Queue rows.                                                                                    |
| `moveQueueEntry(entryId, targetPosition)` | Moves one occurrence within `0…N-1`, preserving others' relative order.                                     |
| `observeQueue(listener)`                  | Notifies after a committed change, including an observed Library deletion; returns an unsubscribe function. |

Enqueue validates that the Library row exists and is `ready` inside the same foreign-key-enabled write transaction. Missing, pending and deleting rows are rejected. If Library Delete commits first, enqueue fails; if enqueue commits first, Delete cascades the new occurrence. No stale orphan is accepted.

Queue operations are serialized in this JS runtime. Each write uses a private SQLite connection, enables and verifies `foreign_keys` **before** `BEGIN IMMEDIATE`, and waits briefly for ordinary cross-connection contention. The unique position index remains enabled during all reorders. Reordering first moves rows to a disjoint nonnegative range, then writes final compact positions in the same transaction; rollback exposes neither intermediate order nor gaps.

Deleting a Library item cascades _all_ of its occurrences. Cascade can leave gaps; the next authoritative Queue read or Library-change observation compacts surviving positions transactionally before publishing them, without creating entries or changing their relative order. Normal reads of an already compact Queue do not mutate data. Collection deletion does not affect Queue. Clearing Queue never touches Library, Collections, playback state, progress, Media or Artwork.

Observers receive successful state changes after commit, not failed writes, rollbacks or no-ops. Unrelated Library changes are compared against the observed Queue snapshot so they do not emit a false Queue change. A caller should load an initial snapshot with `listQueue()` when subscribing.

## Later blocks

Block B will integrate the persisted Queue with native `AVQueuePlayer` and define consumption/transition policy. A later UI block may add enqueue actions, a Queue screen and visual reordering. Block A deliberately leaves PlayerScreen, MiniPlayer, PlaybackProvider, Now Playing, PiP and playback behavior unchanged. There is no automatic Queue playback yet.
