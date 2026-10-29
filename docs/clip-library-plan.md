# Clip library and looping video backgrounds

Status: implemented locally, 2026-10-29. See [clip-library.md](clip-library.md) for behavior, verification, deployment steps, and remaining device checks. The following records the implementation plan. Subsequent updates replaced the initial H.264-only policy with detected-container and first-frame decoding checks, and added decoded playback when native playback is unavailable. No deployment is included.

## Recommendation and scope

Add **Clips** as a separate resource library at `/clips`. Keep rendered results in the existing Video Gallery (`/videos`, `video_exports`). A clip is an immutable media resource that a scene references; a rendered video is a published result with export settings, provenance, and optional browser drafts. Reuse their interaction and upload concepts, without making scene dependencies point at gallery publications.

For the first release, support uploading, browsing, previewing, renaming, deleting, and applying owned clips as a muted, looping background. Include persistence, shared presets, still capture, and both scene video exporters. This crosses the frontend, renderer, shared preset contract, API, D1, and R2. The largest uncertainty is decoder/render integration, so prove that before building the full library.

Recommended boundaries:

- One image **or** clip occupies the existing background texture layer. The underlying animated/gradient background, water, and overlay retain their current composition order.
- Rename the user-facing **Static Texture** section to **Background Media**; keep existing stored setting names where practical. Do not duplicate all image adjustments for clips.
- Applying a clip enables the layer and defaults a change of source kind to Normal blending. Replacing one clip with another retains the selected blend and adjustments. Applying an image from a clip defaults to Normal; built-ins retain their established Soft Light behavior.
- Playback is always muted. Embedded audio is ignored by scene playback and exports; the existing scene audio system remains responsible for sound. Original clip bytes may still contain audio and metadata: private storage is not a metadata-removal promise.
- Input policy: self-contained video containers readable by Mediabunny, with browser decodability and a successful first-frame probe, up to 1 GB (1,000,000,000 bytes), 60 seconds, 60 fps, 1920 pixels on the longest side, and 2,073,600 displayed pixels. Accept portrait orientation within the same budget. Validate support for native playback and deterministic decoding. These are proposed product limits, not current platform limits.
- No transcoding, HDR tone mapping, interlaced processing, trimming, arbitrary speed control, crossfades, transparent video, external streaming URLs, Drive destinations, or gallery-to-clip conversion in this release. Container support includes MP4, MOV, WebM, MKV, MPEG-TS and Ogg video. Unsupported files receive an actionable read/decode message; opening a container alone does not prove its video track can be decoded.

## Existing implementation to build on

| Area | Current code | Planned use |
| --- | --- | --- |
| Private resource library | `apps/rivvon/src/views/ImageLibraryView.vue`, `services/imageService.js`, `services/backgroundImageCache.js` | Owner listing, upload queue, previews, selection, access scoping, cancellation, and safe replacement patterns. |
| Rendered video gallery | `apps/rivvon/src/views/VideoGalleryView.vue`, `services/videoService.js`, `modules/viewer/videoThumbnail.js` | Video preview, metadata, thumbnail, progress, and retry ideas. Its public CDN delivery and export publication model are unsuitable for private resources. |
| Background composition | `apps/rivvon/src/composables/viewer/useSceneBackground.js`, `modules/viewer/backgroundTextureAdjustments.js` | Feed a dynamic texture into the existing WebGL and WebGPU paths, including direct and blurred paths. Preserve cover fit, alignment, flips, Normal/Soft Light, gradient mapping, contrast, and saturation. |
| State and controls | `stores/viewerStore.js`, `components/viewer/AnimationSettingsControls.vue`, `BackgroundImageSelection.vue` | Generalize current-media display and Choose/Change actions. Update preferences, defaults, resets, snapshots, and change detection together. |
| Library navigation | `router/index.js`, `views/RibbonView.vue`, `components/viewer/BottomToolbar.vue` | Add a route-backed overlay that keeps the canvas mounted, preserves scene/query context, and returns to Tools or the existing export panel. |
| Media inspection/decoding | Existing Mediabunny dependency; `modules/slyce/metaDataExtractor.js`, `samplingSources.js` | Reuse focused decoding knowledge and helpers, without coupling clips to the Slyce store or tile-generation workflow. |
| Exports | `composables/viewer/useSceneExport.js`, `components/viewer/TextureOverviewPreview.vue` | Both currently render synthetic timestamps. Add awaited clip-frame preparation before rendering each frame. Still capture and realtime recording also need explicit behavior. |
| Presets and deletion | `packages/shared-types/src/scenePreset.js`, `apps/api/routes/presets.ts`, `utils/presetDependencies.ts`, migration `013_image_assets.sql` | Extend stable references, preset-scoped access, dependency tracking, readiness checks, and consent-based deletion. Current preset schema version is 2. |

