## Plan: Shared Measuring Tape Layout

Implement a path-anchored measuring tape layout as the shared ribbon tiling model for both static drawn ribbons and procedural ribbons. Tiles occupy fixed arc-length intervals along each path, the path endpoint clips the final interval, and texture UVs preserve world scale instead of stretching to fit. Procedural ribbons should reuse the same interval/geometry/cap machinery, adding only per-frame path regeneration and pooled visibility updates. The central architectural change is to decouple texture sampling UV from endpoint cap alpha so caps can span multiple tile segments when a partial tile is too short to contain the cap shape.

**Steps**

1. Define the shared layout semantics.
   - Make measuring tape a general ribbon layout mode available to `Ribbon.buildFromPoints()`, `RibbonSeries.buildFromMultiplePaths()`, and the existing pooled procedural path builders.
   - Treat the tape as path-anchored arc length, not a world-space grid: tile 0 starts at path distance 0 for each path, tile 1 starts at one tile width, and the path endpoint clips the last tile.
   - Use the same interval and cap-coordinate code for static and procedural ribbons. Static ribbons build once; procedural ribbons update the same structure over time.
   - Keep alternate anchoring, centered anchoring, and world-grid/lattice semantics out of scope for this implementation.

2. Add a reusable tile-interval helper.
   - Create a non-reactive helper, preferably `apps/rivvon/src/modules/viewer/ribbonTileLayout.js`, instead of embedding this logic only in procedural code.
   - Given `pathLength`, `tileWorldLength`, and optional `maxSegmentCount`, return intervals with `tileIndex`, `tileStartDistance`, `tileEndDistance`, `visibleStartDistance`, `visibleEndDistance`, `visible`, `partialStart`, `partialEnd`, `uStart`, and `uEnd`.
   - `tileWorldLength` should initially equal the effective ribbon width already used by the one-tile-per-width density rule.
   - For static paths, interval count is `ceil(pathLength / tileWorldLength)`. For procedural pooled paths, interval count is the max pooled count, with visibility changing as length changes.

3. Refactor `Ribbon` around interval-driven segment generation.
   - Introduce a shared internal builder such as `_buildRibbonSegmentFromInterval()` or `_updateRibbonSegmentFromInterval()` that receives an interval and generates geometry from `visibleStartDistance / pathLength` to `visibleEndDistance / pathLength`.
   - Replace the current equal partition logic in `buildSegmentedRibbon()` with interval-driven segmentation, not just the new procedural pooled path.
   - Update `buildPooledSegmentedRibbon()` and `updatePooledSegmentedRibbon()` to call the same interval-driven segment generator.
   - Hidden procedural intervals keep their meshes pooled but invisible. Static ribbons simply do not allocate hidden intervals.
   - Store `mesh.userData.tapeTileIndex`, `mesh.userData.uStart`, `mesh.userData.uEnd`, and distance metadata so material assignment, debug info, and flow do not depend on loop position alone.

4. Preserve texture scale through partial UV ranges.
   - Keep `uv.x` as the tile sampling coordinate: `uStart + localT * (uEnd - uStart)`.
   - For a final tile that is 30% visible, its geometry should sample `uv.x = 0..0.3`, not stretch that fragment to `0..1`.
   - Keep `edgeNoiseU` path-distance based or interval-distance based so edge noise stays spatially stable with measuring tape segments.

5. Split texture UV from cap-coordinate attributes.
   - Add geometry attributes for endpoint cap math, likely `capStartU` and `capEndU`, derived from distance along the full path rather than tile-local UV.
   - Compute `capStartU = distanceFromPathStart / capWorldLength` and `capEndU = distanceFromPathEnd / capWorldLength` per vertex, with values allowed to exceed 1 outside the cap zone.
   - Use `capWorldLength` based on the existing visual footprint, probably `effectiveRibbonWidth * 0.5` to match the current half-tile cap feel.
   - If very short paths cause start/end cap overlap, clamp cap length to at most `pathLength / 2` for stable silhouettes.

