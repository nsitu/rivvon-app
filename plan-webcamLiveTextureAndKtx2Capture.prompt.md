## Plan: Webcam Live Texture and KTX2 Capture Split

Replace the current mixed realtime webcam path with three explicit workflows that serve different goals.

- `Live Camera Texture`: WebGPU-only, viewer-first, transient during capture. Camera frames feed a GPU-resident layered texture source that the ribbon renderer samples directly. This path optimizes immediacy and visual feedback while capture is active, but it may also offer an explicit post-stop `Encode Live Result` action that freezes the current live texture set and encodes that snapshot to KTX2 after capture ends.
- `Camera Capture`: camera-first, serial. The user previews and records a webcam clip, then that recorded video is handed to the existing file-based video-to-KTX2 workflow. This path optimizes KTX2 output, local save, upload, and publishing.
- `File Preview Build`: file-based, WebGPU-only, preview-first. Decoded video frames populate atlas-backed GPU tiles and stop at a viewer-ready frozen texture set instead of KTX2. This path optimizes fast visual iteration in the viewer and may later offer an explicit `Encode Preview` action that exports that frozen preview to KTX2 after the build completes.

The current `realtime` webcam mode should be treated as a migration bridge, not the end state. Once both new workflows are stable, the old mixed path can be retired.

The important distinction is that `Encode Live Result` is a snapshot/export of the already-built live texture state. It is not the same thing as `Camera Capture`, which preserves a recorded video clip and reuses the full configurable file-processing pipeline.

The same distinction applies to file mode. `Build Preview` would reuse the existing file sampling pipeline and stop at a viewer-ready frozen texture result without KTX2, while `Process` would remain the full asset-generation path. That makes `Build Preview` adjacent to `Process`, not a replacement for it.

The layer-cycling outcome can stay the same across atlas-built preview/live tiles and array-backed encoded tiles. The preferred direction is to keep the atlas as the efficient transient write format, then repack atlas cells into a runtime array texture on the same GPU device or GL context so the viewer can keep using its existing array-texture path. Direct atlas-backed viewer materials remain a fallback if that repack seam proves impractical.

Implementation note: the shared atlas/array ownership rearchitecture is now split into `plan-deviceScopedTextureCoordinator.prompt.md`. Treat that document as a prerequisite track for the WebGPU live/preview rendering work in this plan. The webcam workflow split should not be the place where the device-scoped texture coordinator is first discovered or debugged.

**Core Decisions**