The image implementation is present locally; its documentation still records deployment prerequisites. Verify that baseline before rollout, and deploy cumulative migrations rather than assuming production already has image resources.

## User experience

1. **Browse → Clips** opens the Clip Library. Start with **My Clips**; do not add an empty Built-in collection. Signed-out users see the existing sign-in pattern.
2. **Upload clips** explains private Rivvon storage, supported formats/limits, muted scene use, and how sharing a preset grants access to its clip. Uploading alone does not change the scene. Process one upload at a time, with progress, cancel, retry, and cleanup.
3. Cards show a poster, name, duration, and dimensions. Use posters in the grid; opening a card starts one muted, inline looping preview. Stop that preview when it closes, another clip opens, the panel hides, or the account changes. Provide accessible play/pause controls.
4. **Apply as background** closes the library immediately and uses the shared loading overlay. Prepare metadata, the first decoded frame, and the renderer resource before committing. A failed or superseded request preserves the previous source, enabled state, blend, adjustments, and playback position.
5. Background Media shows the selected poster/name, Image/Clip identity, and **Change media**. The chooser offers Images and Clips using PrimeVue controls and opens the corresponding library. Clip-specific controls expose **Original speed** and **Speed up to align with loop**. The alignment option automatically selects the smallest speed increase that fits a whole number of clip repetitions into the target loop; it never slows the clip down. Show the computed multiplier, percentage increase, and repetition count, and update them when the target loop changes. Disabling the layer keeps its reference/settings and stops decoding; re-enabling starts the selected clip at its beginning.
6. Keep the existing image-library return contract: Tools cancellation preserves its original-state snapshot; Apply returns to the scene. From Export Video, return to the still-mounted export dialog with its form intact. Prevent selection or timing changes while encoding. Direct `/clips`, browser Back/Forward, close, and narrow-screen preview replacement need explicit behavior.
7. Missing/deleted/unsupported clips remain identifiable and replaceable after loading saved artwork. Report the failure without preventing viewer initialization. Exports must reject an enabled unavailable clip rather than silently omit it.

Follow `DESIGN.md`: shared header context and X; `viewer-chrome-panel-container`; constrained `ScrollPanel.rivvon-scroll-panel`; `PanelActionBar`, `ChromeButton`, and PrimeVue workflow controls. Keep Done in the lower action bar. Include focus return, keyboard navigation, accessible labels, loading/empty/error/disabled states, and reduced-motion behavior. Respect the existing scene pause policy; where reduced motion has no established policy, start clips paused with an explicit Play action. Register every new Material Symbols name in `apps/rivvon/src/main.js`.

## Resource model, storage, and API

Create `clip_assets` with owner/status/creation indexes and at least:

- `id`, `owner_id`, `name`, `source_filename`, `source_mime_type`;
- verified container/MIME, codec/profile, coded and display dimensions, rotation, first presentation timestamp, duration, frame-rate statistics, and SDR/color metadata;
- expected and actual file sizes; clip/poster object keys; poster type/dimensions/size;
- `storage_provider`, status (`uploading`, `complete`, `deleting`), upload expiry, and timestamps.

The stored clip is immutable once complete. Replacement creates a new asset ID; rename updates metadata only. Use a dedicated private `CLIPS_BUCKET` binding with no public domain or r2.dev access. Do not reuse the gallery's public URLs. A future explicit **Save as clip** operation can create an independently managed clip, without tying its lifetime to a gallery entry.

Match the existing singular-write/plural-read convention:

| Endpoint | Purpose |
| --- | --- |
| `GET /clips?limit=&offset=` | List the current user's completed clips. |
| `GET /clips/:id` | Accessible metadata, with optional `sourcePresetId` grant context. |
| `GET/HEAD /clips/:id/assets/clip` | Authorized streaming with single-byte-range support. |
| `GET /clips/:id/assets/thumbnail` | Authorized poster delivery. |
| `POST /clip` | Create a pending upload with server-generated keys and bounded metadata. |
| `PUT /clip/:id/assets/clip` and `/thumbnail` | Authenticated, bounded upload. |
| `POST /clip/:id/complete` | Verify objects and media metadata, then atomically finalize; idempotent. |
| `PATCH /clip/:id` | Rename an owned clip. |
| `GET /clip/:id/preset-dependencies` | Review affected presets before deletion. |
| `DELETE /clip/:id` | Delete with reviewed preset IDs and a server-side dependency recheck. |

