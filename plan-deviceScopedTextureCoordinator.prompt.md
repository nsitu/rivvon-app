## Plan: Device-Scoped Texture Coordinator

Introduce a follow-on rendering-architecture layer for shared WebGPU texture ownership after the standalone WebGPU direct-array builder spike has been evaluated inside the current encoding pipeline. This document is about shared ownership between builder and viewer, not about proving the builder-local no-atlas path for the first time. For decoded-frame workflows, the target seam is still one builder-owned source-frame texture and one viewer-consumed array texture on the same `GPUDevice`, with a GPU pass that samples the current frame and writes cropped strips directly into array layers.

This plan is intentionally narrower than the webcam split. It does not redesign camera UX, recording, KTX2 export flows, or product naming. It exists to validate the shared-resource seam that those later features depend on and to answer whether atlas staging is actually necessary for live rendering.

The standalone file-mode WebGPU no-atlas builder spike has now landed in the current encoding pipeline. This coordinator plan should be read as the next architecture track after that builder-local work, focusing on shared allocations and lifecycle between builder and viewer.

Direct frame upload is feasible in principle: WebGPU `copyExternalImageToTexture()` accepts `VideoFrame` and `ImageBitmap` sources, allows source sub-rect selection, and can target a destination texture subresource with array-layer origin. That means the current staging canvas in the realtime path is not a hard prerequisite for a WebGPU-first live path. However, pure copy commands are not enough to preserve the current crop/distribution behavior. The current pipeline samples many layer-specific rows and rescales them into tile-width rows; that transform still requires a GPU shader pass, not just queue copy calls. Atlas should therefore be treated as a fallback or file-mode optimization, not as the baseline assumption for the live path.

The performance question should be framed precisely. For a tile with width `W`, height `H`, and layer count `L`, both atlas and direct-array assembly write the same output payload: `W * H * L * 4` bytes of RGBA before KTX2 encode. The difference is not raw bytes moved; it is command shape.

- Current atlas render path: `H` source uploads, `H` render passes, then layer-by-layer atlas readback.
- Direct-array batched shader path: `H` source uploads, `H` compute dispatches or equivalent batched GPU passes, then one array-texture readback over `depthOrArrayLayers = L`.
- Direct-array per-layer render path: `H` source uploads, `H * L` render passes, then array readback.
  That means a batched direct-array path should be close to atlas in assembly cost because the command count stays in the same order and the written byte volume is identical. The structurally slower path is not "no atlas" by itself; it is the specific variant that replaces one batched pass with one render pass per layer.

This distinction matters differently by mode. In live mode, assembly cost is the product, so a per-layer render loop is risky and a batched shader path is the right comparison. In file mode, the current code already decodes at most one completed tile ahead of KTX2 encode and prior local validation has shown encode dominating total wall-clock time, so even a moderate assembly regression would often be hidden by encode. If the batched direct-array path is fast enough for live mode, it is not just plausible but a stronger fit for file mode, where latency constraints are looser and the same array texture can feed either the viewer or KTX2 readback.

At the WebGPU/WGSL API level, the batched compute path is now demonstrated to be legal. WebGPU bind-group layouts permit `storageTexture` bindings with `viewDimension: "2d-array"`, `GPUTexture.createView()` supports `dimension: "2d-array"`, WGSL defines `texture_storage_2d_array<Format, Access>`, and `textureStore()` has an overload that accepts `(coords, array_index, value)` for that type. `rgba8unorm` is in the core storage-texture format table, and write-only storage access does not require the optional read-write storage-texture extension. In practical terms: one sampled source texture plus one write-only `rgba8unorm` array storage texture is enough to express the no-atlas batched path in core WebGPU. What remains unproven is repo-level integration and runtime performance, not API legality.

The first milestone in this follow-on track is a narrow sharing spike: one direct source upload, one viewer-consumed array texture, one source-to-array GPU population path, one render-loop integration point, and clear lifecycle semantics. If that spike fails, the webcam plan should fall back to atlas-backed viewer materials or another narrower rendering seam rather than continuing under the assumption that direct source-to-array ownership is solved.

**Steps**

