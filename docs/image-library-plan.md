# Image library and static backgrounds

Status: approved and implemented locally on 2026-10-29, including a selectable Normal/Soft Light dropdown. See [image-library.md](image-library.md) for implementation behavior, verification, and deployment requirements. The remaining text records the original implementation plan.

## Feasibility and recommendation

This is feasible within the existing Vue/Pinia, Hono, D1, R2, and Three.js architecture. Add images as a distinct resource type, with a library that supports upload, browsing, preview, rename, deletion, and **Apply as background**. Reuse the library interaction patterns and background rendering pipeline. Image resources should remain independent of their first use as scene backgrounds, so later features can reference the same asset IDs.

The work is moderate in scope and crosses the frontend, API, database, storage configuration, and preset contract. The gallery itself is straightforward. The main integration work is authenticated asset loading, preserving existing scenes, resource lifetime, and preset sharing/deletion. No new image hosting service, KTX2 conversion pipeline, or general media-framework rewrite is required.

One product distinction matters: the current **Static Texture** is a soft-light layer composed with the scene background. Applying an arbitrary photo through that path changes its appearance. Recommended behavior is to offer **Normal** and **Soft Light** blending, default uploaded images to Normal, and retain Soft Light for existing backgrounds and migrated scenes. Normal replaces the underlying background wherever the image is opaque; the existing adjustments and subsequent effects can still affect it. The built-in default and existing artwork must look unchanged.

## What exists today

| Area | Evidence | Consequence |
| --- | --- | --- |
| Built-in selection | [`backgroundTextures.js`](../apps/rivvon/src/modules/viewer/backgroundTextures.js) contains Card, Textile, and Cenote, their public URLs, and a normalizer that converts unknown values to Card. | Resource IDs cannot simply be placed in the current string field. Preserve these three images as built-in library entries. |
| Settings | [`AnimationSettingsControls.vue`](../apps/rivvon/src/components/viewer/AnimationSettingsControls.vue) contains Static Texture's selector, alignment, gradient map, contrast, and saturation. It is mounted in both [`BottomToolbar.vue`](../apps/rivvon/src/components/viewer/BottomToolbar.vue) and [`ExportVideoDialog.vue`](../apps/rivvon/src/components/viewer/ExportVideoDialog.vue). | Replace the selector with a current-image summary and library action, and support both entry contexts. |
| Rendering | [`useSceneBackground.js`](../apps/rivvon/src/composables/viewer/useSceneBackground.js) loads an ordinary Three.js texture, marks it sRGB, and uses soft-light composition in WebGL and WebGPU paths. [`backgroundTextureAdjustments.js`](../apps/rivvon/src/modules/viewer/backgroundTextureAdjustments.js) implements cover fit and independent adjustments. | Keep those render paths; add resource resolution and a blend mode. The existing standalone `setBackgroundFromUrl` path is not a substitute for the layered background behavior. |
| Loading and lifetime | The loader uses anonymous cross-origin image requests and a module-level URL-to-texture Map with no eviction. Background replacement already has a generation token, but disposes the active runtime before loading and catches failures internally. | Private assets need credentialed fetching. Introduce bounded ownership and stage replacements before committing; expose failures to callers. |
| Existing libraries | [`TextureBrowser.vue`](../apps/rivvon/src/components/viewer/TextureBrowser.vue) provides collection/card/preview patterns. [`AudioLibraryView.vue`](../apps/rivvon/src/views/AudioLibraryView.vue), [`audioService.js`](../apps/rivvon/src/services/audioService.js), and [`audioUpload.ts`](../apps/api/routes/audioUpload.ts) demonstrate owner-scoped listing and upload/finalize/manage flows. | Reuse product patterns and small shared helpers. Avoid copying the texture browser's tile/family/variant machinery into an image browser. |
| Navigation | [`router/index.js`](../apps/rivvon/src/router/index.js) maps audio/video library routes to the same [`RibbonView.vue`](../apps/rivvon/src/views/RibbonView.vue) component. That view supplies their panels and header contexts. | Add `/images` in the same manner, keeping the canvas mounted. A general router refactor is outside this feature. |
| Persistence | [`viewerStore.js`](../apps/rivvon/src/stores/viewerStore.js) includes the selected background in preferences, resets, Tools snapshots, and change detection. [`scenePreset.js`](../packages/shared-types/src/scenePreset.js) strictly allowlists the three built-in names. | Update every persistence boundary and add migration coverage, not just the selection control. |
| Preset media | [`presets.ts`](../apps/api/routes/presets.ts), [`presetDependencies.ts`](../apps/api/utils/presetDependencies.ts), and [`012_scene_presets.sql`](../apps/api/db/migrations/012_scene_presets.sql) currently support texture/audio dependencies and preset-scoped media access. | Extend access grants, resaving, dependency tracking, and consent-based deletion to images in the initial release. |
| Storage | [`wrangler.toml`](../apps/api/wrangler.toml) declares a media bucket and a separate private preset bucket. Audio upload code constructs public CDN URLs. Texture storage choices also have different access rules from audio. | Reuse upload lifecycle concepts, but explicitly define image storage and permissions rather than inherit them accidentally. |

