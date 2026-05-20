## Plan: Procedural Sine Ribbon

Build a procedural ribbon source that draws from an animated signal instead of a captured drawing. The first source is a Sine Wave option in the Draw menu. On each frame, the effective drawing is the current plot of that signal, and the textured ribbon follows the evolving plot line.

The core behavior is dynamic tile density: the current plot length determines the active tile count, preserving world-space texture scale as the signal expands and contracts. To avoid rebuilding geometry/materials whenever the count changes, allocate a max segment pool from the known or tracked peak length, then toggle active segment meshes as the current length changes.

**Steps**

1. Preserve the existing drawing pipeline as the baseline for static paths. Current drawings are normalized/smoothed in `apps/rivvon/src/composables/viewer/useRibbonBuilder.js` through `createRibbonFromDrawing()`, then passed to `RibbonSeries.buildFromMultiplePaths()`. `Ribbon.buildSegmentedRibbon()` in `apps/rivvon/src/modules/viewer/ribbon.js` calculates `segmentCount = ceil(totalLength / width)`, so the procedural implementation should keep the same one-tile-per-ribbon-width density rule while managing active segment count dynamically.
2. Define procedural path source model. Add a small non-reactive module such as `apps/rivvon/src/modules/viewer/proceduralPaths.js` with a `sineWave` generator that returns `THREE.Vector3` samples for time, amplitude, frequency, domain width, phase speed, vertical offset, and sample count. Include support for time-varying amplitude and/or frequency so the test signal can cycle between a relatively flat line and a line with many high peaks/troughs. Keep this separate from drawing persistence at first.
3. Add viewer state/actions for procedural mode. Extend `apps/rivvon/src/stores/viewerStore.js` with `proceduralPathMode`, a `sineWaveSettings` object, and setters. Do not persist broadly until the UX is stable; optionally persist only simple settings later with the existing `readViewerPreferences()` / `writeViewerPreferences()` pattern.
4. Add a creation command in `apps/rivvon/src/composables/viewer/useRibbonBuilder.js`, likely `createProceduralRibbon(sourceConfig)`, that creates a `RibbonSeries`, applies TileManagers, sets helix options, builds the initial generated path, initializes flow materials, clears camera ROIs, and stores procedural metadata on the series or builder context.
5. Implement dynamic density as the only continuity model. For each frame, calculate current path length and `desiredActiveSegmentCount = max(1, ceil(currentLength / effectiveWidth))`, matching the existing drawing behavior where one segment maps to roughly one tile-width of path.
6. Allocate a max segment pool before animation starts. For known periodic sine settings, scan one full phase cycle to estimate `maxPathLength` and allocate `maxSegmentCount = ceil(maxPathLength / effectiveWidth)`. For future functions without a known peak, grow the pool only when a newly observed length exceeds current capacity by a tolerance.
7. Toggle active segments instead of rebuilding when count changes. Keep mesh/material entries allocated up to `maxSegmentCount`; on each procedural update, set meshes above `desiredActiveSegmentCount` inactive, and reactivate them when length grows. This preserves object/material allocation stability while allowing visible tile birth/death as expected behavior.
8. Hook per-frame update into the render loop. In `apps/rivvon/src/composables/viewer/useRenderLoop.js`, after texture flow material updates and before render, call a new procedural update with `elapsedTime` unless scroll/cinematic export is driving synthetic time. Preserve existing `ribbonSeries.update(elapsedTime)` for current undulation, or sequence procedural path update first and undulation second if both are allowed.
9. Wire deterministic export. In `apps/rivvon/src/composables/viewer/useSceneExport.js`, call the same procedural update from `renderFrameAtTime(waveTime, deltaSec)` so exported videos match live playback exactly.
10. Add the Draw menu entry. In `apps/rivvon/src/components/viewer/BottomToolbar.vue`, add a `Sine Wave` item to `drawLauncherItems`, probably with the existing `airwave` or `line_curve` Material Symbol already loaded in `apps/rivvon/src/main.js`. Emit a one-shot `request-create-sine-wave` event following the existing `request-*` convention.
11. Handle the event in `apps/rivvon/src/views/RibbonView.vue`. Add a handler similar to text/emoji/contour generation, but route to `threeCanvasRef.value.createProceduralRibbon(...)` instead of `createDrawingAndAutosave()`. Keep it out of cloud/local drawing autosave. Procedural sources should not become saved drawings.
12. Expose controls only after the base feature works. Add optional controls for amplitude/frequency/speed/width/sample count in an existing tools/geometry/animation panel pattern. Changing amplitude/frequency/domain can require growing or recomputing the max pool; changing phase speed should not.
13. Performance and safeguards. Avoid per-count-change rebuilds by toggling pooled segment visibility/activity. Reuse arrays/scratch vectors where possible. Clamp sample count and frequency to avoid self-intersection/oversampling spikes. Keep helix/spherical projection support disabled for initial version unless tested.