1. Adopt the recorded-video handoff as the default webcam-to-KTX2 strategy. The camera path should produce a recorded `File`/`Blob`, then reuse the same metadata extraction, tile planning, processing, and publishing flow that currently assumes uploaded video.
2. Do not keep live KTX2 encoding active during capture. If the user wants immediacy, send them to the WebGPU live path. If the user wants a configurable or reproducible texture-set workflow, send them to the recorded capture path.
3. Keep `Live Camera Texture` WebGPU-only. On browsers without WebGPU, expose `Camera Capture` only. Do not silently fall back to the old mixed webcam mode.
4. Treat the existing `realtime` label as obsolete. Use clearer product names in UI and code: `Live Camera Texture` and `Camera Capture`.
5. Keep array-texture semantics as the target for live mode. The viewer and background paths already think in layered texture terms, so the live path should fit that contract instead of introducing a long-lived atlas-only rendering model.
6. Allow `Live Camera Texture` to grow an explicit post-stop export seam if the live WebGPU writer can freeze its retained tile textures and expose `readImages()`-style RGBA readback per tile. This export must happen only after capture stops.
7. Keep `Camera Capture` as the primary persistence path even if `Encode Live Result` exists. `Camera Capture` preserves a raw clip and reuses the mature file-processing flow; live export only preserves the frozen texture result that exists at stop time.
8. The same frozen-texture seam also makes a WebGPU file-mode `Build Preview` path viable. It should appear as an action adjacent to `Process` in the file workflow, not as a hidden side effect of `Process`.
9. `Build Preview` should reuse the same tile plan and frame-sampling path as file-mode `Process`, but stop at a viewer-ready frozen texture result instead of crossing the KTX2 boundary.
10. `Encode Preview` should reuse the same frozen-snapshot export backend planned for `Encode Live Result`, so preview/export logic does not fork into a second asset pipeline.
11. Atlas-backed tiles remain the right transient GPU write surface because the current builders already use one instanced draw per source frame to populate all layer cells. The first preview/live strategy to explore should be atlas-to-array repack, not direct atlas sampling in the viewer.
12. Prefer repacking atlas cells into runtime array textures when the builder and viewer can share the same GPU device or GL context. That preserves the efficient atlas write path while letting the viewer keep its current array-texture shaders, background logic, and mip behavior.
13. On WebGPU, atlas-to-array repack is API-feasible through `copyTextureToTexture()` from atlas subrects into array layers. On WebGL2, atlas-to-array repack is API-feasible through framebuffer-backed `copyTexSubImage3D()` into `TEXTURE_2D_ARRAY` layers. In both cases, the copy path only helps the viewer if the repacked array texture lives on the same device/context the viewer is already rendering from.
14. The current builder architecture does not yet satisfy that prerequisite. `webgpuTileBuilder.js` creates its own shared `GPUDevice`, and `webglTileBuilder.js` creates its own offscreen WebGL2 context. The plan must therefore include a same-device/context integration spike before assuming atlas-to-array repack can replace atlas viewer shaders.
15. Same-context sharing is not just about passing `renderer.getContext()` into the builder. `tileManager.js` currently registers Three texture objects, so the repacked destination must also be a viewer-owned Three texture contract such as a `WebGLArrayRenderTarget.texture` or another renderer-owned array texture seam. A raw `WebGLTexture` handle is not enough for the current viewer path.
16. Direct atlas sampling remains the fallback when same-device/context repack proves too awkward with the current Three.js integration. Atlas sampling still carries visual risks that arrays largely avoid, especially cell-edge bleeding and mip behavior.

**Shared-Context Feasibility Update**

- WebGL same-context repack looks plausible without a full compositor rewrite, but only if the builder stops owning its own offscreen context and instead runs as a viewer-owned auxiliary pass. The likely seam is the active renderer already stored through `useThreeSetup.js` and `viewerStore.threeContext`.
- In that WebGL path, prefer Three-managed destinations first: `renderer.setRenderTarget(...)`, `WebGLArrayRenderTarget`, and `renderer.copyTextureToTexture(...)` where they fit. If raw GL commands are still required, they need explicit coordination with Three state via `renderer.resetState()` around custom work.
- WebGPU same-device repack is no longer blocked at device ownership. Three's WebGPU backend accepts an injected `GPUDevice`, exposes the active backend on the renderer, and can therefore participate in a shared-device architecture without forking the renderer.
- The remaining WebGPU risk is shared texture ownership, not shared device access. A shared device still needs a device-scoped texture coordinator that owns atlas allocations, viewer-visible array allocations, and the submission ordering between builder copies and viewer renders.
- In that WebGPU path, keep viewer-visible array textures stable and long-lived. Repack atlas regions into the same array allocation in place instead of rotating the underlying `GPUTexture` object during normal streaming, because Three caches backend data per texture object.
- WebGPU external texture wrapping is viable for viewer consumption, including array-style sampling when the wrapper still presents array-texture semantics. However, Three destroys wrapped GPU textures on normal texture disposal, so any external-array path requires borrowed-resource semantics in `tileManager.js` rather than direct `texture.dispose()` ownership.

**Steps**

Prerequisite: complete and validate `plan-deviceScopedTextureCoordinator.prompt.md` before starting the WebGPU live/preview rendering steps in this document. The steps below should consume that validated seam rather than invent it during webcam implementation.

1. Split the current webcam product surface before splitting internals.
   Update the `Create Texture` chooser in `apps/rivvon/src/components/viewer/TextureCreator.vue` so webcam is no longer a single mode. The target source choices are:
   - `Upload Video`
   - `Live Camera Texture`
   - `Camera Capture`
     Remove the current ambiguity where one webcam entry tries to be both a live preview renderer and a KTX2 generation flow.

