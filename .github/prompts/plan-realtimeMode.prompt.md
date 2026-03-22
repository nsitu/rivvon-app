# Plan: Realtime Webcam Mode for Rivvon

Add a **realtime webcam mode** that captures live camera frames, builds cross-section tiles on-the-fly using linear sampling (planes), previews them on the 3D ribbon during construction, and swaps to KTX2 textures on completion. Tiles recycle via FIFO eviction when a configurable limit is reached. Scope: capture + render loop only (no save/upload).

**Key idea borrowed from [timespy](https://github.com/nsitu/timespy):** Live camera frames are sampled row-by-row into N cross-section canvases (cosine distribution — identical logic in timespy's `frameProcessor.js` lines 73–108). While a tile is being built, the viewer's render loop displays the in-progress tile by pointing a single `THREE.Texture` at whichever canvas matches the current animation layer — one lightweight GPU upload per render frame, no pixel copying. Once all rows are filled, canvases are KTX2-encoded via the existing worker pool and the preview texture is replaced with the compressed KTX2 array texture.

**Tile lifecycle & canvas pool:** KTX2 encoding is async and does not begin until all samples are collected for a tile. The webcam continues delivering frames during encoding, so the next tile starts building immediately. Each tile therefore passes through three states: **building** (canvases actively receiving rows) → **encoding** (sampling done, KTX2 workers running, canvases retained for preview display) → **complete** (KTX2 ready, canvases released). A **canvas pool** allocates a set of `crossSectionCount` OffscreenCanvases per in-flight tile. When a tile enters `complete`, its canvas set is returned to the pool for reuse. This avoids assuming encoding finishes before the next tile's sampling completes — any number of tiles can remain in `encoding` (preview) state simultaneously. At ~7.5 MB per canvas set (30 × 256×256 RGBA), 2–3 concurrent sets are modest (~22 MB). At 128² this drops to ~1.9 MB/set.

```
                              Tile Lifecycle
                    ┌──────────┐  ┌──────────┐  ┌──────────┐
                    │ BUILDING │─▶│ ENCODING │─▶│ COMPLETE │
                    │ canvases │  │ canvases │  │ canvases │
                    │ active   │  │ retained │  │ released │
                    └──────────┘  └──────────┘  └──────────┘
                                        ▲
            ┌──────── Canvas Pool ───────┘── recycles on complete
            │
┌───────────┴─┐      ┌──────────────────────┐
│  Webcam      │─────▶│  RealtimeTileBuilder  │
│ (MSTP reader)│      │  (canvas pool +       │
└─────────────┘      │   per-tile canvasSet) │
                      └──────────┬───────────┘
                                 │
                   ┌─────────────┼──────────────────┐
                   │ per render  │                   │ sampling done
                   │ frame       │                   │
                   ▼             │                   ▼
     ┌───────────────────┐      │      ┌─────────────────────┐
     │  PreviewTexture    │      │      │  KTX2WorkerPool +   │
     │  (per-tile Texture │      │      │  KTX2Assembler      │
     │   .image = canvas  │      │      └──────────┬──────────┘
     │   [currentLayer])  │      │                  │ async
     │  1 upload/tile/    │      │                  ▼
     │  frame             │      │      ┌──────────────────┐
     └────────┬──────────┘      │      │  KTX2ArrayTexture│
              │                 │      │  (final tile)    │
              │  swap on        │      └────────┬─────────┘
              │  encode done    │               │
              ▼                 │               │
     ┌────────────────────┐     │               │
     │  Ribbon segment    │◀────┘───────────────┘
     │  (sampler2D during │          material swap
     │   building+encoding│
     │   sampler2DArray   │
     │   after KTX2)      │
     └────────────────────┘
```

---

## Steps

### Phase 1 — Camera Capture Module

1. Create `modules/slyce/realtimeCamera.js` — `RealtimeCamera` class wrapping `MediaStreamTrackProcessor` with inline polyfill (from timespy's `polyfillMSTP.js`). Viewport-aware resolution (default 640×480, max 720p), front/rear toggle, async `getFrameStream()` generator yielding `VideoFrame` objects. Borrow resolution calculation and camera toggle logic from timespy's `CameraManager`.

### Phase 2 — Realtime Tile Builder

2. Create `modules/slyce/realtimeTileBuilder.js` — `RealtimeTileBuilder extends EventEmitter`.

   **Canvas pool:** Maintains a pool of canvas sets. Each canvas set is an array of `crossSectionCount` (default 30) OffscreenCanvases of size `potResolution × potResolution` (always square — e.g., 256×256). On construction, one initial set is created. `claimCanvasSet()` returns a set from the pool (or creates a new one if empty). `releaseCanvasSet(set)` returns a set to the pool for reuse.

   **Per-tile lifecycle:** Each tile in progress holds its own canvas set (claimed from the pool). `processFrame(videoFrame)` samples one row per canvas using **cosine distribution** (identical to timespy's `processFrame()` and rivvon's existing planes mode in `tileBuilder.js`). When `currentRow >= tileHeight`, emits `'complete'` with `{ tileId, canvasSet, images: [{rgba, width, height}, ...] }` — `images` provides extracted RGBA for `KTX2Assembler` compatibility, while `canvasSet` is retained by the orchestrator for continued preview rendering. The builder then claims a fresh canvas set from the pool and begins the next tile immediately — it does **not** wait for KTX2 encoding.

   The orchestrator is responsible for calling `releaseCanvasSet(set)` once KTX2 encoding completes for that tile.

### Phase 3 — Single-Layer Preview Texture

3. Create `modules/viewer/previewTexture.js` — `PreviewTexture` class. Manages preview rendering for **any tile in `building` or `encoding` state**. Each preview tile gets its own `THREE.Texture` instance, since multiple tiles can be in preview state simultaneously (one building + one or more encoding).

   For each preview tile, the texture's `.image` is swapped each render frame to the OffscreenCanvas matching the current animation layer from **that tile's canvas set**. **One GPU upload per preview tile per render frame, zero pixel copying** — Three.js renders directly from the OffscreenCanvas via `gl.texImage2D(target, ..., canvas)`. Also creates a simple `sampler2D` preview material (`THREE.MeshBasicMaterial` or lightweight `ShaderMaterial`) for each preview tile's ribbon segment.

   **Why not DataArrayTexture?** Uploading all 30 layers every few frames would mean ~180 layer-uploads/sec and ~23 MB/sec bandwidth. But the viewer only needs to display one layer per frame (e.g. via `uLayer` ping-pong). By uploading just the visible canvas as a 2D texture, we achieve ~24 uploads/sec per preview tile at ~3.75 MB/sec — a **6× bandwidth reduction** with no visual difference during preview.

   **Key methods:**
   - `addPreviewTile(tileId, canvasSet)` — creates a `THREE.Texture` + `sampler2D` material for the tile, stores the canvas set reference
   - `removePreviewTile(tileId)` — disposes texture + material (called when KTX2 swap completes)
   - `update(currentLayer)` — called from the render loop each frame, iterates all active preview tiles:

   ```
   for (const preview of this.activePreviews.values()) {
     preview.texture.image = preview.canvasSet[currentLayer]
     preview.texture.needsUpdate = true
   }
   ```

   In practice, at most 2–3 preview tiles exist at once (1 building + 1–2 encoding). Each adds one GPU upload per frame — a trivial cost.

### Phase 4 — TileManager Extensions (_depends on Phase 3_)

4. Add methods to `modules/viewer/tileManager.js`:
   - `addTileFromBuffer(ktx2Buffer, tileIndex)` — parse KTX2, create `sampler2DArray` material, insert into `materials[]`/`arrayTextures[]`
   - `removeTile(tileIndex)` — dispose texture + material, remove from arrays, update `tileCount`
   - `setPreviewMaterial(tileIndex, previewMaterial)` — assign the `sampler2D` preview material (from `PreviewTexture`) to a tile slot in `building` or `encoding` state. When KTX2 encoding completes, the orchestrator swaps this to the KTX2 `sampler2DArray` material via `addTileFromBuffer()`

### Phase 5 — Orchestrator Composable (_depends on Phases 1–4_)

5. Create `composables/slyce/useRealtimeSlyce.js` — Vue composable wiring everything together:
   - `startRealtime(viewerContext)`: init camera → create `RealtimeTileBuilder` → init `KTX2WorkerPool` (2 workers in realtime mode) → create `PreviewTexture` → register preview for tile 0 → start frame loop (`for await (const frame of camera.getFrameStream())`)
   - **Render loop hook**: Each frame, call `previewTexture.update(currentLayer)` — for every active preview tile, swaps its texture source to the canvas matching the layer animation, triggering one GPU upload per preview tile
   - **Tile state management**: Maintains a `Map<tileId, TileState>` where each entry tracks `{ state: 'building' | 'encoding' | 'complete', canvasSet?, ktx2Buffer? }`. Tiles transition:
     1. `building` — actively receiving sampled rows; canvasSet owned by `RealtimeTileBuilder`; preview material assigned to ribbon segment
     2. `encoding` — sampling done, canvasSet retained by orchestrator for preview display; RGBA data sent to `KTX2Assembler.encodeParallelWithPool()`; next tile begins building with a fresh canvas set
     3. `complete` — KTX2 buffer ready; swap `sampler2D` preview material for `sampler2DArray` KTX2 material; call `previewTexture.removePreviewTile(tileId)`; call `tileBuilder.releaseCanvasSet(canvasSet)` to return canvases to pool
   - `onTileComplete(payload)`: transition tile to `encoding` → register its `canvasSet` with `PreviewTexture` (it's already registered from `building` — no change needed) → kick off async KTX2 encode → on encode resolve: transition to `complete`, do material swap, release canvas set, apply **FIFO eviction** if `completedTiles >= maxTiles`
   - `stopRealtime()`: stop camera, flush any `encoding` tiles (wait for KTX2 or discard), keep completed KTX2 tiles animating on ribbon
   - Reactive state: `isCapturing`, `currentTileIndex`, `currentRow`, `completedTiles`, `maxTiles` (default 16), `fps`, `encodingTiles` (count of tiles in `encoding` state)

### Phase 6 — UI Integration (_parallel with Phase 5_)

6. Create `components/slyce/RealtimeControls.vue` — minimal overlay: start/stop, camera flip, status bar (`Tile 3/16 | Row 64/128 | 22 fps`), resolution selector (480p/720p), tile limit slider. Mount in `views/RibbonView.vue` when `?realtime=true` query param active, following existing panel overlay pattern.

7. Minor modifications: add `'videocam'`, `'stop_circle'` to `loadMaterialSymbols()` in `main.js`. Recognize `?realtime=true` in `router/index.js`.

### Phase 7 — Resource Management (_parallel with Phase 5_)

8. **Fixed tile geometry for realtime:** `tileProportion` is locked to `'square'` and `prioritize` is locked to `'powersOfTwo'`. The user only selects a `potResolution` (128, 256, or 512 — default 256). Canvases are always square: `potResolution × potResolution`. This eliminates the landscape/portrait/quantity/quality options that exist in batch Slyce — those depend on known video dimensions and frame counts that don't apply to a live webcam stream. The orchestrator sets these values on `startRealtime()` regardless of what's in the store.

   Lower defaults for realtime: 640×480 capture, `potResolution=256` (→ 256×256 canvases), `maxTiles=16`, worker pool limited to 2 workers. Detect `navigator.hardwareConcurrency < 4` or `navigator.deviceMemory < 4` → reduce to `potResolution=128`, `maxTiles=8`. Monitor FPS via existing `resourceMonitor.js`.

---

## Relevant Files

### New files:

- `apps/rivvon/src/modules/slyce/realtimeCamera.js` — webcam capture with MSTP + polyfill
- `apps/rivvon/src/modules/slyce/realtimeTileBuilder.js` — streaming cross-section builder
- `apps/rivvon/src/modules/viewer/previewTexture.js` — single-layer preview texture + `sampler2D` material
- `apps/rivvon/src/composables/slyce/useRealtimeSlyce.js` — orchestrator composable
- `apps/rivvon/src/components/slyce/RealtimeControls.vue` — overlay UI

### Modified files:

- `apps/rivvon/src/modules/viewer/tileManager.js` — add `addTileFromBuffer()`, `removeTile()`, `setPreviewMaterial()` (reuse `#initKTX2()`, `#loadKTX2Tile()`, `#createArrayMaterial()`)
- `apps/rivvon/src/views/RibbonView.vue` — mount RealtimeControls, wire `useRealtimeSlyce()` (follow existing panel pattern with `textureCreatorVisible`)
- `apps/rivvon/src/main.js` — add icon names to `loadMaterialSymbols()` array
- `apps/rivvon/src/router/index.js` — recognize `?realtime=true` query param

### Reused unchanged:

- `apps/rivvon/src/modules/slyce/ktx2-worker-pool.js` — `KTX2WorkerPool` (created with `workerCount=2`)
- `apps/rivvon/src/modules/slyce/ktx2-assembler.js` — `KTX2Assembler.encodeParallelWithPool()`
- `apps/rivvon/src/composables/viewer/useRenderLoop.js` — render loop continues running

---

## Verification

1. **Cosine sampling accuracy**: Feed `RealtimeTileBuilder` synthetic solid-colored frames with distinct rows → verify each canvas samples the expected cosine-distributed row
2. **Preview texture rendering**: Assign `PreviewTexture` to a test plane, verify that swapping `.image` to different canvases each frame produces correct layer-cycling animation (ping-pong for planes) with no visual artifacts
3. **KTX2 roundtrip**: `RealtimeTileBuilder` output → `KTX2Assembler` → `TileManager.addTileFromBuffer()` → confirm renders identically to DataArrayTexture preview
4. **FIFO eviction**: Set `maxTiles=3`, let 5 tiles complete → verify only last 3 remain on ribbon, first 2 disposed (check for memory leaks via `performance.memory`)
5. **Performance target**: ≥20fps render + 24fps capture simultaneously on mid-range hardware (M1 MacBook Air, recent Android phone)
6. **Camera toggle**: Switch front/rear mid-capture without crash, verify tile builder continues seamlessly
7. **End-to-end manual**: Start realtime → see live cross-sections building on ribbon → tiles complete and sharpen (KTX2 swap) → flow animation works across completed tiles → stop → tiles persist and animate

---

## Decisions

- **Planes only (no waves)** — Waves requires known frame count for sine period. Realtime is open-ended, so cosine-distributed planes is the natural fit. Ping-pong layer animation already supports planes variant.
- **No save/upload** — Tiles live in memory only. Save to IndexedDB/Drive/R2 is a follow-up.
- **No viewer suspension** — Unlike batch Slyce, realtime keeps the viewer running. Resource pressure handled via lower resolution and throttling.
- **MSTP polyfill included** — Cross-browser support (Firefox/Safari) via timespy's pattern.
- **Worker pool capped at 2** — Prevents encoding from starving capture/render threads.
- **Square power-of-two tiles only** — Landscape/portrait proportions and quantity/quality priority modes depend on known video dimensions and frame counts, which are unavailable in a live stream. Locking to `tileProportion='square'` + `prioritize='powersOfTwo'` yields clean 128², 256², or 512² canvases — GPU-friendly, predictable memory footprint, and no tile-planning complexity.

## Further Considerations

2. **Adaptive quality**: If FPS drops below threshold during capture, automatically reduce capture resolution or skip preview texture updates for some frames. Leverage existing `resourceMonitor.js`.
3. **Mobile thermal throttling**: Extended capture on mobile will trigger throttling. Consider an auto-pause after N minutes or a temperature-aware capture rate reduction.