The existing `photos.ts` integration imports Google Photos **videos** into texture creation. It does not provide an image resource library; extending it is optional later work.

## Proposed user experience

1. **Browse → Images** opens the Image Library. The same library opens from the background settings' **Choose image** or **Change image** action.
2. The library has **Built-in** and **My Images** collections. Built-ins remain available without signing in. My Images provides a sign-in state and an **Upload images** action for authenticated users.
3. Cards show a thumbnail, name, dimensions, and selection state. Opening a card provides a larger preview and **Apply as background**. Uploaded items also offer Rename and Delete. Built-ins cannot be renamed or deleted.
4. Upload accepts one or more supported files with bounded concurrency, per-file progress, cancel/retry, and clear errors. It names the storage destination before transfer. Successfully uploaded images appear in My Images; upload alone does not change the scene. An explicit **Upload and apply** shortcut may be provided for a single image.
5. Apply closes the browser immediately, shows progress in the shared scene overlay, resolves and prepares the image, then commits the selection and enables Static Texture. Preserve unrelated scene and background adjustments. A failed load leaves the previous image and settings intact and shows the existing error toast.
6. The Static Texture setting shows the current thumbnail and name, plus **Change image**. Keep its enable switch and existing adjustments. Add a compact Blend selector for Normal/Soft Light. Disabling the layer retains the selection for later re-enabling.
7. Opening the library from Tools retains the settings context and restores it on cancellation. After Apply, return to the scene; the new selection is visible the next time Tools opens. Preserve the original Tools change-tracking snapshot while temporarily browsing.
8. The shared settings inside Export Video can open the same picker before encoding and return to the existing export configuration and preview after selection/cancel. Freeze the selected resource for an export and disable replacement while encoding. Do not lose export form state when opening the library.

Use `/images` for the library and transient shell state for the caller's return context. Opening from a texture route or a preset URL must retain the underlying scene context. Close/Done and browser Back must have explicit behavior, including direct loads of `/images`, without remounting the canvas or adding duplicate history entries on Apply.

Follow [`DESIGN.md`](../DESIGN.md): `viewer-chrome-panel-container`, a constrained PrimeVue `ScrollPanel.rivvon-scroll-panel`, `PanelActionBar` and `ChromeButton` for collection/navigation chrome, and PrimeVue task buttons/dialogs. Use the shared header title and X with a lower Done/Close action. Desktop preview can sit beside the grid; narrow screens can replace it with the established preview surface. Include loading, empty, error, keyboard, focus-return, accessible-label, and disabled states. Register any new Material Symbols names in `main.js`.

## Resource and persistence model

Create `image_assets` in D1 with, at minimum:

- `id`, `owner_id`, `name`, `source_filename`, `source_mime_type`;
- stored `mime_type`, `width`, `height`, `file_size`, and expected upload sizes;
- image and thumbnail object keys, thumbnail dimensions/type, and `storage_provider`;
- `status` (`uploading`, `complete`, `deleting`), upload expiry, `created_at`, `updated_at`.