2. Extract shared camera ownership out of `useRealtimeSlyce`.
   Move `startCamera()`, `stopCamera()`, `toggleCamera()`, stream/facing/rate refs, and camera-lifecycle cleanup from `apps/rivvon/src/composables/slyce/useRealtimeSlyce.js` into a focused shared composable such as `apps/rivvon/src/composables/slyce/useCameraSession.js`. Both replacement workflows should depend on this shared camera session instead of each owning their own `getUserMedia()` stack.

3. Preserve the current viewer-level camera conflict rules at the shared seam.
   `apps/rivvon/src/views/RibbonView.vue` already coordinates head-tracking vs webcam ownership. Keep that behavior, but attach it to the new shared camera session rather than to the legacy `realtime` feature. The camera indicator and close behavior should become workflow-agnostic.

4. After the device-scoped texture coordinator prerequisite is validated, build a small WebGPU live-texture spike before broader UI refactors.
   Prove one narrow path first:
   - WebGPU renderer active
   - one live tile source built through atlas staging
   - one layered texture sampled by the existing ribbon material path
   - background sampling from that same source
     This spike should answer the key integration questions early:
   - can the live writer run on the same `GPUDevice` as the active Three.js WebGPU renderer?
   - can atlas cells be repacked into a viewer-visible runtime array texture without a CPU roundtrip?
   - for WebGL parity, can the builder eventually target a Three-owned array-texture destination instead of a raw backend texture handle?
   - if not, does live mode need a dedicated atlas-backed tile/material seam as fallback?
     It should also answer the export question: can the live writer freeze the retained textures and expose an after-stop `readImages()` seam without paying readback costs during active capture?

5. Add an explicit live-texture rendering seam in the viewer.
   Start by extending `apps/rivvon/src/modules/viewer/tileManager.js` with a public live-source registration seam such as `registerLiveArrayTexture()` or `attachLiveTileProvider()`. If that cannot be made cleanly with the existing Three.js abstractions, create a separate `LiveTileManagerWebGPU` instead. Do not force the KTX2 path to absorb that complexity.
   The preferred seam is runtime-array-first: atlas staging should stay builder-internal when the builder can repack into a viewer-visible array texture on the same device/context. The important contract is that the viewer receives a stable Three texture wrapper, not a raw backend handle.
   On WebGPU, reuse the shared texture coordinator from `plan-deviceScopedTextureCoordinator.prompt.md` rather than designing a second ownership model here.
   If the viewer consumes an externally wrapped array texture, `TileManager` must treat it as a borrowed allocation and release it back through that coordinator instead of calling `texture.dispose()` directly.
   Only fall back to a storage-aware atlas-versus-array viewer seam if the repack path proves impractical.

6. Prefer atlas-to-array repack over atlas-specific viewer shaders.
   The current builders already batch sampling into atlas cells efficiently. Before adding new atlas-backed ribbon, flow, or background materials, add a builder-side repack path that copies atlas cells into a runtime array texture on the same device/context the viewer uses.

- For frozen preview tiles, repack whole cells after tile completion.
- For live tiles, repack only the updated strip or subregion needed to keep the visible array texture current.
- Keep the repack path GPU-only; do not route through CPU RGBA buffers just to satisfy viewer consumption.
- On WebGPU, route atlas writes and atlas-to-array copies through the validated coordinator flush or pre-render hook so queue submission order is deterministic before the viewer samples the array texture for that frame.
- Prefer one stable viewer-visible array allocation per live/preview stream and update its contents in place. During normal streaming, the builder may rotate atlas staging resources, but the viewer should keep sampling the same array `GPUTexture` and the same Three wrapper object frame after frame. Reallocation or `GPUTexture` swapping should be reserved for explicit configuration changes such as width, height, layer count, or format changes.
- In WebGL, prefer viewer-owned `WebGLArrayRenderTarget` or other Three-managed array-texture destinations before falling back to raw `copyTexSubImage3D()` plumbing. If raw GL interop is required, bracket it with `renderer.resetState()` so Three's state cache does not drift.
  This path preserves the existing viewer materials and keeps preview/live quality closer to the encoded array path.

