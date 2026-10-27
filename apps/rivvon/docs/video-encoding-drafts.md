# Completed video drafts

Completed ribbon and texture-only exports are saved automatically in this
browser, independently of authentication. Video Gallery → Drafts restores them
after sign-in, page reload, and reopening Rivvon at the same origin in the same
browser profile. Playback and download require no login. Publishing remains an
explicit, signed-in administrator action.

## Storage and runtime ownership

`src/services/videoDraftStorage.js` owns the version-1 `rivvon-video-drafts`
IndexedDB database:

- `drafts` stores IDs, timestamps, names, original export settings, drawing and
  render snapshots, colour diagnostics, optional poster Blobs, and confirmed
  publication IDs;
- `videos` stores the original encoded Blobs separately, keyed by draft ID;
- `discarded` stores small ID tombstones so stale tabs cannot recreate a
  discarded draft during a late save or retry.

Create/delete transactions cover metadata and video bytes atomically. Promises
resolve on transaction completion, not individual request success. Thumbnail
and publication updates do not rewrite video bytes or erase another tab's
confirmed publication. Database upgrade blocking and version changes are handled.

The `videoDrafts` Pinia store supplies the reactive collection. It saves completed
bytes before thumbnail generation, preserving a successful encode if poster
creation fails. It retains immutable snapshots for publication instead of using
the current scene. Restoration preserves original IDs and creation times and
merges safely with newly completed encodings.

Gallery restoration loads metadata and posters. Full saved video Blobs are read
on demand for playback, download, or publication. Object URLs are recreated in
the current session and never stored. Loaded restored videos are released when
the gallery unmounts; store disposal releases URLs without deleting saved work.
Downloading must not immediately revoke the playback URL.

## Saving, sign-in, and failure recovery

The gallery and completed export show saving, saved, and unsaved states. A failed
write retains the video in memory with Retry saving and Download actions. Quota
failure suggests freeing space explicitly; unpublished videos are never
automatically evicted by Rivvon. Optional poster failures leave the video saved
and allow sign-in. Gallery read failures show Retry loading drafts rather than
a misleading empty collection. Discard waits for persistent deletion and retains
the record if deletion fails; late poster generation cannot undo deletion.

Every `useGoogleAuth().login()` entry point waits for queued draft transactions
and discard actions. It pauses navigation if a completed video remains unsaved,
with a global notice directing the user to Drafts. Retry saving, or download and
discard the unsaved copy, before trying sign-in again.

The OAuth return route now includes pathname, query, and hash. After a successful
session check, app startup restores that destination, including
`/videos?tab=drafts`. Callback and login-error paths use the same validated,
single-use destination handling. Return routes must stay on the current origin;
the backend OAuth origin allowlist is unchanged.

The gallery reports saved video size and an advisory origin-wide storage
estimate, and offers Protect saved drafts using `navigator.storage.persist()`
when available. The browser may decline this request. Drawings, textures, and
videos share browser quota even though they use separate databases.

## Retention and multiple tabs

Drafts belong to the browser profile and origin, not an account: signing in or
out does not remove them, and other accounts on that profile can see them.
They do not transfer to another device, profile, or hostname. Clearing site
data, private browsing lifetime, browser eviction, and disk failure still limit
retention. Download a copy for long-term storage.

BroadcastChannel changes and window focus refresh the collection. IndexedDB
transactions and discard tombstones prevent stale metadata writes from
recreating deleted videos. Web Locks coordinate publication and discard across
tabs where supported. Without Web Locks, cross-tab publication deduplication is
best effort; within one store, concurrent requests still share one upload.

Failed/cancelled uploads retain the local draft. Successful publication persists
the returned video ID and keeps the local copy until explicit discard. Restored
uploads never resume as “in progress.” A crash after server completion but before
the local publication-ID commit can still permit a duplicate retry; full
crash-safe deduplication needs API idempotency and is outside this change.

## Verification

`videoDraftStorage.test.js` exercises atomic writes/deletion, transaction commit
and rollback, portable metadata, stale updates, unavailable storage, and retry.
`videoDraftStore.test.js` covers restored bytes/IDs/snapshots, lazy reads,
navigation ordering, quota recovery, deletion races/failure, poster failure,
restoration failure, concurrent restoration, publication persistence, and
cross-tab publication coordination. Auth tests cover the save barrier and
validated return destinations; gallery tests cover recovery/loading states.

Run `npm run test:run` and `npm run build` from `apps/rivvon`. Browser verification
uses a real anonymous encoding, then checks gallery restoration and playable
video metadata after reload and reopening a tab. No test media is published.

The original investigation and design rationale are in
[Persistent video drafts investigation](persistent-video-drafts-investigation.md).