Use streamed uploads through the Worker into R2: small files retain the bounded single-request endpoint, while files above 64 MiB use server-managed multipart sessions and 8 MiB requests to support the 1 GB file limit. Enforce declared length and an actual streamed byte cap; do not copy the image route's whole-body buffering for videos. Give every attempt a unique immutable key. Finalization compares actual size and server-parsed container/track metadata to the allowed policy; MIME and browser-supplied duration/dimensions are insufficient. Inspect the MP4 structure with bounded reads and parsing budgets, including non-fast-start files. Select or implement a Worker-compatible parser during the initial spike. Validate the poster with the existing shared image inspector. A client decode check improves feedback but is not a server validation substitute or a guarantee against later decode failure.

Reject malformed, encrypted, unsupported, non-finite-duration, oversized, or out-of-budget files. Expire pending uploads and retry deletions through the existing scheduled cleanup entry point. Preserve the image flow's conditional finalization/deletion locks so late uploads cannot revive or overwrite a completed/deleting asset. Include abandoned attempt objects in cleanup.

Authorize metadata, poster, HEAD, and every range request for the owner or a visible preset that registers this exact dependency. Implement 200/206/416, `Content-Length`, `Content-Range`, `Accept-Ranges`, and appropriate MIME/CORS headers; use private, no-store responses and preserve access-scope isolation. Credentialed cross-origin native playback and decoder reads must work against the real API origin, without tainting canvas captures. Do not expose permanent public or unsigned R2 URLs.

## Scene state and migration

Extend the existing canonical source instead of adding a competing video-enable flag:

```js
backgroundTextureSource: { kind: 'builtin', id: 'card' }
// or { kind: 'image', id: '<image-id>' }
// or { kind: 'clip', id: '<clip-id>' }
backgroundTextureEnabled: true
backgroundClipPlaybackMode: 'native' // or 'alignLoop' (automatic speed-up only)
```

Retain existing blend/adjustment fields and the legacy built-in string as a compatibility mirror. Move the shared source normalizer out of the image-specific module into a media-source module, retaining a compatibility re-export if useful. Image-only loaders must explicitly reject clip references; dispatch through a media resolver instead of teaching an image decoder to accept video.

Bump `SCENE_PRESET_VERSION` to 3 and explicitly accept/upconvert versions 1, 2, and 3. Version 1 retains its built-in/Soft Light migration; version 2 retains image references and all current appearance settings. Add the playback field to the shared allowlist, validators, defaults, preferences, resets, Tools snapshots, comparison/restore, and render watchers. Existing scenes remain visually unchanged. Do not silently coerce unavailable clip IDs to Card.

Generalize the transient image preset grant, busy state, and error state to background media, including account changes and failed preset application/rollback. Preserve compatibility with old stored preferences where needed. Save only stable IDs and playback settings, never playback position, URLs, access grants, video elements, decoder state, or GPU resources. Persist the alignment mode rather than its derived multiplier/repetition count; resolve those from the verified clip duration and current target loop. An export-specific target must not overwrite the saved scene settings.

## Renderer and lifetime

Introduce a background-media adapter with `texture`, explicit display dimensions, readiness, live pause/resume, deterministic frame preparation, timeline snapshot/restore, and idempotent release. The current adjustment code reads image dimensions; update it to consume display dimensions so rotated/portrait video fits correctly.

Recommended initial implementation: a fixed-size canvas-backed texture per renderer consumer. Draw native video frames during live playback and decoded samples during export into that same surface. This keeps the sampler type stable across WebGL/WebGPU and preview/export, avoiding dependence on a native VideoTexture continuing to advance while paused for synthetic export. Mark the texture dirty only on a new frame, use the established SDR/sRGB conventions, and verify orientation, color, and blur in both renderers. This extra copy has a performance cost; benchmark it in the spike. A native VideoTexture fast path is a later optimization if needed, with explicit material reconstruction when switching texture types.

Use a muted, `playsInline` video element for live playback and the scene clock as the timeline authority. Anchor/reset playback on Apply; correct on resume, clock reset, or mode change rather than seeking every render tick. Draw new presented frames using `requestVideoFrameCallback` where available and a bounded fallback otherwise. Request a scene render when needed even if no other animation is active. Catch rejected `play()` promises, retain a decoded frame, and expose a user-triggered Play action. Browser playback requests can be blocked, as documented by [MDN](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/play).

