# Grid repeat: feasibility and implementation plan

Status: implemented on 2026-10-26. The sections below retain the design rationale and investigation findings.

Implementation notes:

- Geometry now includes Grid Repeat, integer Rows/Columns sliders (1–12, initially 3), and Checkerboard. Slider changes build on release, bar click, or keyboard completion.
- Repeat runs before projection and preserves original source paths, SVG nodes, closure, and manual latitude choices. Presets store the recipe with the source artwork.
- Expanded geometry is limited to 2,048 paths, 250,000 sampled points, 2,048 estimated meshes, and 300,000 estimated vertices. Tube/helix complexity counts against the same budget. These are conservative work limits, not a frame-rate guarantee.
- Static paths are supported; live procedural geometry bypasses repeat. Grid growth preserves motif size and the current camera position; zoom out to frame larger grids. The existing Reset View returns the camera to its initial position.
- Verification: 393 viewer tests and 68 API tests passed, including 10 API preset tests; the production viewer build succeeded. Browser checks covered keyboard sliders, checkerboard, spherical projection, rejected-grid rollback, and the 390px-wide controls. Build output retains dependency `eval` and large-chunk warnings.

## Feasibility

This fits the existing path-based renderer. Add a planar path transformation before spherical projection, then let the existing ribbon/tube, helix, texture, and animation code consume the resulting paths. No new rendering backend or general operation-stack framework is required for the first version.

The strongest existing integration points are:

- `src/modules/viewer/ribbonSeries.js`, `_resolveGeometryPaths()`: clones source paths, optionally samples SVG nodes, and optionally projects the resulting paths onto a sphere.
- `RibbonSeries.sourcePathsPoints` versus `lastPathsPoints`: already separates original artwork from derived geometry. `rebuildUpdate()` rebuilds from the original source.
- `src/composables/viewer/useRibbonBuilder.js`: funnels static single paths, multiple paths, and drawings through `RibbonSeries`, and rebuilds from original paths when textures change.
- `src/stores/viewerStore.js`, `helixOptions`, and the watcher in `ThreeCanvas.vue`: already carry geometry settings into rebuilds despite their helix-specific names.
- `src/components/viewer/GeometrySettingsControls.vue`: the existing Geometry controls, with PrimeVue Slider and ToggleSwitch already imported.
- `packages/shared-types/src/scenePreset.js`: shared client/server artwork settings validation. Scene capture already saves original source paths separately from settings.

## Proposed first-version behavior

| Control | Proposed behavior |
| --- | --- |
| Grid Repeat | Off by default. Enabling repeats the complete input artwork as one motif. |
| Columns | Integer slider, step 1, proposed range 1–12; default 3. |
| Rows | Integer slider, step 1, proposed range 1–12; default 3. |
| Checkerboard | Off by default. When on, horizontally mirror cells where `(row + column) % 2 === 1`. |

Slider limits are a proposed product range, not a promise that every input can render 144 copies. Apply an additional complexity budget before mesh construction.

Use top-to-bottom, left-to-right cell order, retaining the source path order inside each cell. For a 3×3 grid, the checkerboard orientations are:

```text
normal   mirrored normal
mirrored normal   mirrored
normal   mirrored normal
```

Mirror the entire motif about its horizontal center coordinate (a left/right reflection), rather than mirroring each constituent path about its own bounds. Preserve point order and Z coordinates. Copies remain independent paths; do not join endpoints between cells.

Preserve motif size and ribbon width: adding rows or columns grows the grid around the original artwork center. An enabled 1×1 grid is geometrically identical to the source. Disabling restores the original geometry immediately and retains the chosen counts for re-enabling.

For initial cell spacing, use aggregate planar path bounds plus one base ribbon width of total gutter on each axis. This supplies a deterministic default without adding spacing controls. Use `series.lastWidth`, before the user’s width multiplier, so changing ribbon width does not rearrange cell positions. Treat the positive base width as the minimum pitch for a zero-width/height motif. This is a proposed spacing policy; very wide surfaces, helices, and animation may still overlap adjacent cells. Do not promise collision avoidance.

Support static imported SVG/vector outlines, text/emoji paths, and drawn paths through the common static-path entry point. Disable Grid Repeat for active procedural sources, including clock, sine wave, and Möbius: those have separate animated/pool-based builds that bypass `_resolveGeometryPaths()`. Retain settings while they are inactive, and enforce the same bypass in code, not only in the UI. Repeating live procedural geometry is a later extension.

The existing renderer treats vector input as paths rendered with ribbon/tube surfaces. This feature repeats that representation; filled SVG regions, clipping, and Boolean union are outside this version.

## Geometry contract and ordering

```text
Original source paths / SVG nodes
    → existing SVG interpretation and optional smoothing
    → grid repeat and checkerboard reflection
    → optional sampling needed for projection
    → spherical projection of the entire grid
    → existing surface construction, helix, and animation
    → existing texture assignment and rendering
```

This is a fixed composition order, independent of which toggle the user switches on first. Future path transformations should consume the derived paths at their defined stage. Arbitrary user-reorderable operations are separate work.

