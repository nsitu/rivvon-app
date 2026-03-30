# Plan: Realtime Tile Transition Gap Smoothing

## Problem

In realtime mode, when a tile finishes sampling and the next tile begins, `activeTileCount` increments and ribbon segments remap, causing an abrupt visual jump. The new tile's canvas starts 100% transparent, creating a perceived "gap" that shrinks as rows fill in.

## Approach

Introduce a **virtual tile count** = `activeTileCount + gapFraction` (float) to smooth the transition.

- `gapFraction = samplingProgress = currentRow / tileHeight` (0 → 1 as tile builds)
- At tile start: `virtualCount = N + 0 = N` — no change in mapping
- At tile complete: `virtualCount = N + 1` — exactly what the mapping will be after increment
- When `activeTileCount` increments (tile completes), it resets `gapFraction = 0`, so `virtualCount = (N+1) + 0 = N+1` — **no jump**

The segment → material mapping uses `Math.floor(globalSegmentIndex % virtualCount)`:

- If result < `activeTileCount` → use that tile's material
- If result ≥ `activeTileCount` → use `_getFallbackMaterial()` (transparent gap)

The total perceived void (in-progress tile transparent pixels + gap segments) stays roughly constant at ~1 tile's worth throughout the entire sampling cycle.

## User decisions

- Gap is **on by default** (can be toggled off)
- Gap magnitude is **fixed at 1× tile** (no user slider needed)

---

## Steps

### Phase 1: TileManager — add gap property

- In `tileManager.js` constructor: add `this.realtimeGapFraction = 0` (float 0–1, default 0)
- Reset to `0` in `clearAllTiles()`
- This is a simple data field; no methods needed on TileManager itself

### Phase 2: RibbonSeries — apply gap in segment→material mapping

Modify **both** `initFlowMaterialsSilent()` (line ~198) and `initFlowMaterials()` (line ~278) in `ribbonSeries.js`.

In the inner loop where `material = tmA.getMaterial(textureIndex)` currently runs, replace with:

```js
if (
  tmA.realtimeMode &&
  tmA.realtimeGapFraction > 0 &&
  tmA.activeTileCount > 0
) {
  const virtualCount = tmA.activeTileCount + tmA.realtimeGapFraction;
  const virtualPos = globalSegmentIndex % virtualCount;
  const tileIndex = Math.floor(virtualPos);
  material =
    tileIndex >= tmA.activeTileCount
      ? tmA._getFallbackMaterial()
      : tmA.getMaterial(tileIndex);
} else {
  const textureIndex = globalSegmentIndex + tmA.getTileFlowOffset();
  material = tmA.getMaterial(textureIndex);
}
```

Note: `globalSegmentIndex % virtualCount` (float modulo) naturally distributes gap positions evenly across the ribbon in the same interleaved stripe pattern.

### Phase 3: useRealtimeSlyce — update gap fraction per frame

In `runFrameLoop()` inside the `for await` body (after `tileBuilder.processFrame(frame)`):

1. Compute `samplingProgress = tileBuilder.currentRow / tileBuilder.tileHeight`
2. If `viewerTileManager && realtimeGap.value && viewerTileManager.realtimeMode`:
   - `viewerTileManager.realtimeGapFraction = samplingProgress`
   - Call `viewerRibbonSeries.initFlowMaterialsSilent?.()` (the lightweight version)

Add `const realtimeGap = ref(true)` to reactive state.

In `startRealtime()`:

- After clearing tiles, set `viewerTileManager.realtimeGapFraction = 0`

In `stopRealtime()`:

- Set `viewerTileManager.realtimeGapFraction = 0`, then `refreshRibbonMaterials()` to clean up

Expose `realtimeGap` in the returned object from `useRealtimeSlyce`.

### Phase 4: RealtimeControls.vue — toggle UI

Add prop `gapEnabled: Boolean` and emit `update:gapEnabled`.
Add a small toggle button (or checkbox) in the `.realtime-actions` row labeled "Gap".

---

## Relevant files

- `apps/rivvon/src/modules/viewer/tileManager.js` — Add `realtimeGapFraction` field (constructor + `clearAllTiles()` reset)
- `apps/rivvon/src/modules/viewer/ribbonSeries.js` — Modify `initFlowMaterialsSilent()` and `initFlowMaterials()` inner loop logic
- `apps/rivvon/src/composables/slyce/useRealtimeSlyce.js` — Per-frame gap update in `runFrameLoop`, expose `realtimeGap` ref
- `apps/rivvon/src/components/slyce/RealtimeControls.vue` — Add `gapEnabled` prop + toggle UI

## Verification

1. Start realtime mode — confirm visual is smooth: no abrupt band shifts as tiles complete
2. Toggle gap off — confirm original behavior returns (same jumpy transition visible)
3. Open DevTools Performance — confirm `initFlowMaterialsSilent()` called per camera frame (~30fps) adds negligible overhead (no allocations, just property assignments)
4. Let `maxTiles` fill up and FIFO eviction trigger — confirm gap still works correctly
5. Stop realtime mid-tile — confirm gap fraction is cleaned to 0 and ribbon remaps correctly

## Decisions / Scope

- Gap is **on by default**; toggle off available in RealtimeControls
- Gap magnitude fixed at 1 tile (gapFraction = samplingProgress, always 0–1)
- Flow animation is already disabled in realtime mode — no interaction with flow offset
- tmB (helix strand B) gets same gap treatment via its own tileManager's `realtimeGapFraction` where applicable (in practice, realtime mode uses a single TileManager)
- No changes to KTX2 materials, shaders, or tile encoding pipeline