7. Treat atlas-backed viewer materials as the fallback path, not the default plan.
   In GLSL and WGSL, 2D atlas textures and 2D-array textures use different sampler types. If same-device/context repack cannot be made clean with the current Three.js integration, then add paired atlas-backed material variants for:

- single-tile ribbon sampling
- dual-tile flow sampling
- background sampling
  Those variants should keep the same shared uniforms for layer cycling, flow offset, rotation, mirroring, cap masks, and transparency controls, but compute atlas UVs from `uLayer` plus atlas layout uniforms instead of sampling `sampler2DArray` depth layers directly.

8. Implement the WebGPU live path as its own workflow.
   Add a new composable such as `apps/rivvon/src/composables/slyce/useLiveCameraTexture.js` and a new GPU module such as `apps/rivvon/src/modules/slyce/webgpuLiveTextureStream.js`. Reuse `CameraFrameSource` from `apps/rivvon/src/modules/slyce/samplingSources.js`, but replace canvas staging + readback with GPU-native work:
   - ingest camera frames via `copyExternalImageToTexture()` or the closest direct WebGPU source-copy path
   - sample cross-sections in WGSL using the same `planes` / `waves` semantics where appropriate

- write into atlas-backed ring resources that preserve one-pass batched sampling
- request atlas and array allocations from the shared texture coordinator, then repack atlas regions into viewer-visible array-texture resources on the active renderer device when that interop path is available
- keep separate read/write resources or ping-pong resources so the renderer never samples from the same subresource currently being written
- keep the viewer-visible array resource stable while atlas resources rotate underneath it; in steady-state streaming, the coordinator should copy new atlas content into the existing viewer-bound array allocation instead of replacing that allocation with a fresh `GPUTexture`. Only swap the sampled array texture when the coordinator is intentionally reallocating because the texture shape or format changed
- retain atlas layout metadata so subregion-to-layer copies stay deterministic and atlas fallback materials remain possible
- retain enough tile history to define what `Encode Live Result` means, or explicitly scope export to only the frozen retained live tile set
- on stop, freeze the retained live tile textures and expose async `readImages()`-style callbacks per tile so the existing KTX2 encoder backend can run after capture ends
- refresh flow/material bindings only when a tile boundary advances or a live resource rotates
  This workflow should not create KTX2 buffers, worker pools, or local-save state while capture is active.

9. Keep the live path visually aligned with the existing viewer, not with the old sampler UI.
   Add a dedicated panel such as `apps/rivvon/src/components/slyce/LiveCameraTexturePanel.vue`. Its job is to control camera start/stop, cross-section settings, and any live-mode-specific controls, while the viewer itself remains the primary preview surface. Avoid rebuilding the old `RealtimeSampler.vue` grid UX for live mode.

10. Add a stopped-state action model for live mode.
    When the user stops `Live Camera Texture`, the workflow should move into a frozen state with explicit actions such as:

- `Resume Live`
- `Apply Live Result`
- `Encode Live Result`
  `Encode Live Result` should only become available once capture is stopped and the live writer confirms that its retained tile set is still readable. The camera should not need to keep running during encode.

11. Make `Camera Capture` a recorded-video handoff, not a live encoder.
    Add a separate composable such as `apps/rivvon/src/composables/slyce/useCameraTextureCapture.js` plus a focused recorder module such as `apps/rivvon/src/modules/slyce/cameraRecorder.js`. Use the shared camera stream and record it to a `Blob` / `File` with `MediaRecorder`, then hand that recorded file to the existing upload/file flow instead of trying to encode while frames are still arriving.

12. Reuse the existing file-based KTX2 workflow for camera capture.
    After recording stops, create a synthetic `File` and route it through the same path that uploaded video uses today:

- metadata extraction via the existing video metadata flow
- configuration in `apps/rivvon/src/components/slyce/SettingsArea.vue`
- tile planning via `useTilePlan`
- processing through `apps/rivvon/src/modules/slyce/videoProcessor.js`
- results, local save, and publish through the existing `OutputActions` / local/cloud persistence flow
  This is the preferred KTX2 branch because it reuses the mature code path and removes capture-time encode pressure entirely.

13. Reuse the existing KTX2 backend for post-stop live export.
    `apps/rivvon/src/modules/slyce/ktx2-assembler.js` already accepts arrays of `{ rgba, width, height }` layer images, and the file-mode processor already supports GPU-builder payloads that expose `readImages()` callbacks before calling that encoder. Mirror that seam for the frozen live writer rather than inventing a second KTX2 assembly path. The live export branch should:

- freeze live tile resources
- read back RGBA layers tile-by-tile after stop
- run `KTX2Assembler.encodeParallelWithPool(...)` in the background
- then hand the resulting blobs/buffers into the same local-save or publish sinks used elsewhere

14. Keep the camera-capture UX honest about what is live.
    The camera-capture panel should show framing preview, recording state, duration, and retake controls while the camera is active. Once recording stops, the user should transition into the existing config/process flow. Do not keep the current promise that tile generation is happening live during capture.

15. Reuse existing file-flow UI instead of cloning it.
    `TextureCreator.vue` already owns the upload/config/process/done workflow for file input. After a camera recording completes, the user should land in that same workflow with the recorded file preselected. The only new UI work should be the recording step, not a second parallel processing wizard.

16. Use browser capability gating instead of fallback ambiguity.
    If WebGPU is unavailable, `Live Camera Texture` should be disabled or hidden, while `Camera Capture` remains available. If `MediaRecorder` or a usable recording MIME type is unavailable, show a specific unsupported-state message rather than falling back to the legacy mixed webcam path silently.

17. Replace the current single realtime panel with two focused panels.
    Retire `apps/rivvon/src/components/slyce/RealtimeSampler.vue` in stages:

- first, stop routing new entry points to it
- then split its responsibilities into `LiveCameraTexturePanel.vue` and `CameraCapturePanel.vue`
- finally, remove the legacy component once no workflow depends on it
  This keeps each new surface smaller and more precise than the current all-in-one panel.

18. Decouple webcam KTX2 state from viewer-apply state.
    The current `useRealtimeSlyce` singleton exists partly because `RealtimeSampler.vue` captures and `RibbonView.vue` applies accumulated KTX2 buffers. The new split should remove that coupling:

- live mode owns viewer-facing GPU resources only
- camera capture owns recorded clip state only until it hands off to the normal file workflow
- file-mode KTX2 output stays in the existing file-processing state model
- post-stop live export uses a new frozen-snapshot export state instead of reviving the old active-capture singleton
  This is a simplification, not just a rename.

19. Keep local save and publish out of active live capture, but allow them after an explicit export choice.
    `Live Camera Texture` should not save or publish directly while capture is running. If the user chooses `Encode Live Result` after stop, that export path may then reuse the existing local-save or publish sinks. This keeps persistence out of the live hot path while still allowing the frozen result to become a real texture set.

20. Update routing and deep-link behavior after the split.
    `apps/rivvon/src/router/index.js` and `apps/rivvon/src/views/RibbonView.vue` currently support `/realtime` via a query redirect. Retire that path as part of the migration. If durable camera routes are still desired later, introduce route-backed `Create Texture` subflows instead of carrying forward the old one-shot `realtime=true` model.

21. Keep the old mixed path only as a temporary compatibility shim.
    During migration, leave `apps/rivvon/src/composables/slyce/useRealtimeSlyce.js` in place behind a feature flag or unused code path if necessary, but stop adding behavior to it. It should become an implementation staging area that is deleted once both new workflows pass validation.

22. Remove old performance scaffolding that only mattered for live KTX2 encoding.
    Once the old mixed webcam path is gone, a lot of its complexity can disappear with it:

- capture-time KTX2 throttle state
- encode queue waiters tied to live sampling
- live readback perf accounting in the webcam branch
- mixed capture/apply singleton state
  Those concerns still matter for file-mode processing, but they no longer need to live inside the webcam entry path.

23. Treat `Camera Capture` as the cross-device fallback, especially for older iPad hardware.
    This split is useful even if `Live Camera Texture` ends up desktop-first. Older or memory-constrained devices can still support webcam-to-KTX2 by recording a clip first and then reusing the existing offline processing path. That is a more precise and reliable niche than the current mixed realtime approach.

24. Retire the old webcam modality once both replacement branches are proven.
    The end state is:

- no user-facing `realtime webcam` wording
- no toolbar or route entry that opens the legacy mixed sampler
- webcam-to-KTX2 by default means `Camera Capture`
- `Live Camera Texture` may optionally export the frozen live result to KTX2 after stop
- webcam-to-live-ribbon means `Live Camera Texture`

**File-Mode Preview Extension**

1. Add a WebGPU-only `Build Preview` action adjacent to `Process` in the file-based texture workflow UI, most likely in `apps/rivvon/src/components/slyce/SettingsArea.vue` or the surrounding `TextureCreator` footer that already owns processing actions.
2. Reuse the existing file-mode tile plan, `VideoFileFrameSource`, and GPU builder path. The key contract change is that `apps/rivvon/src/modules/slyce/webgpuTileBuilder.js` should be able to finish a tile and expose a frozen preview-tile representation for the viewer, not only a `readImages()` callback for KTX2 assembly.
3. Prefer repacking those preview tiles from atlas cells into runtime array textures on the same device/context the viewer uses. That keeps the fast atlas builder write path while letting preview reuse the existing array-texture viewer path. Direct atlas viewing should remain a fallback if that repack seam proves too awkward.
4. After a preview build completes, expose actions such as:
   - `Apply Preview`
   - `Encode Preview`
   - `Discard Preview`
     `Encode Preview` should only become available once the preview build is complete and the retained preview tiles are still readable.
5. Keep `Build Preview` scoped to WebGPU first. The current file-mode WebGL2 builder is atlas-oriented and still valuable for KTX2 generation, but the cleanest no-KTX2 preview path aligns with the planned WebGPU live/frozen texture architecture.
6. Keep `Process` as the full KTX2/publish path. `Build Preview` is for fast visual iteration, viewer-side testing, and quick apply cycles. It should not be presented as a portable asset workflow unless the user explicitly chooses `Encode Preview` afterward.
7. Reuse the same frozen-snapshot export backend for both `Encode Live Result` and `Encode Preview`. That keeps the codebase centered on one post-build/post-stop export seam instead of separate webcam-export and file-preview-export implementations.
8. Make the UI distinction explicit. `Build Preview` should communicate that it is faster because it skips KTX2 assembly and parse during the build, not because it bypasses every staging surface in the current GPU builder path.
9. Keep encoded viewing unchanged. Once a preview or live result is exported to KTX2, the viewer can return to the existing array-texture path used for persisted textures.

**Relevant files**

