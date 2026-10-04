# Google Photos video import feasibility

Investigated 2026-10-04 against the repository and current Google documentation. The initial design assessment below predates implementation. Google Cloud setup was subsequently completed by the project owner; the deployed import flow still needs an authenticated smoke test.

Implementation follow-up: the REST importer is now implemented locally. See [Google Photos import](google-photos-import.md) for its current token lifecycle, limits, metadata handling, deployment requirements, and remaining authenticated smoke test. The investigation below records the earlier design assessment.

## Recommendation

Proceed with a single-video import using the **Google Photos Picker API**. Add an **Import from Google Photos** action for signed-in users, obtain Photos permission on demand, let the user search and select in Google's picker, download the chosen video, then enter the existing video setup and processing workflow.

Search inside Google's picker is supported. A Rivvon search box querying the user's entire Photos library is not supported by this integration. Since March 31, 2025, the Library API's listing/search/retrieval access is limited to app-created content; older full-library examples and SDK wrappers are unsuitable. [API changes](https://developers.google.com/photos/support/updates), [picker search experience](https://developers.google.com/photos/picker/guides/picking-experience).

## Product capabilities and limits

| Requirement | Feasibility |
| --- | --- |
| Select an existing personal video | Supported through a user-initiated Picker session. |
| Search by keyword, date, location, or album title | Available within Google's selection UI. |
| Embed the picker in a Rivvon dialog | Unsupported: the picker URI cannot be opened in an iframe. Use a separate tab/window. |
| Select exactly one item | Set `pickingConfig.maxItemCount` to `"1"`. |
| Restrict Google's picker to videos | No media-type filter in the documented PickingConfig. Validate the selected item's `type` and ask the user to choose again if it is a photo. |
| Import an exact original video file | Not guaranteed: `=dv` supplies a high-quality transcode. |
| Background library browsing or automatic sync | Outside the Picker API's supported selection flow. |