**Relevant files**

- `apps/rivvon/src/modules/viewer/ribbon.js` — `calculatePathLength()`, `buildSegmentedRibbon()`, cached frame data, and `updateWaveAnimation()` are the core geometry references.
- `apps/rivvon/src/modules/viewer/ribbonSeries.js` — `buildFromMultiplePaths()`, `setSegmentOffset()`, `update()`, and `rebuildUpdate()` show how segment continuity and material assignment work today.
- `apps/rivvon/src/composables/viewer/useRibbonBuilder.js` — add procedural creation and bridge it through `useThreeSetup()` / `ThreeCanvas`.
- `apps/rivvon/src/composables/viewer/useRenderLoop.js` — live per-frame procedural path update hook.
- `apps/rivvon/src/composables/viewer/useSceneExport.js` — deterministic export update hook.
- `apps/rivvon/src/components/viewer/BottomToolbar.vue` — add the Draw launcher `Sine Wave` action.
- `apps/rivvon/src/views/RibbonView.vue` — handle the new request event and decide whether it is a transient viewer source or a saved drawing-like artifact.
- `apps/rivvon/src/stores/viewerStore.js` — procedural path mode/settings if settings need reactive UI state.
- `apps/rivvon/src/main.js` — confirm/load the Material Symbol used by the menu item.

**Verification**

1. Run the frontend dev server with `pnpm dev:rivvon` and create a sine ribbon from the Draw menu.
2. With flow enabled, verify tiles flow along the moving plot while active segment count follows current path length.
3. Log or inspect current path length, peak path length, max pooled segment count, active segment count, inactive pooled segment count, `flowOffset`, and `tileFlowOffset`.
4. Test sine windows with integer-period and non-integer-period domains; include a deliberately extreme modulated sine cycle where amplitude and/or frequency moves between near-flat and high-detail states. Use this to target a 3-to-20-to-3 active tile swing and confirm the short phase shows about 3 active tiles while the long phase shows about 20.
5. Change amplitude/frequency settings and confirm the max pool grows or recomputes only when settings or observed peaks require it; routine count changes should only toggle active segments.
6. Check interactions with flow forward/backward/off, undulation on/off, and texture changes via `rebuildRibbonsWithNewTextures()`.
7. Export a short video and confirm live playback and exported animation match timing.
8. Use browser performance tools or the existing viewer perf overlay to compare frame time before/after, especially `ribbonUpdateMs` and wrap stats.

**Decisions**

- Recommended MVP scope: one transient `Sine Wave` source from the Draw menu, fixed settings or minimal settings, deterministic live/export animation, dynamic tile density, and max-pooled segment toggling.
- Excluded from MVP: autosaving procedural sources, general arbitrary function editor, user-authored formulas, polished cross-faded segment add/remove, helix/spherical projection guarantees, and cloud API/schema changes.
- Continuity decision: do not implement fixed-capacity stretching as a user-facing mode. Current path length should determine active tile count.
- Texture mapping recommendation: preserve one tile per active segment. Segment birth/death at the boundary is accepted as the expected behavior because it protects texture scale.

**Further Considerations**

1. UX persistence: transient viewer effect is lowest risk; saved procedural drawings need a schema for `source.type = sineWave` plus settings and deterministic replay.
2. Motion semantics: path phase motion and texture flow can both move; decide whether Sine Wave defaults to texture flow on, path motion on, or one of them disabled to avoid a visually confusing double-motion default.
3. Continuity quality: start with direct active/inactive segment toggles. Add fade-managed boundary segments only if raw tile birth/death feels wrong in practice; fixed-capacity stretching is no longer part of the plan.