Index owner/status/creation time for paginated listing. Source dimensions can be retained as metadata when upload normalization resizes a file. Bytes are immutable after finalization: replacing an image creates a new asset ID so existing presets and caches remain deterministic. Rename changes metadata only. Built-ins use the static manifest and require no per-user D1 rows or migration of repository files.

Use a discriminated reference as canonical artwork state:

```js
backgroundTextureSource: { kind: 'builtin', id: 'card' }
// or
backgroundTextureSource: { kind: 'image', id: '<asset-id>' }
backgroundTextureBlendMode: 'softLight' // or 'normal'
```

Retain `backgroundTextureEnabled` and the existing adjustment fields. A dedicated shared normalizer must validate the source object; the current generic artwork normalizer cannot accept this object without an explicit branch. The UI resolves names/thumbnails from the manifest or image service. Serialize stable IDs and settings only; keep Blob URLs, credentials, GPU textures, and temporary access context outside persisted artwork.

Migration rules:

- Existing preferences and version-1 presets map `backgroundTexture: 'card' | 'textile' | 'cenote'` to the matching built-in reference and Soft Light.
- Preserve the default, reset behavior, adjustment values, Tools snapshot comparison, and snapshot restore behavior.
- A missing legacy choice can retain today's Card default. An unavailable uploaded-image ID must produce a recoverable missing-resource state, not silently become Card.
- Introduce preset schema version 2 and accept/upconvert version 1 on both client and server. Update the hardcoded capture version in `useScenePreset.js` to the shared version constant. Version 2 prevents an older reader silently discarding the new image reference and rendering a different scene.
- Deploy a backend that accepts versions 1 and 2 before the new frontend. Keep version-1 fixtures as compatibility tests.

## Storage, upload, and access

Recommended initial policy: authenticated users can upload to Rivvon-managed R2 storage; their library and original asset endpoints are owner-scoped. A visible preset grants read access to its registered image dependency, following the current preset model. The upload UI should state that saving an unlisted/public preset makes its background readable through that preset.

Use a dedicated **private** `IMAGES_BUCKET` binding, with no public domain or r2.dev access, so owner-only delivery is enforceable. This adds one bucket/binding and reuses the existing session and D1 infrastructure. Do not reuse the current public CDN URL construction for private images. Do not change texture storage permissions or add Google Drive support as part of this release.

For the initial bounded image sizes, authenticated Worker upload endpoints can stream bytes into the private bucket; this avoids adding a second S3 signing configuration. Direct presigned uploads remain an optimization if measurements justify them. Both approaches must use the same pending → validated → complete lifecycle and server-generated object keys.

Suggested API, matching the repository's singular-write/plural-read convention:

| Endpoint | Purpose |
| --- | --- |
| `GET /images?limit=&offset=` | List the current user's completed image records. |
| `GET /images/:id` | Retrieve accessible metadata. |
| `GET /images/:id/assets/image` and `/thumbnail` | Serve owner-authorized bytes with correct MIME and access-aware caching. |
| `POST /image` | Validate metadata, create a pending record, and return upload targets. |
| `PUT /image/:id/assets/image` and `/thumbnail` | Accept bounded, authenticated uploads while status is uploading. |
| `POST /image/:id/complete` | Validate required objects and atomically finalize the record's status. |
| `PATCH /image/:id` | Rename an owned image. |
| `GET /image/:id/preset-dependencies` | Review presets affected by deletion. |
| `DELETE /image/:id` | Delete with the existing explicit preset-cascade consent semantics. |
| `GET /presets/:id/assets/background-image` | Serve only the image registered to that accessible preset. |

Proposed starting limits, to validate with representative files and mobile devices: JPEG, PNG, and static WebP input; 20 MiB source/upload cap; 40 megapixel decoded-source cap; normalized render image with a maximum 4096-pixel long edge; thumbnail with a maximum 512-pixel long edge. These are product limits, not measured platform limits. Reject unsupported, corrupt, or animated input with a clear message; defer GIF/APNG/animated WebP, SVG, HEIC, RAW, and HDR import until their decoding policy is defined.

