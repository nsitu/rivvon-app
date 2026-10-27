# Persistent video drafts investigation

Investigated 2026-10-27. The core proposal was subsequently implemented; see
[Completed video drafts](video-encoding-drafts.md) for current behavior and
remaining publication limitations. The findings and proposal below record the
original investigation.

## Recommendation

Persist completed video drafts automatically in IndexedDB, independently of
authentication. Keep Pinia as the reactive view of the collection. A saved draft
should remain available after sign-in, reload, tab closure, and reopening Rivvon
in the same browser profile at the same origin, subject to browser storage
availability. Publication remains an explicit action.

This is a moderate frontend change. The existing encoder already returns the
complete Blob and the publication pipeline already accepts it, so the core fix
does not require encoder changes, cloud storage, an API migration, or a new
dependency. Storage failure handling and navigation ordering are part of the
core implementation, not optional follow-up work.

## Findings in the current code

- `src/stores/videoDraftStore.js`: `addDraft()` retains the Blob and immutable
  metadata only in a `shallowRef`. Playback and thumbnail URLs are temporary
  object URLs. There is no persistent write or restoration path. Store disposal
  revokes URLs and empties the array.
- `src/views/RibbonView.vue`: all completed ribbon and texture-only exports
  enter this store before thumbnail generation. This is the right persistence
  boundary: save the successful video even if poster creation fails.
- `src/composables/shared/useGoogleAuth.js`: `login()` navigates the current tab
  to the API using `window.location.href`. That navigation destroys the app's
  in-memory drafts. The saved `auth_redirect` contains only `pathname`, losing
  `?tab=drafts`.
- `apps/api/routes/auth.ts`: regular successful OAuth returns to the allowed app
  origin, rather than its `/callback` route. The existing saved-route consumers
  are `CallbackView.vue` and the `/login` redirect in `src/router/index.js`.
  The inspected code does not consume `auth_redirect` on a normal successful
  return to `/`. Simply saving the query string is therefore insufficient.
- `src/services/drawingStorage.js` and `src/services/localStorage.js` already
  use IndexedDB for drawings and texture Blobs. The latter also exposes an
  origin-wide storage estimate. Their schemas are separate from video drafts.
- `src/services/videoService.js` can publish a restored Blob and its original
  metadata without changing its public interface. Both frontend and API
  currently restrict gallery publication to administrators; signing in as a
  regular user will still allow only local playback/download.

## Storage choice

| Option | Assessment |
| --- | --- |
| IndexedDB | Recommended. Asynchronous, transactional, and supports Blobs and structured metadata directly. Fits the existing codebase. |
| localStorage / sessionStorage | Poor fit for video bytes: string-only, small quotas, and sessionStorage does not cover closing and reopening a tab. Keep sessionStorage for the small OAuth return route. |
| Origin private file system (OPFS) | Useful if encoding later streams directly to disk. Adds file/metadata consistency work now; IndexedDB can store the complete Blob already produced today. |
| Anonymous cloud drafts | Introduces upload, retention, ownership, and backend work beyond the requested local workflow. |

[IndexedDB documentation](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)
confirms Blob support and asynchronous transactions.
[OPFS documentation](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system)
describes its file-oriented storage model.

## Proposed implementation

### Storage service and record contract

Add `src/services/videoDraftStorage.js` with a dedicated, versioned database
such as `rivvon-video-drafts`. Prefer separate object stores for draft metadata
and video assets, keyed by the existing UUID, so listing drafts does not require
retrieving every full video. Create/delete metadata and assets together in one
transaction. Thumbnail updates should not rewrite the full video.

Persist an explicit allowlist:

- ID, creation time, name, filename, format, MIME type, and byte size;
- original settings, source drawing payload, render snapshot, and colour report;
- video Blob and optional thumbnail Blob;
- confirmed published video ID and, if needed for account-specific display,
  the publishing account ID.

Do not persist object URLs, Vue proxies, promises, abort controllers, upload
progress, authentication tokens, or `isPublishing`. Generate fresh object URLs
on demand after restoration and release them on preview disposal or eviction
from the in-memory asset cache. Preserve IDs and timestamps; restoring via the
existing `addDraft()` would incorrectly generate new ones.