- `apps/rivvon/src/components/viewer/TextureCreator.vue` — current source chooser and the best place to split webcam into two explicit workflows.
- `apps/rivvon/src/components/slyce/RealtimeSampler.vue` — current mixed webcam surface to retire in stages.
- `apps/rivvon/src/composables/slyce/useRealtimeSlyce.js` — current mixed camera/session/sampling/encode/save/apply singleton to split apart.
- `apps/rivvon/src/views/RibbonView.vue` — current camera conflict handling, realtime panel ownership, and `/realtime` query bridge.
- `apps/rivvon/src/router/index.js` — legacy `/realtime` redirect to retire.
- `apps/rivvon/src/modules/slyce/samplingSources.js` — shared `CameraFrameSource` seam to reuse.
- `apps/rivvon/src/modules/slyce/samplingPipeline.js` — reusable orchestration logic reference; the live path may reuse pieces but should not inherit canvas/readback assumptions.
- `apps/rivvon/src/modules/slyce/videoProcessor.js` — existing file-mode encoder pipeline that `Camera Capture` should reuse after recording.
- `apps/rivvon/src/components/slyce/SettingsArea.vue` — likely home for a file-mode `Build Preview` action adjacent to `Process`.
- `apps/rivvon/src/components/slyce/ResultsArea.vue` — likely place to surface preview-build completion state if preview and process continue to share the same workflow shell.
- `apps/rivvon/src/modules/slyce/ktx2-assembler.js` — existing array-texture KTX2 backend that can be reused for post-stop live export if the live writer exposes RGBA readback.
- `apps/rivvon/src/modules/slyce/ktx2-worker-pool.js` — worker-pool backend reused only after capture stops for live export or for the normal file path.
- `apps/rivvon/src/modules/slyce/webgpuTileBuilder.js` — best reference for direct WebGPU frame upload and GPU-side sampling.
- `apps/rivvon/src/modules/slyce/webglTileBuilder.js` — best reference for current atlas batching on WebGL2 and for evaluating framebuffer plus `copyTexSubImage3D()` repack feasibility.
- `apps/rivvon/docs/webgl2-tile-builder.md` — existing atlas-vs-array builder tradeoff notes; useful background when separating preview/live atlas sampling from encoded array sampling.
- `apps/rivvon/src/modules/viewer/tileManager.js` — place to add a public live-texture registration seam, or the file that justifies creating a separate live tile manager.
- `apps/rivvon/src/composables/viewer/useSceneBackground.js` — live background sampling must keep working for the new live texture source.
- `apps/rivvon/src/composables/viewer/useThreeSetup.js` — viewer initialization and the likely seam for exposing the active WebGPU renderer/device to live mode.
- `apps/rivvon/src/modules/viewer/threeSetup-webgpu.js` — WebGPU renderer setup and potential device-lifecycle reference.
- `apps/rivvon/src/composables/slyce/useCameraSession.js` — new shared camera-ownership composable.
- `apps/rivvon/src/composables/slyce/useLiveCameraTexture.js` — new live WebGPU workflow composable.
- `apps/rivvon/src/composables/slyce/useCameraTextureCapture.js` — new serial camera-to-file capture composable.
- `apps/rivvon/src/modules/slyce/webgpuLiveTextureStream.js` — new WebGPU live writer module.
- `apps/rivvon/src/modules/slyce/liveTextureExport.js` — optional new frozen-snapshot export helper that reads retained live tiles and routes them through the existing KTX2 backend.
- `apps/rivvon/src/composables/slyce/useFileTexturePreview.js` — optional new file-mode preview composable if the preview build flow should stay distinct from full `videoProcessor` KTX2 processing.
- `apps/rivvon/src/modules/slyce/cameraRecorder.js` — new camera-recording helper that produces the recorded video file.
- `apps/rivvon/src/components/slyce/LiveCameraTexturePanel.vue` — new live-mode control surface.
- `apps/rivvon/src/components/slyce/CameraCapturePanel.vue` — new camera-recording control surface.

**Verification**