Introduce a pure helper, `src/modules/viewer/gridRepeat.js`, that accepts path descriptors and normalized settings. A descriptor should keep `points`, optional `splineNodes`, `closed`, and source-path identity together; avoid maintaining several parallel arrays through replication. Return copied descriptors plus grid bounds/aspect metadata. Generate sampled source curves once, then transform copies rather than sampling the same SVG once per cell.

For source bounds center `(cx, cy)`, pitches `(px, py)`, row `r`, column `c`, and counts `(R, C)`:

```text
dx = (c - (C - 1) / 2) * px
dy = ((R - 1) / 2 - r) * py
s  = checkerboard && ((r + c) % 2 === 1) ? -1 : 1
x' = cx + s * (x - cx) + dx
y' = y + dy
z' = z
```

Apply the identical affine transform to authored spline nodes. Without projection, ribbons use `splineNodes` preferentially, so transforming only sampled points would leave smooth SVG copies at the original position. Duplicate closure metadata for every copy. Preserve the current rule that projected curves use dense projected points rather than unprojected spline nodes.

Keep `sourcePathsPoints` and `series.svgNodes` original and immutable through every rebuild. Set `lastPathsPoints` to the final derived paths. Never feed an already repeated/projected array back through grid repeat during texture changes, count changes, or preset restoration.

## Spherical projection integration

Call `projectPathsToSphere()` once with all repeated paths. Its existing aggregate bounds then map the grid around one shared sphere. The existing automatic radius follows total grid width and the horizontal wrap angle; increasing columns will generally increase sphere radius when motif size is preserved.

Update automatic vertical coverage from the repeated geometry’s actual height/width ratio. Today the builder initializes that ratio only when source artwork is created, and the store subsequently passes explicit latitude bounds into projection. Simply inserting repeated points would leave the vertical range based on the unrepeated artwork.

Add an aspect-update action that preserves `sphericalProjectionVerticalWrapAuto`. In auto mode, recalculate latitude bounds when repeat settings or SVG interpretation change; in manual mode, retain the user’s latitude bounds. Do not reuse `resetSphericalProjectionVerticalWrapForArtwork()` for every repeat change: it forces auto mode back on. Resolve the bounds before the rebuild and batch the state update to avoid a watcher/rebuild loop. During preset restoration, derive the effective aspect from saved source plus repeat settings before the first build, while preserving saved manual bounds.

Projection needs adequate input sampling. The current projector maps existing vertices; a two-point horizontal path spanning 360° can map both endpoints to the same location. Include an angular-step-based sampling check before projection for sparse paths, preserving the existing source-curve interpretation. Account for generated samples in the complexity budget. Test long straight paths, closed curves, 360° longitude, and latitude extremes.

Spherical mapping naturally compresses motifs near the poles. A continuous checkerboard around a 360° longitude seam requires an even column count; odd counts remain valid but break alternation at that seam. A mirrored motif also need not have matching opposite edges. This feature wraps the pattern; it does not guarantee seamless joins or weld separate paths.

## Settings, UI, and saved scenes

Add `gridRepeatEnabled`, `gridRepeatColumns`, `gridRepeatRows`, and `gridRepeatCheckerboard` to:

1. Viewer store state, normalization/actions, geometry option getter, default reset, Tools snapshot, and change detection.
2. `ARTWORK_DEFAULTS`, numeric ranges, and integer validation in the shared scene-preset contract. Reject non-finite, fractional, or out-of-range saved counts.
3. Geometry rebuild handling and source-availability handling. Rebuild only when the effective setting changes; dormant row/column/checkerboard changes should not rebuild while disabled.

Treat these as artwork settings. Save the original motif plus repeat parameters, rather than expanded geometry, so preset size does not grow with cell count and remains within the current source limits of 2,048 paths / 100,000 points. Existing scene capture and restore should largely work once the allowlist includes the new fields; verify both successful restoration and rollback.

Defaults allow existing version-1 presets to load with repeat off. Update the shared validator on the API and client together: an older API silently discards unrecognized artwork fields. No database migration is expected, because the recipe lives in the existing scene JSON. Older clients also cannot reproduce the new effect; use the repository’s existing compatibility policy for additive artwork settings.

Place Grid Repeat after SVG interpretation and before Spherical Projection in the Geometry panel. Use PrimeVue ToggleSwitch and integer Slider controls with persistent numeric values, associated labels/IDs, keyboard support, and an accessible explanation for unavailable procedural inputs. Reuse the existing panel layout and shared styles from `DESIGN.md`; retain the parent scroll region. Add any new Material Symbols name to `loadMaterialSymbols([...])` in `src/main.js`, or use labels without a new icon.

Preserve existing texture continuity and round-robin assignment across the expanded path list. The checkerboard control reflects path geometry; it does not add an independent texture-flip rule. Identical texture assignment/phase per cell would be an additional feature. Verify mirrored paths with texture-orientation normalization, path alignment, caps, tube mode, and helix enabled.

Invalidate automatically generated cinematic camera points after effective grid changes; preserve manually authored camera points using the existing `invalidateAutoROIs()` API. Update artwork bounds/pivot through the normal series build. Keep the current camera position while adjusting sliders; users can zoom out to frame the larger grid.