1. Define explicit ownership invariants from the current code paths.
   Document the current constraints in the implementation surface:
   - `apps/rivvon/src/modules/viewer/threeSetup-webgpu.js` creates and initializes the active `THREE.WebGPURenderer`
   - `apps/rivvon/src/composables/viewer/useThreeSetup.js` is the best current seam for exposing renderer lifecycle to non-viewer code
   - `apps/rivvon/src/modules/viewer/tileManager.js` currently treats textures/materials as directly disposable viewer-owned objects
   - `apps/rivvon/src/modules/slyce/realtimeTileBuilder.js` currently requires a 2D staging canvas and emits completed tiles through canvas-backed readback
   - `apps/rivvon/src/composables/slyce/useRealtimeSlyce.js` currently reaches the viewer only through `tileManager.addTileFromBuffer()` after KTX2 encode
   - `apps/rivvon/src/modules/slyce/webgpuTileBuilder.js` already proves direct GPU upload via `copyExternalImageToTexture()`, but still stages through a private upload canvas and atlas
     The coordinator must replace those implicit ownership assumptions with one model for allocation, borrowing, release, and teardown.

2. Treat this as a prerequisite track for webcam live mode and file preview mode, but spike the live path first.
   Do not start by wiring camera capture, route flow, or panel work into the new architecture. First prove that the active viewer renderer can host a shared texture coordinator and that a decoded frame can flow directly into a source GPU texture and then into a viewer-consumed array texture on that same device without an atlas intermediate.

3. Expose the active renderer/backend/device through a supported app seam.
   Extend `apps/rivvon/src/composables/viewer/useThreeSetup.js` and the stored viewer context so the coordinator can attach to the active renderer lifecycle. The coordinator should not independently request a new adapter or device. The viewer remains the top-level owner of the active WebGPU renderer; the coordinator is a device-scoped service attached to that renderer.

4. Choose the first spike path deliberately.
   Prefer a viewer-bound stable array texture contract first and treat atlas-backed repack as the fallback, not the starting point.
   - First choice: the coordinator owns one source-frame texture plus one stable viewer-bound array texture/wrapper that `TileManager` can consume directly. The builder uploads the current `VideoFrame` or `ImageBitmap` into the source texture, then records a GPU pass that writes cropped rows into the array layers.
   - First-choice implementation detail: a shader is mandatory. If "compute" is read narrowly as "compute shader," that is not the only possible shader stage, but it is the cleanest way to keep no-atlas writes batched at one dispatch per source frame instead of one render pass per layer.
   - Fallback choice: the coordinator keeps atlas staging internal for browsers/backends where direct source-to-array writes prove too brittle, or for file-mode if a no-atlas path cannot preserve acceptable batching throughput.
   - Explicit non-goal: do not treat queue copy commands alone as sufficient. They can target sub-rects and array layers, but they do not express the current per-layer crop distribution plus resize semantics by themselves.
     This ordering reduces disposal risk because `TileManager` already expects Three texture objects.

5. Create a dedicated coordinator module with explicit allocation and lifecycle APIs.
   Add a focused module such as `apps/rivvon/src/modules/shared/deviceTextureCoordinator.js` or equivalent. The coordinator should centralize:
   - source-frame texture creation and reuse
   - viewer-visible array allocation creation and reuse
   - source-to-array GPU command recording
   - optional atlas fallback allocation and repack for file-mode or compatibility cases
   - borrow/release or retain/release semantics for viewer-facing wrappers
   - explicit reallocation for size, layer-count, or format changes
   - full teardown when the renderer is disposed or replaced
     Avoid a generic resource manager at first. Keep the API narrowly scoped to the source-plus-array problem the viewer and builders actually need.

6. Prototype a direct source-to-array population path with crop semantics intact.
   The coordinator should prove one GPU path that preserves current planes/waves sampling behavior without CPU staging and without atlas intermediate.
   - Preferred spike: a compute path or equivalent batched GPU shader path that samples the source texture and writes array layers directly. This is the apples-to-apples comparison against atlas because it preserves one GPU dispatch/pass per source frame.
   - API proof point: this is not speculative anymore. The required destination type and shader write primitive both exist in core WebGPU/WGSL, so the main remaining question is implementation shape and measured performance in this codebase.
   - Fallback spike: repeated render passes targeting per-layer views of the array texture if compute/storage-texture integration proves awkward.
   - File-mode implication: atlas is not required by the KTX2 encode boundary. The real tradeoff is batching shape. With atlas, the current builder uses one instanced render pass per source frame. Without atlas, a batched compute/storage-texture path should stay in that same command-count class, while a per-layer render-pass loop would multiply pass count by `L`.
   - Readback implication: the current atlas builder copies each layer cell out separately during `readImages()`. A direct array path can read the entire array texture in one `copyTextureToBuffer()` call with `depthOrArrayLayers = L`, so no-atlas does not create a new structural readback penalty for file-mode encode.
   - Failure mode to isolate: whether the blocker is copy primitive limits, array-write limits, or Three wrapper integration rather than device sharing itself.