Normalize orientation and output in the browser, generate a thumbnail, and discard embedded source metadata through raster re-encoding. Keep an opaque JPEG or alpha-preserving PNG/WebP render asset and a thumbnail; do not retain the full original in the first version. Explain resizing to the user. Retaining originals and higher-resolution export derivatives can be a later resource feature.

Validation must enforce actual byte limits, allowed file signatures/types, dimensions, and required objects server-side before completion. Do not trust filename, browser MIME, or declared size alone. Bound source decoding and thumbnail work before processing large files. Completion/upload/delete must use status guards so an in-flight upload cannot resurrect a deleting asset. Provide cancellation, retryable finalization, cleanup of abandoned pending uploads, and retryable object deletion.

## Renderer integration and resource lifetime

Introduce an image service/resolver that returns authorized Blob data and normalized metadata for either a built-in, an owned image, or a preset dependency. Resolve private images with `fetch(..., { credentials: 'include' })`, then decode into a Three.js texture; the current anonymous `TextureLoader` request cannot carry the owner's session. Use the same access approach for private thumbnails. Preserve sRGB, orientation, cover fit, vertical alignment, and the existing adjustment pipeline.

Keep source access context separate from the reference: an image opened through a shared preset may be readable only through that preset. Both the renderer and later preset saves need that provenance, even if the original image is absent from My Images. Resolve the context against the server; an asset ID alone is not permission.

Extend both WebGL GLSL and WebGPU node composition with the blend setting. Use image alpha as coverage for Normal and Soft Light, with opaque built-ins remaining pixel-equivalent to their existing behavior. The current shaders sample RGB, so transparent PNGs need this explicit handling. Preserve water/overlay ordering and test the result with the base background enabled and disabled, sharp/blurred/gradient modes, and curved surfaces.

Stage a replacement image and runtime before disposing the active runtime. Keep the existing generation-token protection and add cancellation/deduplicated in-flight loads. Return a failure result or throw to the selection/preset caller instead of only logging. Ensure failure reaches the preset restore transaction so the previous scene can be restored.

Replace the unbounded image-texture Map with bounded caching and explicit ownership. Cache keys include resource identity and access context; GPU ownership must account for the main scene, texture overview, and export. Reference-count/pin active entries; dispose textures and revoke object URLs only when no consumer uses them. Clear user-scoped resources on account changes, and respect the renderer's maximum texture size. A 4096 × 4096 RGBA image is about 64 MiB before mipmaps, or 85 MiB with a full mip chain, so compressed file size alone is not a useful GPU budget.

Update source watchers in `ThreeCanvas.vue` and `TextureOverviewPreview.vue`, export-preview invalidation in `ExportVideoDialog.vue`, scene capture/restore, and renderer reinitialization. A library rename must not trigger a new GPU download. Still-image export, video export, and preset thumbnails must wait for a ready image and use the same source and framing as the scene.

## Preset sharing and deletion

Add `image_asset_id` to `preset_media_dependencies`, including its foreign key, indexes, availability trigger, and deletion-lock triggers. The current table's CHECK permits exactly one of **two** dependency columns; adding a third requires rewriting that constraint, generally by rebuilding the table in the next migration while preserving all existing rows, indexes, and triggers. Update both the canonical schema and the migration path, and test against a database that already has texture/audio dependencies.

Extend `MediaKind` and the column/table mappings in `presetDependencies.ts`. During preset creation, validate that the selected image is complete and owned by the caller or granted through an accessible source/parent preset. Register the dependency in the same atomic D1 batch as the preset. Built-ins require no media dependency.

For version 2, record a dependency for every uploaded image reference retained in the scene, even if Static Texture is currently disabled: re-enabling that saved selection should work. Access the referenced bytes through the preset asset endpoint, and preserve this grant when saving a derivative preset. Do not publish the underlying private library entry or copy the image per preset.