Keep independent mutable playback/decoder state for the scene, library preview, and texture overview. Shared metadata or immutable bytes may be deduplicated with bounded, access-scoped leases; never share a mutable playhead. Pause background consumers when hidden, disabled, or exporting, and coordinate visibility with the existing scene clock. Release callbacks, media sources, decoders, samples, canvas/GPU textures, listeners, requests, and any Blob URLs on replacement, logout, renderer changes, and unmount. Account changes must stop retained private playback before rechecking access.

Stage replacement before disposing the active runtime, and retain generation/abort protection across source changes and preset restoration. Extend every background path, including TextureOverviewPreview and its exporter; a working main canvas alone is insufficient.

## Timing, loop boundaries, and exports

For clip duration `C`, elapsed scene time `t`, and target loop duration `L`, choose the smallest integer number of clip repetitions that requires no slowdown:

```text
Original speed: localTime = positiveModulo(t, C)

Speed up to align with loop:
  repetitions = ceil(L / C)
  playbackRate = repetitions * C / L
  localTime = positiveModulo(t, L) / L * repetitions * C
  localTime = positiveModulo(localTime, C)

decodeTimestamp = firstPresentationTimestamp + localTime
```

For positive finite durations this gives `playbackRate >= 1`, with the minimum rate among all whole-number repetition counts. A clip that already divides the target loop stays at 1×. Use precise media timestamps/rational time units and numerically stable boundary comparisons to avoid an extra repetition caused by floating-point noise at exact multiples. Do not round durations or the multiplier to the values displayed in the UI before calculating sample times.

| Clip duration | Target loop | Repetitions | Playback rate | Result |
| --- | --- | --- | --- | --- |
| 8 s | 12 s | 2 | 1.333…× (+33.3%) | Two complete clip repetitions in 12 s. |
| 20 s | 12 s | 1 | 1.666…× (+66.7%) | One complete clip repetition in 12 s. |
| 6 s | 12 s | 2 | 1× (+0%) | Already aligned; no speed change. |

Original speed is the default and repeats independently of other scene animations. The alignment option replaces the earlier proposal to stretch one clip to one scene cycle, which could unnecessarily slow short clips down. For normal live viewing, `L` is the scene cycle derived from the existing camera/material loop policy. For automatic video exports, `L` is one finalized export cycle; loop count repeats that cycle at the same rate. For an explicit manual export duration, `L` is the actual output duration, so the background aligns at the file boundary even when that duration truncates other scene animations. This aligns the background only; it does not change the timing of the artwork, camera, or audio.

Resolve the export target after camera preparation and final frame-count calculation, using the actual encoded period rather than an unrounded requested duration. Automatic repeated exports must use a consistent whole number of frames per cycle so every cycle boundary and the final file boundary align. Render timestamps run from frame 0 through frame N−1; do not append a duplicate closing frame. Show the final effective multiplier, percentage increase, repetition count per target loop, and target duration in the existing export cycle information. The export preview must use that same timing plan, including manual duration, fps, and loop count. Recalculate when those inputs change, then freeze the plan at export start. Restore the live timeline and rate after completion or cancellation.

Do not silently cap the derived rate: that would break alignment. Large increases must remain visible before encoding. Deterministic export selects samples using the mapping above, independently of native `HTMLMediaElement.playbackRate` limits. The live/preview adapter must verify it can represent the computed rate, use timestamp-driven sample presentation if native playback cannot, or expose a clear unsupported-preview state; never show an apparently aligned preview at a different speed. Include extreme-rate behavior in the rendering spike.

Repeating a clip does not make its last and first frames visually continuous. Automatic speed adjustment aligns its temporal phase at the loop boundary; it cannot repair a visible cut in the source clip. Do not add hidden interpolation or promise a seamless result. In Original speed mode, an output boundary can also land mid-clip; make that visible in export cycle information and qualify existing automatic “seamless loop” wording when the clip does not align. Do not calculate an unbounded least-common-multiple duration for arbitrary media.