7. Add deterministic pre-render flush ordering.
   The coordinator should own the ordering between builder updates and viewer sampling. Add a small integration seam in `apps/rivvon/src/composables/viewer/useRenderLoop.js` or the rendering path so source uploads and source-to-array GPU work are flushed before the frame that samples the array texture. The coordinator should not rely on builder-side ad hoc queue submission timing.

8. Add a borrowed live-texture registration seam in the viewer.
   Extend `apps/rivvon/src/modules/viewer/tileManager.js` with a seam such as `registerBorrowedLiveArrayTexture()` or equivalent that accepts a stable viewer-facing texture contract without assuming direct ownership. The critical rule is that `TileManager` must not call `texture.dispose()` on coordinator-owned resources during normal tile removal, clear, or teardown. Instead it should release them through the coordinator or a provided release callback.

9. Adapt the realtime and WebGPU builders to request allocations instead of owning them.
   Refactor `apps/rivvon/src/modules/slyce/realtimeTileBuilder.js`, `apps/rivvon/src/modules/slyce/webgpuTileBuilder.js`, or successor modules so they can:
   - attach to the shared coordinator
   - request source-frame texture access
   - request or reference the viewer-visible array target
   - record source-to-array GPU work through the coordinator
   - stop owning independent device bootstrap and canvas staging paths for the shared-resource mode
   - expose file-mode readback from the array target directly when the KTX2 pipeline needs RGBA layers
     Keep this adaptation narrow for the first spike: one tile or one tile ring is enough to validate the seam.

10. Enforce stable viewer-bound array semantics during steady-state streaming.
    The spike should prove one key invariant: once a live or preview stream is active, the viewer keeps sampling the same array `GPUTexture` allocation and the same Three wrapper object while source contents and GPU write work rotate underneath it. During normal streaming, the coordinator should update contents in place rather than replacing the sampled array allocation. Only explicit configuration changes such as width, height, layer count, or format changes should trigger a real reallocation/swap.

For the direct path, read that invariant as: the viewer keeps sampling the same array allocation and wrapper while the source texture contents and source-to-array writes update underneath it.

11. Validate disposal and recovery behavior.
    Test the uncomfortable paths early:

- `TileManager.clearAllTiles()` / `removeTile()` / `dispose()`
- viewer teardown through `useThreeSetup()`
- renderer/device replacement or loss
- re-entering the viewer after teardown
  The coordinator must prove that it can release borrowed resources cleanly, avoid double-destroying wrapped textures, and tear itself down when the active renderer goes away.

12. Only after the spike passes should downstream webcam and preview work depend on it.
    Once the coordinator spike is validated, feed that proven seam back into:

- `plan-webcamLiveTextureAndKtx2Capture.prompt.md`
- any future file-preview implementation plan
- any WebGL same-context follow-up if the architecture still appears worth mirroring there, but with the explicit assumption that core WebGL2 does not offer the same batched arbitrary-layer write path as WebGPU

**Relevant files**

- `apps/rivvon/src/modules/viewer/threeSetup-webgpu.js` — active WebGPU renderer creation and initialization.
- `apps/rivvon/src/composables/viewer/useThreeSetup.js` — best current seam for attaching coordinator lifecycle to the active viewer renderer.
- `apps/rivvon/src/composables/viewer/useRenderLoop.js` — likely home for coordinator flush ordering before render.
- `apps/rivvon/src/modules/viewer/tileManager.js` — current texture/material ownership boundary that must learn borrowed-resource semantics.
- `apps/rivvon/src/modules/slyce/realtimeTileBuilder.js` — current live path that still requires a staging canvas.
- `apps/rivvon/src/composables/slyce/useRealtimeSlyce.js` — current realtime viewer apply path that still depends on KTX2 buffers.
- `apps/rivvon/src/modules/slyce/webgpuTileBuilder.js` — current builder-owned device path to refactor toward coordinator-owned allocations.
- `apps/rivvon/src/composables/viewer/useSceneBackground.js` — background sampling path that must continue to work when textures come from the coordinator seam.
- `apps/rivvon/src/stores/viewerStore.js` — existing shared viewer context storage that may expose the coordinator or its renderer attachment.
- `apps/rivvon/src/modules/shared/deviceTextureCoordinator.js` — new coordinator module candidate.
- `apps/rivvon/src/composables/slyce/useLiveCameraTexture.js` — future downstream consumer, but not part of the prerequisite spike itself.
- `plan-webcamLiveTextureAndKtx2Capture.prompt.md` — downstream product/workflow plan that should depend on this prerequisite instead of absorbing it.

**Verification**

