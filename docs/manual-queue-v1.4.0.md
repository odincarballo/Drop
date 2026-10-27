# Manual Queue — v1.4.0

Blocks A, B and C implement durable Queue persistence, native selection/reconciliation and the Queue interface. Playback order is **current item → manual queue → remaining playback context**. Block A alone introduced persistence; the later blocks added playback and UI without changing that contract.

## Candidate and validation status

Release preparation sets version **1.4.0 build 7**, without changing dependencies, the environment-resolved Bundle ID or playback behavior. This versioned candidate has not yet been compiled or installed. Concise scope and exclusions are in [the release notes](release-notes-v1.4.0.md).

Integrated iOS Release ARM64 compilation and signed reprotest installation were verified against functional commit `6d800e051236342a589d007baf4cce411271ce43`, still declaring **1.3.0 build 6**. The user reported **15/15** physical checks satisfactory on 26 October 2026. [The physical-validation report](manual-queue-v1.4.0-physical-validation.md) distinguishes those observations from Codex's build, signing, SQLite and file-preservation checks. It does not treat the new version/build as already validated.

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

## Native integration (B2B2 / B2C)

Block A alone adds persistence. B2B2 subsequently connects native selection and consumption to the existing `AVQueuePlayer`: CURRENT, then manual occurrences, then the remaining Playback Context. Preparation does not consume a row; only the exact prepared item becoming CURRENT allows conditional SQLite consumption. Duplicate occurrences remain independent, and manual A→A begins at zero. A failed consumption preserves the row and suppresses another automatic attempt to play that occurrence in the session; a crash can exceptionally replay a row whose consumption did not commit.

B2C adds `DropPlayback.queueDidChange()` without passing a Queue snapshot. After a committed mutation that changed rows, TypeScript requests a new SQLite read and waits for a native ACK: `applied`, `failed`, or `superseded`. The latest native request wins; a natural handoff that already reached CURRENT is never reversed. A successful ACK waits for the replacement preparation to settle. Pause, interruption and Library Delete do not wait behind this bridge call. An exhausted, paused transport can defer preparation; that result is not reported as applied.

The existing public mutation return types are preserved. Their resolution means **SQLite committed**, even if the playback ACK failed or timed out (five seconds). `getQueuePlaybackSyncState()` and `observeQueuePlaybackSync()` expose `unknown`, `applied`, or `pending`, plus the last native result. A pending state means “saved; playback update pending”, not rollback. `listQueue()`, resubscription and foreground retry reconciliation. There is no retry loop or new UI in B2C.

SQLite operations are serialized independently of their ACK waits: a newer mutation can commit and request reconciliation while an older ACK is still pending. Only the newest request can update sync state; a late ACK or timeout cannot replace that result. Reads reuse an in-flight ACK when the persisted snapshot has not changed. `applied` requires a retained matching NEXT, a completed replacement preparation, or a confirmed absence of eligible candidates; merely scheduling or deferring preparation is insufficient.

Native `onQueueChanged` is emitted only after a persisted consumption, including a commit that finishes after the playback session changed. Missing rows and failed/rolled-back consumption do not emit it. `observeQueue()` rereads SQLite and compares signatures, so repeated signals do not produce duplicate data-change events. Native signals are not echoed back into another reconciliation. With no JS observer, native playback continues; a later read/subscription recovers the durable pending rows. Library-change signals reconcile only when Queue changed. Callers should still obtain an initial snapshot using `listQueue()`.

D1/D2 subsequently verified the Expo method/event in an integrated iOS build of the functional commit. Standalone Swift and mocked JS bridge tests alone do not establish that integration, and successful compilation does not establish every runtime ACK/error path. Schema v3, version/build, backend and downloader were unchanged by B2C; the version bump is separate release preparation.

## Manual Queue interface (Block C)

`/queue` is accessible from Library and PlayerScreen. It shows CURRENT using `PlaybackProvider`, separately from the pending SQLite occurrences. The view does not open another player or derive CURRENT from the first Queue row. Each pending row is keyed by its entry ID, even when several rows reference one Library item. Metadata/artwork come from Library, with safe placeholders and retry when unavailable.

Library, Collection detail and Uncollected reuse `LibraryItemRow` actions **Reproducir a continuación** and **Añadir al final de la cola** for ready MP4 video / M4A audio. These call only `enqueueNext` / `enqueueLast`. A press in flight is guarded synchronously; a later deliberate press is allowed to create a duplicate. Existing play, export, share, Collection and Library Delete actions keep their behavior.

The Queue screen removes individual occurrences, moves them with explicit accessible up/down controls, and confirms before clearing pending entries. These actions never close CURRENT. Queue/Library observers and foreground refresh reconcile the view; request revisions discard stale list and metadata responses, metadata is reused across duplicate rows, and subscriptions are removed on blur/unmount. There is no optimistic second Queue model: mutations render their authoritative post-commit observation.

A committed operation with a pending native ACK shows **Guardado en la cola. Actualizando reproducción…**. An applied result can show a saved confirmation; a persistence rejection shows a separate safe error. No bridge failure is presented as a SQLite rollback. Empty, loading, missing-file and metadata-error states remain usable. The screen uses the existing light/dark theme, Safe Area and labeled controls, with no new dependencies or drag-and-drop engine.

Automated UI tests exercise these contracts with the existing services mocked at their boundary; the Queue service's separate tests use real isolated SQLite. Integrated builds and the 15 user-reported physical cases are recorded above. Physical VoiceOver verification, exhaustive layout/theme checks and exceptional concurrency scenarios (including Delete/consumption races) remain pending. The completed Library Delete check does not establish all race interleavings. This block adds no Playlists, Shuffle, global Repeat or manual Next/Previous, and did not change version/build or schema v3.