Image deletion should follow the existing texture/audio experience: list linked presets, hide other owners' private names, and require confirmation of the reviewed preset IDs. Server-side rechecks and triggers handle newly linked presets. The final action explicitly says **Delete Image and Presets** when appropriate. Deleting a preset alone leaves its source image in the library. Removing an image selected in the current scene clears that selection and disables its static layer without resetting other background settings; cancellation preserves both the scene and resources.

## Implementation sequence

| Step | Deliverable | Completion condition |
| --- | --- | --- |
| 1. Contract and migration | Shared source/blend validation, version-1 import, version-2 serialization, viewer preferences/snapshots, D1 image/dependency migration. | Existing backgrounds and presets retain their settings; existing dependency data survives migration. |
| 2. Image resource service | Private bucket binding, image API, upload/normalization/thumbnail client, access resolver, pending/deletion cleanup. | An authenticated user can upload, list, preview, rename, and delete an owned image; incomplete and unauthorized assets stay inaccessible. |
| 3. Background application | Transactional loading, bounded caching, source watchers, alpha/blend behavior in both renderers, export readiness. | Built-in and uploaded sources apply reliably; failures keep the previous scene and resources are released correctly. |
| 4. Gallery and settings | `/images`, Browse launcher, Built-in/My Images, upload and preview, current-image summary, caller return behavior. | Desktop/mobile and keyboard flows work from Browse, Tools, and Export Video while preserving the scene/form state. |
| 5. Presets and release | Image access grants, save/load/resave, dependency-aware deletion UI, integration checks, deployment notes. | A recipient can open a shared preset with its image; old presets and deletion race protection still work. |

Steps are implementation slices, not independently releasable user features. Ship after the preset/export checks pass. Apply D1 migrations and provision private storage, deploy the compatible API, then deploy the viewer. No production provisioning or deployment is part of this planning task.

## Verification and acceptance

- **Compatibility:** test all three built-ins, old preferences, version-1 fixtures, resets, Tools snapshot comparisons, and version-2 round trips. Invalid references must fail clearly.
- **Upload and access:** exercise owner/other-user/signed-out access, actual-size/type/dimension validation, malformed/animated inputs, missing thumbnails, partial uploads, cancellation, finalization retries, and deletion during upload.
- **Rendering:** extend `backgroundTextures.test.js` and `useSceneBackground.test.js` for uploaded landscape/portrait/transparent images, both blend modes and renderers, projection/crop/alignment, adjustments, and preview/export consistency. Use browser checks for actual decoding/GPU output.
- **Lifetime:** test rapid A → B selections with reversed completion order, failed replacement, simultaneous main/overview consumers, eviction, renderer reinitialization, and account changes.
- **Presets:** extend shared preset, store, service, restore, and API tests for image capture/load, rollback on image failure, private/unlisted/public access, derivative saves, disabled-but-retained selections, linked-preset consent, and concurrent new dependencies.
- **UI:** verify library pagination, all collection states, upload retry, card actions, focus/keyboard access, narrow-screen preview, header X/Done/Back behavior, and all three entry contexts. Confirm no duplicated canvas or lost export settings.
- **Export:** compare the selected background in the scene, preset thumbnail, still export, and video frames at different aspect ratios. Export cannot start while its image is loading or change source during encoding.
- Run the affected frontend/API Vitest suites and both builds after implementation. Implementation verification is recorded in image-library.md.

## Scope choices

Recommended first release includes built-ins, an authenticated personal library, ordinary raster upload, preview/rename/delete, application to backgrounds, two blend modes, persistence, preset sharing, and exports. Standalone public image discovery, tags/search, folders, Drive/Google Photos import, local-only durable image libraries, original-file preservation, crop editing, and video-frame extraction can follow separately. This keeps the first release focused while making images reusable resources.

The proposed limits, private managed storage, Normal default for uploads, and non-retention of originals are explicit recommendations to settle during implementation planning. The repository inspection establishes architectural feasibility; it does not measure upload throughput, mobile memory limits, or the finished feature's performance.