## Performance and rebuild policy

Path count scales as `sourcePathCount × rows × columns`. Mesh count is more significant than that number alone: each ribbon is split into texture-length segments, normally with 50 subdivisions per segment. Tube sides and helix strands/sample density increase vertex work, and undulation updates vertex positions on the CPU.

A one-sample synthetic Node probe used the current renderer with reflected copies, base width 0.3, and undulation enabled:

| Motif | Grid | Paths | Meshes | Build | One animation update |
| --- | --- | ---: | ---: | ---: | ---: |
| One sampled wave path | 1×1 | 1 | 20 | 16 ms | 2.0 ms |
| One sampled wave path | 4×4 | 16 | 320 | 97 ms | 9.5 ms |
| One sampled wave path | 8×8 | 64 | 1,280 | 330 ms | 17.9 ms |
| Twelve shorter wave paths | 1×1 | 12 | 72 | 14 ms | 0.9 ms |
| Twelve shorter wave paths | 4×4 | 192 | 1,152 | 235 ms | 21.7 ms |
| Twelve shorter wave paths | 8×8 | 768 | 4,608 | 1,037 ms | 62.5 ms |

These are feasibility observations, not browser benchmarks: no GPU drawing, texture uploads, or flow-material initialization was included; timings include JIT/order effects and tests ran concurrently. A separate 2×3 checkerboard probe produced six paths on one shared sphere with maximum radius error below `5e-16`, without modifying the original input.

For the first implementation:

- Commit expensive slider rebuilds on interaction completion, including keyboard changes; update displayed numbers during dragging. Route this through the geometry watcher so it does not independently rebuild on every raw slider event. Debounced live previews can follow after browser profiling.
- Preflight the candidate geometry before disposing the current meshes. Bound derived path/sample counts and estimated mesh/vertex work, accounting for tube sides, helix, and projection resampling. Use shared validation for portable count limits and runtime checks for renderer cost. Reject excessive candidates with the existing feedback pattern and retain the last working grid. Calibrate actual budgets with browser measurements before release; a row/column cap alone is inadequate.
- Yield so the existing loading overlay can render before an expensive accepted build. Coalesce pending changes, and guard against stale completion if builds become asynchronous.
- Reuse TileManagers and texture resources; do not duplicate texture uploads per cell. Verify geometry and material cleanup across repeated changes.

GPU instancing is not a prerequisite. Separate cells under nonlinear projection have different geometry, so instancing the existing motif meshes is insufficient. Shared geometry/shader deformation or batched rendering can be considered if profiling shows the supported first-version grid sizes remain too costly.

## Implementation sequence

1. **Pure transformation and metadata:** implement settings normalization and descriptor-based grid generation; test centering, group reflection, stable ordering, zero-extent inputs, closure, nodes, and source immutability.
2. **Pipeline integration:** insert repeat before projection; synchronize effective aspect and auto/manual latitude behavior; add sparse-path projection sampling and preserve rebuild source data. Wire rebuild coalescing and preflight limits before exposing high counts.
3. **Controls and persistence:** add store state/actions, Geometry controls, default reset/change tracking, shared preset validation, and API/client compatibility coverage. Disable effective repeat for procedural sources in both UI and build logic.
4. **End-to-end validation:** confirm count changes, checkerboard toggling, projection changes in either toggle order, texture replacement, preset save/load/rollback, export, and camera behavior. Profile desktop and narrow/mobile layouts with actual rendering and flow enabled, then set release limits.

## Verification and completion criteria

- With repeat off, existing geometry and old presets remain unchanged. Enabled 1×1 is an exact geometry no-op.
- An asymmetric multi-path motif appears exactly `rows × columns` times; checkerboard alternates horizontally reflected orientation along both axes, without changing source data or connecting paths.
- Repeated SVG smooth-node paths render in their own cells; every closed copy retains its seam and cap behavior, before and after projection.
- A 2×3 grid projects onto one shared sphere, with automatic latitude based on grid aspect. Manual latitude choices survive count changes. Sparse paths remain meaningful at 360°.
- Rebuilds after texture changes and multiple toggle cycles do not multiply copies or project twice. Geometry cleanup remains stable.
- Presets retain the original motif and four repeat settings. Older presets default off; malformed counts are rejected; restoration and rollback preserve repeat/projection settings.
- Browser verification covers flat ribbon, tube, helix, undulation, flow, normalized textures, path alignment, and export. Procedural modes remain unchanged.
- Sliders and toggles work with keyboard input and narrow panels. Over-budget requests retain the prior working result and provide clear feedback. Final budgets are supported by browser profiling.

Relevant existing suites: `sphericalProjection.test.js`, `svgNodes.test.js`, `useRibbonBuilder.svgNodes.test.js`, `useScenePreset.test.js`, and `modules/shared/scenePreset.test.js`. All five passed during investigation: **37 tests passed**. Add focused grid tests and extend these lifecycle/persistence suites; include API preset round-trip coverage in `apps/api/routes/presets.test.js`.