Use the installed Mediabunny version to decode the sample presented at each requested timestamp, accounting for a nonzero track origin, presentation ordering, variable frame rate, and the final frame interval. Its [media-sink documentation](https://mediabunny.dev/guide/media-sinks) describes timestamp-based sample access and cleanup; verify exact APIs against the installed version. Decode incrementally with bounded retained frames and restart/reseek at wraps. Do not preload every frame, use wall-clock playback during export, or treat a seek event/timeout as proof that the requested pixels are ready.

Add an asynchronous `prepareFrame({ timeSeconds, clipTimingPlan, signal })` stage before each synchronous scene render in both exporters. The immutable timing plan contains the playback mode, verified clip duration, target loop duration, repetition count, and derived rate. Keep clip preparation separate from existing texture-array RIFE/crossfade interpolation so either or both can run. The render-to-encoder order must be decode → draw/update texture → background composition → scene render → encode. Ensure the GPU has consumed frame pixels before releasing/replacing them where required.

Still exports and preset thumbnails capture the current scene clip phase, frozen through readiness, resize, render, and capture. Realtime recording follows live scene playback and remains muted. All export paths pin the selected asset/settings, reject enabled missing media, honor cancellation, and restore preview phase/play state in `finally`, including on decode/encoder failure. Cancel must release a stalled decoder/request promptly. If deterministic decoding is unsupported on a device, keep live viewing available and explain why video export cannot proceed; never quietly export a frozen background.

## Preset dependencies and deletion

Add `clip_asset_id` to `preset_media_dependencies`, preserving texture, audio, and image rows when rebuilding its exclusive-one-resource constraint. Add lookup/unique indexes and readiness, deletion-consent, and deletion-lock triggers for clips. The next migration is currently `014`; confirm numbering at implementation time.

Register a clip dependency whenever the selected source is a clip, even when Background Media is disabled. Verify readiness and ownership or a source-preset grant when saving. Opening a visible preset grants access only to its registered clip; derivative presets retain the reference and their own dependency, so deleting the source preset does not accidentally break a valid derivative grant. A preset never adds the clip to another user's library and does not copy its bytes.

Match image deletion semantics: list affected presets, explain that deletion removes them and disables their links, require their reviewed IDs, then recheck transactionally. Newly created dependencies produce a reviewable conflict. Deleting a preset alone retains the clip. After owner deletion, invalidate active consumers and show a recoverable missing-media state for any selected reference. Apply auth/access errors consistently to every delivery path.

## Implementation sequence and verification

1. **Rendering/decoding spike.** Use a small frame-numbered MP4 with nonzero timestamps and a rotated fixture. Prove live repeat, scene-clock pause/resume, both timing modes, minimum-speed alignment, extreme computed rates, arbitrary-timestamp decoding, repeated export wraps, still capture, and a shared canvas texture in WebGL/WebGPU. Measure 1080p playback with blur on desktop/mobile and test codec capability checks. Prove bounded server inspection and credentialed range delivery. Resolve the adapter/parser choices here before committing to the full UI.
2. **Resource infrastructure.** Add shared clip validation contracts, migration, private bucket/types/config, routes, streaming uploads, metadata verification, range reads, preset grants, deletion, and cleanup. Cover malformed files, actual byte caps, invalid ranges, unauthorized access, duplicate completion, late uploads, expiry, and upload/delete/finalize races.
3. **State and renderer integration.** Add schema 3/migrations, source dispatch, per-consumer media adapter, appearance controls, safe replacement, disabled/missing states, and account/resource lifetime handling. Test old preferences/presets and image appearance regressions.
4. **Library and settings.** Add `/clips`, Browse entry, ClipLibraryView, preview, upload queue, rename/delete dialogs, generalized current-media selection, and playback mode control. Verify Tools cancel/apply, browser history, direct routes, export-panel preservation, focus return, narrow layouts, sign-in changes, and rejected autoplay.
5. **Export integration.** Add deterministic preparation and restoration to the main and overview exporters, stills, preset thumbnails, and realtime recording. Test output with numbered frames at multiple fps, durations, loop counts, native/aligned modes, variable-frame-rate input, first/last timestamps, cancellation, and failures. Cover clips shorter/longer than the target, exact divisors (no speed change), near-integer duration ratios, fractional frame rates, manual durations, and camera-generated duration changes. Assert the smallest rate >= 1, whole-number repetitions at the actual encoded boundary, consistent repeated-cycle boundaries, and matching preview/export timing. Compare exported pixels/phase rather than merely checking that a Blob exists.
6. **Release validation.** Run the frontend/API Vitest suites and both production builds; browser-check current Chromium and Safari/mobile playback plus WebGL/WebGPU. Repeatedly open, replace, disable, export, cancel, and sign out to check decoder/GPU/network cleanup. Document supported inputs, storage/access, loop semantics, deployment prerequisites, and verified limitations.

Roll out the private bucket and migration first, then an API accepting preset versions 1–3, then the frontend that writes version 3. Confirm actual cross-origin authenticated upload/playback/export and preset sharing against deployed storage. Use a feature flag if infrastructure lands in separate releases. A frontend rollback must report version-3 presets as unsupported, not silently discard their clip backgrounds.

The feature is complete when an uploaded clip loops in the background, survives reload and preset sharing, respects pause/disable/replacement, exports the expected numbered frames at synthetic timestamps, and leaves existing image backgrounds unchanged.