1. The coordinator attaches to the active viewer renderer and does not request a second `GPUDevice`.
2. One direct source-frame upload and one viewer-bound array texture can coexist on that shared device.
3. `VideoFrame` or `ImageBitmap` upload into a source `GPUTexture` works without the current staging canvas.
4. Source-to-array GPU population preserves the current crop/distribution semantics for both planes and waves without a CPU RGBA roundtrip.
5. The viewer can sample the array texture while the builder continues updating source texture contents.
6. The spike path does not require an atlas intermediate for the live path.
7. During steady-state streaming, the viewer keeps sampling the same array `GPUTexture` allocation and the same Three wrapper object across repeated updates.
8. Builder uploads and source-to-array work flush before the viewer samples the array texture for that frame.
9. `TileManager` no longer directly destroys coordinator-owned borrowed resources during remove/clear/dispose.
10. Explicit reallocation only happens when shape or format changes require it.
11. Coordinator teardown releases resources cleanly on viewer teardown or device loss.
12. If the direct path fails, the failure is localized to crop/write integration rather than shared-device ownership.
13. File-mode KTX2 export remains viable without atlas because the encoder only requires per-layer RGBA images; array-texture readback can satisfy that contract directly.
14. The plan distinguishes two no-atlas performance classes clearly: batched shader writes should stay near atlas cost, while per-layer render passes are the only variant expected to incur a large structural slowdown.
15. The batched compute/storage-texture variant is API-feasible in core WebGPU; the next spike only needs to prove integration and performance, not fundamental capability.

**Decisions**

- Treat this as a prerequisite architecture spike, not as part of the webcam UX implementation itself.
- Scope the first pass to WebGPU only.
- Prefer a stable viewer-bound array texture contract plus a direct source-frame upload first.
- Treat atlas as a fallback or file-mode optimization, not as a live-mode prerequisite.
- Compare atlas against a batched direct-array shader path, not against a per-layer render-loop strawman.
- Make deterministic pre-render flush ordering part of the plan, not an implementation afterthought.
- Defer camera workflow, KTX2 export, and panel work until this seam is validated.

**Further Considerations**

1. `copyExternalImageToTexture()` can skip the upload canvas and can address source sub-rects and destination array layers, but it cannot perform the current many-layer crop-and-resize transform by itself; a shader pass still owns that logic.
2. If the viewer-bound stable array contract cannot expose a clean direct write target, test the borrowed external-array wrapper path next rather than abandoning the shared-resource architecture immediately.
3. If borrowed external-array wrappers are required, `TileManager` ownership rules must change before webcam work starts; otherwise the viewer will destroy coordinator-owned textures during ordinary cleanup.
4. File mode can also avoid atlas because `KTX2Assembler` only needs per-layer RGBA images; atlas is a batching strategy, not an encoder requirement.
5. Atlas currently earns its keep in file mode because the render-path builder can populate all layers in one pass by drawing into atlas cells. A direct-array path only deserves to be called "slower" if it falls back to one render pass per layer per source frame. A batched compute/storage-texture path stays in the same pass/dispatch class as atlas.
6. In file mode, end-to-end throughput is currently dominated by KTX2 encode, not by decode or layer assembly. That means even a moderate assembly regression may not move overall processing time much, while a batched direct-array path may be effectively neutral.
7. In live mode, latency is the product, so the direct-array path must be judged there first. If a batched no-atlas shader path is good enough for live mode, it should also be acceptable for file mode unless the array-texture readback path introduces an unexpected browser-specific penalty.
8. If compute/storage-texture integration proves awkward or fragile, keep atlas as the fallback. Do not conflate that fallback with proof that direct-array assembly is inherently too slow.
9. A future WebGL same-context coordinator may still be worthwhile, but it should not be coupled to the success criteria of the first WebGPU prerequisite spike.
10. Core WebGL2 can render into a chosen array layer via `framebufferTextureLayer()`, but that is CPU-selected attachment state, not a WebGPU-style shader-directed storage write path. In practice, a no-atlas WebGL2 path would mean per-layer attachment loops or limited MRT tricks, not one general batched write across arbitrary layers.
11. `OVR_multiview2` is the only browser-exposed WebGL2 mechanism here that can broadcast one draw into multiple array layers, but it targets a contiguous view range, is intended for low-view-count VR use, disallows the geometry-shader escape hatch used for general `gl_Layer` selection, and has weak browser coverage including no Safari support. It should not be treated as the WebGL analogue of the planned WebGPU batched direct-array path.
12. The current repo still lacks a concrete compute prototype. The next discriminating check should be a one-tile WebGPU spike that writes a single frame into a `rgba8unorm` `2d-array` storage texture via `textureStore()` and then reads it back through the existing RGBA layer contract.
