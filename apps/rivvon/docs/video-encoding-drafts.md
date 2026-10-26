# Completed video drafts

Completed ribbon and texture-only video exports are retained by the shared
`videoDrafts` Pinia store. The export workflow points to its current draft;
closing it, changing settings, starting a new encode, and navigating away do not
discard completed encodings.

Video Gallery → Drafts lists these encodings newest first, independently of
gallery API availability or authentication. It provides playback, original-file
download, publication through the existing gallery upload form, and confirmed
discard. The completed export workflow also has a Drafts navigation action.

This is session storage in memory, with no IndexedDB or localStorage copy.
Reloading or closing the browser tab clears the drafts. The UI explains that
lifetime and displays the size of the retained video files. Discarding a draft
releases its playback and poster object URLs. Closing playback only removes the
video element, so the draft remains usable. Do not revoke a draft's playback URL
when downloading it.

Register completed bytes before attempting thumbnail generation, so thumbnail
failure does not lose a successful encode. Keep the original settings, source
drawing, render snapshot, and colour diagnostics with the draft; publication
must use those snapshots rather than the current scene. The video Blob is
shared without copying its bytes.

Both publication entry points use the store's per-draft publication action.
Concurrent requests share one upload; already-published drafts open their
existing gallery entry instead of creating duplicates. Failed or cancelled
uploads retain the encoding for retry. In-progress drafts cannot be discarded.
Gallery publication retains its existing signed-in administrator restriction;
local playback and downloads require no login. Publishing keeps the local draft
until it is explicitly discarded or the session ends.

Coverage in `src/stores/videoDraftStore.test.js` exercises ownership across view
lifetimes, multiple exports, immutable metadata, URL cleanup, cancellation,
retry, and publication deduplication. Browser verification uses a short real
encoding, closes the export workflow, then checks gallery playback, navigation,
download, and publication form details without uploading test media.