The picker tab can use `/autoclose`. Completion should be detected by polling, independently of popup communication. [Session configuration](https://developers.google.com/photos/picker/reference/rest/v1/sessions), [video downloads](https://developers.google.com/photos/picker/guides/media-items).

## Fit with Rivvon

- `apps/api/routes/auth.ts` already performs server-side Google OAuth with `openid`, `email`, `profile`, and `drive.file`. The current grant does **not** include Photos access.
- `apps/rivvon/src/composables/shared/useGoogleAuth.js` exposes signed-in state and caches Drive access tokens in memory. Authentication and Photos authorization need separate states; declining Photos permission should leave the Rivvon session usable.
- `apps/rivvon/src/components/slyce/UploadArea.vue` owns Browse Video and invokes `beginFileWorkflowWithFile`.
- `apps/rivvon/src/stores/slyceStore.js` normalizes a supplied file, creates a Blob URL, and advances to video setup. A downloaded `File` can use this same entry point. The processor does not need a Google-specific decoding path.
- `apps/rivvon/src/modules/slyce/localTexturePersistence.js` builds source metadata. IndexedDB saves in `services/localStorage.js` retain a `source_metadata` object, but the builder currently selects ordinary video fields.
- `apps/api/routes/upload.ts` and `apps/api/db/schema.sql` persist selected source fields, with no provider-specific provenance. Both ZIP paths (`modules/slyce/zipDownloader.js` and `services/localStorage.js`) similarly enumerate fields. Simply attaching extra properties to a File will not preserve provenance throughout the workflow.

This is an additional acquisition step before browser processing. The MVP need not store the imported source video in Rivvon's cloud or add it to the administrator video gallery.

## Proposed flow and transport

1. Show Import from Google Photos alongside Browse Video, using the existing PrimeVue workflow button pattern and `DESIGN.md` rules. Register any new Material Symbol in `main.js`.
2. On first use, request `https://www.googleapis.com/auth/photospicker.mediaitems.readonly` through an incremental authorization flow. Check actual granted scopes. Bind authorization to the existing Rivvon user's Google identity and preserve the workflow return route. Preserve existing Drive authorization when extending the grant. [Photos scope](https://developers.google.com/photos/overview/authorization), [incremental OAuth](https://developers.google.com/identity/protocols/oauth2/web-server).
3. Create a session using `POST https://photospicker.googleapis.com/v1/sessions`; open the returned picker URI. Users search and choose in Google Photos.
4. Poll `GET /v1/sessions/{id}` using the returned interval and timeout. Once `mediaItemsSet` is true, list selected items with `GET /v1/mediaItems?sessionId=...`. Handle pagination defensively. [REST methods](https://developers.google.com/photos/picker/reference/rest), [listing](https://developers.google.com/photos/picker/reference/rest/v1/mediaItems/list).
5. Validate one `VIDEO` with `mediaFile.mediaFileMetadata.videoMetadata.processingStatus === 'READY'`. Download `mediaFile.baseUrl + '=dv'` with an OAuth bearer header. Base URLs last approximately 60 minutes and may expire sooner on revocation; retain session access through transfer and delete the session after completion or cancellation. A stored media ID does not provide a standalone retrieval API. [Media access](https://developers.google.com/photos/picker/guides/media-items), [session lifecycle](https://developers.google.com/photos/picker/guides/sessions).
6. Inspect the downloaded response/container and construct a File with a compatible filename and actual MIME type. Keep Google's reported filename separately, since it may describe the original rather than the transcode. Pass the File and explicit provenance into the existing workflow. Decode and measure the imported bytes before processing.

**Recommended transport:** authenticated Worker routes mediate Picker requests and stream the selected video's bytes to the browser. Resolve the download URL server-side from the user's session selection; accept a session/item identifier rather than an arbitrary remote URL. Check ownership, enforce byte/time limits, abort upstream when the user cancels, and use private/no-store responses. Keep tokens and temporary download URLs out of logs and persisted metadata.

Streaming avoids buffering a large video inside the Worker. The browser still needs a local Blob/File for the current processor, so browser memory and download time require an MVP size limit. R2 staging is optional if later requirements justify resumable transfers; it is unnecessary for a first bounded import. [Worker streams](https://developers.cloudflare.com/workers/runtime-apis/streams/).

Direct browser download is an alternative only after testing authenticated CORS access to Google's media endpoint. It should not be assumed to work from an ordinary video element, which cannot attach a bearer header. Rivvon's development server uses COOP `same-origin` and COEP `credentialless`; test picker tab behavior with those headers and verify production headers. Polling avoids reliance on `window.opener`.

**Existing credential detail:** `google_refresh_token` is scoped to `/api/auth`, so new `/api/photos` routes cannot read it. Do not assume the existing Drive token helper solves that. Prefer session-bound, encrypted server-side grant storage, or deliberately keep token mediation under `/api/auth`. Remove existing cookie-value debug logging before adding broader OAuth access. Validate account identity during incremental authorization and preserve refresh tokens when Google's response omits a replacement.

## Metadata preservation

The Picker response provides a persistent media ID, `createTime` (creation rather than upload time), filename, MIME type, dimensions, camera make/model, and video fps/processing status. Its schema has no video duration, original byte size, description, album membership, GPS fields, or product URL. Optional/missing values must remain missing rather than being inferred. [Media schema](https://developers.google.com/photos/picker/reference/rest/v1/mediaItems).

Keep Google's reported source facts separate from measurements of the downloaded transcode. A proposed versioned provenance object is:

```json
{
  "version": 1,
  "provider": "google-photos",
  "mediaItemId": "<picked item id>",
  "createTime": "<Google timestamp>",
  "originalFilename": "<reported filename>",
  "reportedMimeType": "<reported MIME type>",
  "reportedWidth": 1920,
  "reportedHeight": 1080,
  "reportedFps": 30,
  "cameraMake": null,
  "cameraModel": null,
  "importedAt": "<Rivvon timestamp>",
  "downloadVariant": "google-photos-dv-transcode"
}
```

Retain current processing fields for measured duration, dimensions, fps/frame counts and byte size. Add provenance to store state, reset it on new local selection, merge it during local saves, copy it to derived texture variants, and round-trip it through both ZIP formats. Add a validated JSON column or equivalent source record for cloud persistence and owner-only reads. Public responses and shared artifacts should expose source identifiers and capture details only through a deliberate user choice. Never persist access tokens, picker URIs, session IDs, or base URLs as provenance.

## Google Cloud setup and SDK choice

Use the project and Web OAuth client already configured for Rivvon where possible:

1. Enable **Google Photos Picker API**, which is distinct from the Drive-oriented **Google Picker API**.
2. Add the Picker scope to the consent configuration; configure test users for development and prepare Google's review before public rollout.
3. Check the Web client's exact redirect URI. Current code uses `https://api.rivvon.ca/api/auth/callback`; register the actual development callback too. If using browser OAuth, register the relevant authorized JavaScript origins.
4. Keep the client secret in Worker secrets. Service accounts cannot access users' Photos libraries. [Cloud configuration](https://developers.google.com/photos/overview/configure-your-app).

External OAuth apps in Testing receive refresh tokens that generally expire after seven days when requesting scopes beyond basic identity. Account revocation and organizational restrictions also need recovery paths. [OAuth token lifecycle](https://developers.google.com/identity/protocols/oauth2).

An SDK is optional. Google publishes a Picker sample and a small REST API surface. For Rivvon's Hono/Cloudflare Worker, a typed `fetch` service fits the existing backend; my recommendation is to avoid adding a large Node SDK solely for these calls. Google API/OAuth client libraries are available, and Google Identity Services' browser token model is an alternative for browser authorization, subject to the transport and isolation tests above. [Picker sample](https://developers.google.com/photos/picker/samples), [Google API clients](https://googleapis.dev/nodejs/googleapis/latest/), [browser token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model).

Picker quotas are documented as 100,000 API requests/minute/project and 1,000,000 media-byte requests/minute/project. Confirm actual project quotas and back off on 429 responses. Download bandwidth and device memory are more relevant MVP constraints than these published request ceilings. [Quotas](https://developers.google.com/photos/overview/api-limits-quotas).

My assessment is that creative video processing fits Google's stated editing/exporting use cases, subject to Google's review. Provide a clear import disclosure, use Photos permission only for the requested feature, explain retained metadata and deletion, and require a separate deliberate sharing action for public output. [Photos data policy](https://developers.google.com/photos/support/api-policy).

## Validation before rollout

Start with a test-account spike: additional consent, one selected video, authenticated streamed download, and existing browser decoding. Test Chrome, Safari/iOS, and Android with deployed isolation headers; exercise cancellation, denied/revoked permission, mismatched Google accounts, photos selected accidentally, videos still processing, session expiry, oversized streams, and missing Content-Length.

Then verify provenance survives processing, local save/reload, derived variants, both ZIP export/import paths, cloud publish/reload, and owner-only access. Check actual container, orientation, dimensions, frame rate and any HDR/color changes on several phone videos. Import success must not reset a working session on cancellation or quietly publish the imported media.

**Decision:** feasible for user-selected video import with search in Google's picker. Exact-original retrieval and custom full-library search are outside this MVP. The remaining empirical gates are Google project configuration/review, browser transfer/decoding, and metadata round-tripping; no authenticated end-to-end claim has been established by this investigation.
