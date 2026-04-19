# Adaptive Corner Narrowing

## Overview

Adaptive Corner Narrowing is an experimental flat-ribbon rendering feature that reduces the apparent ribbon width around higher-curvature regions without changing the cusp split threshold.

The goal is to address the visual case where a corner is not sharp enough to trigger cusp splitting, but is still sharp enough that the ribbon's undulation makes the interior edge feel crunchy or self-intersecting.

Instead of solving that by splitting more aggressively, this feature narrows the visible ribbon only in the problematic region.

## Key Design Choice

The narrowing is implemented as a subtractive, mask-like crop of the ribbon body rather than a uniform squeeze of the full tile width.

That distinction matters:

- A simple width-scale approach would move the edge vertices inward but still remap the surviving geometry to the full `V = 0..1` texture width.
- The current implementation keeps only a centered `V` interval from the tile and maps that reduced interval onto the surviving geometry.

This makes the feature behave more like the existing cap-profile system, where parts of the ribbon silhouette are omitted, instead of like a stretch or squash effect.

## Current Scope

Version 1 intentionally keeps the rollout narrow:

- Experimental toggle in the viewer tools: `Adaptive Corner Narrowing`
- Enabled only for flat ribbons
- Helix mode stays on the old path
- End-cap profile segments are unchanged
- Cusp splitting in `cuspSplitter.js` is unchanged

## Render Path

### 1. Curvature Metric

`ribbon.js -> createFrameSamples()` now computes a local bend metric from the rendered spline tangents.

High level flow:

```text
sample tangents along the Catmull-Rom curve
        |
        v
measure turning angle across a short lookahead window
        |
        v
smooth the resulting curvature samples with a local average
```

The metric is derived from the final curve, not the original source polyline. That keeps the narrowing aligned with the geometry that is actually rendered after smoothing and interpolation.

### 2. Width Mapping

The bend metric is mapped to a retained center interval across the ribbon width.

Conceptually:

```text
low curvature  -> retain almost all of the width
high curvature -> retain a narrower band around the centerline
```

The current implementation uses a smoothstep-based mapping with internal constants in `ribbon.js`:

- `CURVATURE_NARROWING_START_ANGLE`
- `CURVATURE_NARROWING_FULL_ANGLE`
- `CURVATURE_NARROWING_MIN_WIDTH`

The output is a retained interval:

```text
[vStart, vEnd]
```

where straight sections stay close to `[0, 1]` and sharper corners collapse toward a centered band around `0.5`.

### 3. Masked Body Segment Construction

Standard body segments are normally built as full-width strips:

```text
left edge  -> V = 0
right edge -> V = 1
```

When adaptive corner narrowing is active, body segments are instead built from the retained interval:

```text
left edge  -> V = vStart
right edge -> V = vEnd
```

This happens in `ribbon.js -> createMaskedRibbonSegmentWithCache()`.

Two things happen together:

1. The edge vertices are moved inward by converting `vStart` and `vEnd` into across-width offsets.
2. The UVs also use `vStart` and `vEnd`, so the visible texture region is cropped instead of rescaled.

That is the core reason the result reads as a mask instead of a squeeze.

## Files Involved

- `apps/rivvon/src/modules/viewer/ribbon.js`
  - curvature sampling
  - curvature-to-width mapping
  - masked body segment builder
- `apps/rivvon/src/modules/viewer/ribbonSeries.js`
  - forwards the geometry option to child ribbons
- `apps/rivvon/src/stores/viewerStore.js`
  - stores the experimental toggle
- `apps/rivvon/src/components/viewer/BottomToolbar.vue`
  - exposes the viewer-tools toggle

## What Did Not Change

This feature is meant to complement cusp splitting, not replace it.

The following behavior is unchanged:

- cusp detection thresholds
- cusp duplication and path splitting
- cap profile generation
- flow material logic
- helix strand rendering

## Tradeoffs

### Why This Was Chosen First

This approach reuses the existing strip-based ribbon construction model and fits the current renderer without introducing shader-side masking logic.

It also preserves the same conceptual model as cap profiles: the ribbon silhouette is reduced by omitting width, not by stretching a smaller mesh across the full tile domain.

### Known Limitations

- The feature currently applies only to flat body segments.
- Cap segments are still full-profile segments; they are not intersected with the curvature-derived width interval in v1.
- The constants are internal for now, so tuning still requires code edits.
- Very short single-segment ribbons do not yet get a dedicated interval-based treatment beyond the existing cap taper logic.

## Future Directions

If the current implementation works well visually, the next steps are likely:

1. Tune the curvature thresholds and minimum retained width against real problem corners.
2. Extend the same interval-crop logic to cap-adjacent or single-segment cases.
3. Decide later whether helix mode should get its own version of the effect.

If the geometry-based version proves too expensive or too limited, a later shader-mask phase could preserve the same curvature metric while hiding edge pixels in the material instead of rebuilding narrower body segments.
