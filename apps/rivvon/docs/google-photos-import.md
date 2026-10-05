# Google Photos import

Signed-in users can choose **Google Photos → Import…** in the Create menu's Texture section. This click opens a centered Google window and starts the import automatically when the source screen mounts, without another Import button. The action is also available on the Video File source screen. The current video workflow is preserved until a new video is imported; **Continue Current Video** returns to that workflow after cancellation. When permission is needed, Google's authorization callback creates the selection session and redirects the same window straight to the picker. With an existing grant, Rivvon creates the session and opens the picker directly. Search, choose one video, and finish the selection. The Google window automatically closes; Rivvon downloads the video and opens the existing video settings workflow. Browsers may open a tab instead of a popup. Continuation links appear only if opening the Google window was blocked or failed.

The importer uses REST calls through `/api/auth/photos`, with no Google SDK. Search remains in Google's picker. Selected photos and videos that have not finished processing are rejected. Imports are bounded to **2048 MiB (2 GiB)** and a **five-minute transfer timeout**; downloads support byte progress without Content-Length and can be cancelled. Closing Create also cancels the import and cleans up the Picker session.

The Worker relays chunks as they arrive from Google; it does not buffer the complete video. The browser collects those chunks into a File before processing. Before bytes arrive, Rivvon shows separate stages for reading the selection, requesting the video, and waiting for first data, with elapsed seconds for each stage. Google does not provide a download-preparation percentage. Its high-quality `=dv` video response can take a few seconds to begin, but a longer observed delay needs measurement rather than an assumption about transcoding.

When Google supplies a size, the API forwards it in `X-Rivvon-Video-Length` for percentage and total-size progress. Cloudflare Workers ignores manually set Content-Length on arbitrary streams, so using a separate exposed header preserves progress without buffering. Unknown-size downloads show received MiB. The bytes endpoint also exposes `Server-Timing`: `photos-metadata` measures selection revalidation, and `google-video-headers` measures the media fetch including redirects until response headers. Inspect those response headers and the browser Network timing to diagnose a real import. These timings become available after the upstream headers arrive, not while Google is still waiting to respond.

## Investigating a slow response

Both `/video` and `/video/bytes` expose `Server-Timing`. `google-session` and `google-items` measure the individual Picker metadata calls, including reading their JSON responses. The bytes response also reports `google-media-hop-1` through `google-media-hop-5` for media requests and redirects. `photos-metadata` already includes the metadata calls, and `google-video-headers` already includes the media hops; do not add overlapping metrics together.

The browser prints one **Google Photos import timing** JSON summary after an attempt has reached selection validation and finished cleanup. It contains only timings, byte count, outcome, and a random trace ID:

| Measurement (milliseconds) | Interpretation |
| --- | --- |
| `metadataRequestMs` | Browser round trip for the first selection validation, including reading JSON. Compare with `metadataServer`. |
| `downloadHeadersMs` | Browser wait for the bytes response headers. Compare with `downloadServer`, which includes the second selection validation. |
| `firstDataAfterHeadersMs` | Additional browser wait for the first nonempty video chunk after response headers. |
| `selectionReadyToFirstByteMs` | Total delay from Rivvon detecting a finished selection until its first video chunk. Excludes time spent in consent, choosing a video, and selection polling. |
| `transferMs` | Time from the first chunk to the end of the downloaded response. |
| `inspectionMs` / `cleanupMs` | Local video validation and the final session-delete round trip. Cleanup is awaited before the imported file returns to the workflow. |
| `selectionReadyToFinishMs` | Entire post-selection attempt, including cleanup. |

Worker console entries labelled **Google Photos download timing** report `headers`, `first-byte`, then `complete`, `cancelled`, `aborted`, or `failed`. Match their random `traceId` to the browser summary or `X-Rivvon-Import-Trace` response header. Worker `firstByteMs` is measured from the beginning of the bytes handler; `bodyMs` is elapsed time since the Google response headers. Use configured Worker logs or `pnpm --filter api exec wrangler tail --format pretty` while reproducing an import. The diagnostic payloads omit credentials, filenames, source URLs, account IDs, and provider media/session IDs. They do not create a database record or send browser diagnostics to another endpoint.

To capture evidence, open browser DevTools, filter Console for **Google Photos import timing**, and import a video. Copy that JSON summary, rather than a HAR containing cookies or provider URLs. Repeat with the same video, then a different video, to check whether the delay is consistent or changes after the first request. If most time is in `google-video-headers`, Google's media response is the bottleneck, but timings alone cannot prove on-demand transcoding. If the server is quick and the browser remains slow, investigate browser/network/relay delivery. If metadata or cleanup dominates, optimize those calls instead. Unknown or failed stages may omit measurements; a failed attempt is not a successful latency sample.

## Authorization and source metadata

Photos authorization uses the existing Web OAuth client and `/api/auth/callback`. It requests the Picker scope only in the import flow. The signed-in Google identity is checked before accepting the grant. Short-lived access tokens are encrypted using a purpose-specific AES-GCM key derived from `SESSION_SECRET`, stored in HttpOnly cookies under `/api/auth`, and never exposed to the browser's JavaScript. For first-time authorization, an encrypted `photos_picker` cookie stages the callback-created session for ten minutes; authorization polling returns that session only to the matching signed-in account and import attempt. Session cleanup clears the matching staged session. The Photos flow leaves Drive refresh credentials and the Rivvon login unchanged. A new authorization is needed after the Photos token expires or is revoked. Logout clears the Photos cookies. No additional Worker secret, migration, or SDK is needed for this flow improvement.

Google provides a high-quality transcode, not a guaranteed byte-identical original. Rivvon inspects the downloaded container and measures the processing file independently. Source provenance records the selected media ID, original filename, creation timestamp, reported dimensions/frame rate, available camera details, import timestamp, and download variant. Temporary URLs and credentials are never retained as source metadata. Source details are shown in Video Details, retained in local saves and texture variants, and included in user-requested ZIP exports. The ZIP viewer retains the imported metadata object.

Cloud uploads store allowlisted provenance in the `source_provenance` column. Texture detail responses return it only to the signed-in owner; public/other-user responses omit it. Cloud detail reads are private and not cacheable. Deleting the texture removes its associated provenance. Importing itself does not save the source video to R2 or publish a texture.

## Deployment

1. Keep Google Photos Picker API enabled in the existing OAuth client project and the scope declared in Google Auth Platform → Data Access. Configure Google review/test access for the intended audience.
2. Apply migration `011_texture_source_provenance.sql` before deploying the API. The existing main-branch deployment workflow applies pending D1 migrations automatically; for a manual deployment, use `pnpm --filter api db:migrations:apply:remote` first.
3. Deploy the API and frontend together. Existing login, client secret, API URL and CORS configuration are reused. Development callbacks still need to be registered for the actual local API origin.
4. Verify one real account through additional consent, picker selection, download, processing, local save/ZIP, and cloud publish/reload. Check Chrome, Safari/iOS, and Android using deployed COOP/COEP headers. The importer polls server state and does not require popup opener communication.

Automated tests cover authorization denial, mismatched state/account, expired/tampered credentials, grant ownership, single-video validation, revoked access, download limits and redirects, cancellation, metadata retention on local/cloud variants, and private owner reads. Real Google account consent and provider download behavior require an authenticated deployment smoke test.