6. Update cap shaders in both WebGL and WebGPU/TSL paths.
   - In `apps/rivvon/src/modules/viewer/tileManager.js`, change `computeCapAlpha()` so cap alpha consumes endpoint-distance coordinates independent of `vUv.x`.
   - Add WebGL vertex varyings for `capStartU` and `capEndU` anywhere `capStartStyle` / `capEndStyle` are currently passed.
   - Update WebGPU/TSL `createCapAlphaNode()` to read the new attributes and compute the same alpha.
   - Compute start cap alpha from `vec2(vCapStartU, vUv.y)` and end cap alpha from `vec2(vCapEndU, vUv.y)`, not from `vUv.x` and `1.0 - vUv.x`.
   - Keep overview/export plane geometries safe by giving new cap attributes defaults that produce full alpha when absent or not relevant.

7. Let endpoint caps span multiple tile intervals.
   - Preserve `capStartStyle` and `capEndStyle` as style selectors, but assign the style to every segment whose visible distance range intersects the endpoint cap span.
   - A segment receives start cap style if `visibleStartDistance < capWorldLength`.
   - A segment receives end cap style if `pathLength - visibleEndDistance < capWorldLength`.
   - Segments outside both endpoint cap spans keep zero cap styles.
   - This handles short partial-final-tile cases without squeezing the cap into `uv.x = 0..0.3`.

8. Adjust `RibbonSeries` material assignment to use tape tile indices.
   - In `RibbonSeries.initFlowMaterials()`, use `mesh.userData.tapeTileIndex ?? globalSegmentIndex` as the material base index.
   - Do the same for strand B/helix handling if measuring tape is enabled there later; for the first pass, verify standard ribbon mode first and explicitly decide whether helix uses measuring tape immediately or remains legacy until tested.
   - Preserve `segmentOffset` for multi-path continuity only if desired. Decide per product behavior whether each path starts its own tape at tile 0 or multiple paths continue one global tape. Recommended default: preserve current series continuity by adding a path-level tape offset, while still using fixed tile intervals within each path.

9. Preserve existing flow semantics for the first measuring-tape implementation.
   - Do not introduce a world-space `TileLattice` or spatial flow field.
   - Let existing flow shaders shift partial UV ranges and let geometry clip spillover.
   - Use stable tape tile indices so active tile count changes do not globally reassign materials.
   - Treat broader flow redesign as a future project after measuring tape geometry/caps are proven.

10. Keep deterministic procedural updates and normal static rebuilds.

- Static paths call the interval-driven builder once.
- Procedural paths call the same interval-driven updater from `RibbonSeries.updateProcedural(time)`.
- Continue calling procedural update from `apps/rivvon/src/composables/viewer/useRenderLoop.js` and `apps/rivvon/src/composables/viewer/useSceneExport.js` before undulation updates.
- Ensure export resets/reinitializes flow materials after animation state reset as it does today, so tape tile indices and flow tile offsets start from deterministic frame zero.

11. Add shared debug/telemetry.

- Add layout metadata to `Ribbon` or `RibbonSeries`, not only procedural debug info: `layoutMode`, `pathLength`, `tileWorldLength`, `visibleTileCount`, `totalAllocatedSegmentCount`, `partialFinalTileU`, `capWorldLength`, and `capSegmentsTouched`.
- Expose procedural-specific moving values through `getProceduralDebugInfo()`, but keep the core layout metrics reusable for static ribbons too.

12. Phase the rollout carefully.

- Phase A: implement interval helper and use it for static/procedural geometry with square caps or cap styles temporarily disabled if needed.
- Phase B: add cap-coordinate attributes in geometry and WebGL shader support.
- Phase C: add matching WebGPU/TSL support and defaults for non-ribbon/overview geometries.
- Phase D: re-enable rounded, pointed, and swallowtail caps across static and procedural measuring-tape ribbons.
- Phase E: verify helix, spherical projection, corner narrowing, and multi-path continuity; keep any unverified combination explicitly legacy-gated.