Resolve mutations only after transaction `complete`; request `success` alone
does not establish that the transaction committed. Handle abort/error, blocked
upgrades, and `versionchange` connection closure. See
[transaction completion](https://developer.mozilla.org/en-US/docs/Web/API/IDBTransaction/complete_event).

### Store, encoding, and gallery integration

Keep immediate in-memory access to a newly encoded Blob, then start saving it
immediately, before thumbnail generation. Track a per-draft state such as
`saving`, `saved`, or `memory-only`, with an actionable error and retry for the
last state. A disk failure must not turn a successful encoding into an export
failure or remove its Download action.

Add an idempotent hydration action and call it at application/store startup.
The gallery should display a loading state until restoration finishes, and a
retryable error if reading fails, rather than showing an empty collection.
Merge restored and newly created records by ID so a late read cannot replace a
new encoding. Load large video Blobs only for playback, download, or publication;
keep the existing publication API by ensuring the selected draft's assets are
loaded first. The export workflow must also reflect storage state, rather than
holding a stale copied record.

Serialize mutations per draft. A discard must not be undone by a queued initial
save or late thumbnail completion. Confirm persistent deletion before reporting
success; on failure retain the draft with an error so it does not unexpectedly
reappear after reload. Store disposal should release runtime resources without
deleting saved drafts. Keep published drafts until explicitly discarded.

### Sign-in and return navigation

Use a shared pre-navigation save barrier for sign-in entry points, including
sign-in from the gallery and global chrome. Wait for pending required video
writes to commit before assigning `window.location.href`. A failed required save
should leave the completed video available with Retry and Download actions and
an explanation that leaving will lose an unsaved draft. Optional poster failure
must not prevent sign-in once the video itself is saved. Saving only during
unload would leave an avoidable loss window.

Save `pathname + search + hash` as the local return route. Consume and clear it
on the actual successful return after the session check, as well as handling
the existing callback/error routes consistently. Accept only a validated
same-origin app destination and preserve the query when adding `auth_error`.
Keep the API's origin allowlist intact. This can be implemented entirely in the
frontend; broadening backend redirects to arbitrary URLs is unnecessary.

### Storage limits and user-facing behavior

Use `navigator.storage.estimate()` as an advisory check. Drawings, textures, and
videos share origin storage limits even when their databases are separate.
Always handle actual write failure, including `QuotaExceededError`. Preserve
the in-memory Blob, explain the failure, and offer retry/download and explicit
discard of older drafts. Do not silently evict unpublished work.

Offer `navigator.storage.persist()` to reduce browser eviction risk, while
allowing saving when the browser declines it. The browser decides whether to
grant the request and may show a permission prompt. See
[persistent storage requests](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist).

Saved drafts belong to this browser profile and app origin, not a signed-in
account. Retain anonymous drafts across sign-in/sign-out and explain that other
accounts using the same browser profile can see them. They do not transfer to
another device, profile, or hostname. Private browsing, clearing site data, and
browser eviction limit retention. Browser-managed local storage is not a
guaranteed backup. See
[storage quotas and eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).

Replace both current session-lifetime notices and discard copy with truthful
storage states. Suggested saved-state copy: “Saved in this browser. Available
after signing in or reopening Rivvon. Download a copy for long-term storage.”
Show total saved size and distinguish unsaved drafts. Follow `DESIGN.md` for any
UI implementation.

### Multiple tabs and publication boundaries

Persistent storage makes the same collection accessible to multiple tabs.
Refresh metadata on focus or send lightweight change notifications, and
reconcile deletion before acting on a stale record. Coordinate updates so
another tab cannot recreate a discarded draft or overwrite its publication ID.
Prevent concurrent publishing of the same draft across tabs, or explicitly
scope that limitation; the existing promise map only deduplicates one store.

Persist the successful publication ID, but do not restore an in-progress upload
as still running. An interrupted upload must leave a usable local draft. A crash
between server completion and the local publication-ID commit can still allow
a duplicate on retry. Full crash-safe publication deduplication would require a
separate API idempotency/reconciliation change: the current creation endpoint
generates a fresh video ID on every request. This is distinct from preserving
the encoding through login.

## Validation and implementation scope

Implement the service and transaction tests first, then store hydration/save
ordering, encoder/gallery integration, and the shared auth return path. Update
`video-encoding-drafts.md` once behavior changes. Keep existing immutable
metadata and publication tests.

Required additional checks:

1. Encode while anonymous, sign in immediately, and return to
   `/videos?tab=drafts` with playable/downloadable bytes and original metadata.
2. Reload and close/reopen the app in a new tab; verify restoration without
   authentication or a gallery API response.
3. Exercise video-save failure, transaction abort, unavailable storage, read
   failure, and thumbnail failure; never label a failed save as saved.
4. Discard while saving or generating a thumbnail; reload to confirm it stays
   deleted. Verify deletion errors and store disposal do not destroy saved work.
5. Verify a large MP4/WebM and multiple drafts without eager full-video reads;
   check Chromium, Firefox, and Safari/iOS for retention and storage failures.
6. Verify two-tab add/discard/publication behavior, failed/cancelled publication,
   sign-in errors, query restoration, and account changes.

Investigation baseline: `npm run test:run -- src/stores/videoDraftStore.test.js
src/views/VideoGalleryView.test.js` from `apps/rivvon` passes all 16 existing tests.
Those tests covered the original in-memory behavior. Implementation adds
persistent-storage, auth-navigation, and recovery coverage; see the current
behavior document for verification details.