1. On a WebGPU browser, `Live Camera Texture` opens the camera, updates ribbon textures live, and keeps the viewer responsive without creating KTX2 buffers or local-save state.
2. The live WebGPU path can advance tile boundaries without sampling from the same resource it is currently writing.
3. The live path updates the scene background from the same live texture source or from a clearly defined derived preview source.
4. After stopping live mode, `Encode Live Result` can freeze the retained live tile set, read back RGBA layers tile-by-tile, and run KTX2 assembly without requiring the camera to stay active.
5. The live export branch does not perform readback or KTX2 assembly while capture is active.
6. On a browser without WebGPU, `Live Camera Texture` is unavailable but `Camera Capture` still works.
7. `Camera Capture` records a webcam clip, creates a file-like handoff, and lands in the same config/process UI used for uploaded video.
8. A recorded webcam clip processed through the existing file pipeline can be saved locally, published, and reloaded just like an uploaded file-derived texture set.
9. During camera capture, there is no live KTX2 encoding, no live readback, and no live apply-to-viewer branch.
10. Search results after migration show no remaining user-facing `/realtime` route, `RealtimeSampler` entry path, or ambiguous `realtime webcam` product wording.
11. In the WebGPU file workflow, `Build Preview` completes without generating KTX2 blobs during the build and loads a viewer-ready frozen texture result into the ribbon.
12. `Encode Preview` can export that frozen preview result to KTX2 after the build completes without re-decoding the original video, provided the retained preview tiles are still readable.
13. If same-device/context repack is chosen, preview/live array textures derived from atlas staging produce the same visible layer-cycling behavior as encoded array textures without a CPU roundtrip.
14. If atlas-backed viewer materials remain necessary as fallback, they produce acceptable cell-edge behavior under the chosen mip/clamp strategy.
15. In WebGL shared-context mode, the preview/live builder does not create a second offscreen `webgl2` context for the same tile flow and instead runs through the active viewer renderer/context.
16. The viewer can register a live or preview array texture directly without routing through KTX2 parse, and that registered object remains a Three texture contract rather than a raw backend texture handle.
17. If raw GL commands are used alongside Three in WebGL shared-context mode, renderer state is reset cleanly and subsequent viewer renders remain stable.

**Retirement Criteria**

1. `TextureCreator` exposes separate `Live Camera Texture` and `Camera Capture` choices.
2. `RibbonView` no longer opens the legacy mixed webcam path for new flows.
3. `Camera Capture` successfully reuses the existing file-processing pipeline with a recorded file handoff.
4. `Live Camera Texture` is validated on at least one supported WebGPU browser against the current ribbon/material/background stack.
5. If `Encode Live Result` is included, it works only after stop through a frozen-snapshot export seam and does not reintroduce active-capture encode pressure.
6. No workflow still depends on `completedKtx2Buffers` or legacy realtime apply state during active webcam capture.
7. `useRealtimeSlyce.js` and `RealtimeSampler.vue` can be removed without leaving webcam capability gaps.
8. If `Build Preview` is included for file mode, it reuses the same viewer seam and frozen-export seam instead of creating a second preview-only architecture.
9. Preview/live rendering preferably reuses the existing array-texture viewer path through builder-side atlas-to-array repack, with atlas-specific viewer permutations only if same-device/context interop proves impractical.

**Further Considerations**

1. If direct Three.js sampling of a WebGPU-updated layered texture proves awkward, keep the workflow split anyway and solve that interop locally inside the live branch. Do not merge the live and KTX2 branches back together just to avoid a new viewer seam.
2. WebGL same-context repack now looks like a plausible medium-sized refactor centered on renderer ownership and texture contracts, not like a full viewer rewrite.
3. WebGPU same-device repack is now more specifically a texture-ownership and queue-ordering problem, not a device-discovery problem. That prerequisite is tracked separately in `plan-deviceScopedTextureCoordinator.prompt.md` so the webcam plan can stay focused on product/workflow behavior.
4. `Camera Capture` can optionally add trim or retake affordances later, but the MVP should prioritize a clean recorded-file handoff into the existing processing pipeline.
5. `Encode Live Result` should preserve only the retained live texture set that exists at stop time. It should not pretend to reconstruct the full raw camera session unless the live branch explicitly keeps enough tile history to support that claim.
6. If the live branch eventually needs a `Freeze` or `Snapshot` action, treat that as an explicit post-stop export feature, not as a reason to reintroduce live encode pressure.
7. `Build Preview` is most clearly justified for WebGPU file mode. The current WebGL2 atlas builder is still a strong fit for KTX2 generation, but it does not automatically imply an equally clean viewer-ready preview path.
8. Atlas-to-array repack does not remove the need for a live-viewer integration seam. It only pays off if the builder and viewer can share the same GPU device or GL context.
9. Atlas sampling still likely increases shader-side UV bookkeeping and may need texel insets, gutters, or stricter mip policy to avoid layer bleeding. That is why it should remain the fallback rather than the default plan if repack succeeds.