**Relevant files**

- `apps/rivvon/src/modules/viewer/ribbonTileLayout.js` — new shared interval/tape helper for static and procedural ribbons.
- `apps/rivvon/src/modules/viewer/ribbon.js` — refactor segment generation around intervals, partial UVs, cap-distance attributes, pooled mesh updates, and cap style assignment across endpoint-adjacent segments.
- `apps/rivvon/src/modules/viewer/ribbonSeries.js` — carry layout mode, preserve or define multi-path tape continuity, store layout debug info, and use tape tile indices in flow material setup.
- `apps/rivvon/src/modules/viewer/tileManager.js` — update WebGL and WebGPU/TSL cap alpha paths so caps use endpoint-distance attributes rather than tile-local UV.
- `apps/rivvon/src/modules/viewer/proceduralPaths.js` — no major change expected; sine path generation continues to provide animated path samples.
- `apps/rivvon/src/composables/viewer/useRibbonBuilder.js` — pass layout mode consistently for static and procedural ribbon creation if exposed as an option; avoid duplicate procedural-only code paths.
- `apps/rivvon/src/composables/viewer/useRenderLoop.js` — keep live procedural update call; no new animation loop concept needed.
- `apps/rivvon/src/composables/viewer/useSceneExport.js` — keep deterministic procedural update call; verify export frame zero with flow reset.
- Technical overlay components — optional later surface for shared measuring-tape metrics.

**Verification**

1. Run `pnpm build:rivvon` after implementation.
2. Verify default/static SVG ribbon creation, imported SVG, draw gesture, walk, text, emoji, and contour ribbons all render with measuring-tape layout.
3. Verify procedural sine ribbons use the same visual layout and only differ by per-frame path/interval updates.
4. Confirm full tiles do not slide or rescale when procedural active tile count changes; only the endpoint reveal changes.
5. Test a 3-to-20-to-3 procedural visible tile swing and verify final tiles appear/disappear as clipped partial tiles rather than triggering global re-layout.
6. Test very short static and procedural paths where `pathLength < tileWorldLength`; render one partial tile and verify caps remain stable.
7. Test rounded, pointed, and swallowtail caps when final visible tile is shorter than the nominal cap length, confirming the cap spans into earlier tiles.
8. Test multi-path drawings and decide whether tape index continuity across paths matches the existing visual expectation.
9. Test flow off, forward, backward, mirror/bounce/wrap repeat modes, and texture changes via `rebuildRibbonsWithNewTextures()`.
10. Export a short video and compare live vs exported timing for path motion, partial tile reveal, cap shape, and flow.
11. Test both WebGL and WebGPU renderer paths if WebGPU is available.
12. Smoke-test helix, spherical projection, and corner narrowing; document or gate any combination that is not yet reliable.

**Decisions**

- Use path-anchored measuring tape semantics, not world-grid/lattice semantics.
- Architect measuring tape as shared ribbon layout infrastructure for static and procedural ribbons.
- Preserve fixed world texture scale by using partial tile UV ranges rather than compressing the final tile to fill a segment.
- Caps must be endpoint-distance masks that can span multiple tile intervals; they must not rely on tile-local `uv.x`.
- Flow redesign is out of scope for the MVP. Keep existing TileManager flow behavior and make it consume stable tape tile indices.
- Start anchoring alternatives are out of scope; default to start-anchored tape at path distance 0.

**Further Considerations**

1. Multi-path continuity: continuing the tape across paths preserves current segment-offset behavior; resetting each path to tile 0 may be more intuitive for independent drawings. Recommendation: preserve current continuity first.
2. Start anchoring: start-anchored is simplest and stable; centered or phase-anchored tape may feel better for symmetric sine waves but will move both endpoints and should be evaluated separately.
3. Cap overlap aesthetics: very short paths may need a dedicated minimum-shape policy if start/end caps overlap in a visually awkward way.
