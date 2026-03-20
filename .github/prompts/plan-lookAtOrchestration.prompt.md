# Plan: Look-At Orchestration — Eliminating Gaze-Path Cusps

## Problem Statement

The gaze trace (camera line-of-sight intersection with the artwork bounding box) reveals **cusp-like discontinuities** where the camera's viewing direction changes abruptly. These coincide with transitions between ROIs and are particularly problematic when the camera is travelling at higher speed.

The cusps appear as sharp reversals or kinks in the magenta gaze trace line on the debug overlay's 3D minimap.

## Root Cause

Both `_positionSpline` and `_targetSpline` are evaluated at the **same arc-length parameter `u`**:

```js
const pos = this._positionSpline.getPointAt(u);
const target = this._targetSpline.getPointAt(u);
```

This means the look-at target "arrives" at the next ROI's look-at point at exactly the same rate as the camera arrives at the next ROI's position. The look-at direction has **no independent timing** — it is rigidly coupled to the camera's positional progression.

When the camera transitions between two ROIs with very different look-at directions, the target sweeps through an interpolated path that can create abrupt angular changes in the gaze direction — especially mid-transit where speed is highest.

## Key Insight: Two Phases of Look-At Behaviour

The look-at transition between ROIs is not a single uniform blend. It has two distinct phases with different goals:

### Phase 1: Departure (Look-at Leads)

When leaving a dwell region, the look-at should **lead** the camera — shifting toward the next ROI's look-at target _before_ the camera begins accelerating. This gives the viewer a sense of anticipation: the gaze turns first, then the body follows.

- **Timing**: Begins while the camera is still near the current ROI (within the dwell radius)
- **Target**: The _next ROI's look-at target_ (the point we will look at when we arrive)
- **Character**: Gradual, anticipatory rotation

### Phase 2: Arrival (Converge to Destination Viewpoint)

After the camera has begun transiting toward the next ROI and is approaching it, the look-at should shift again — but this time not toward the destination _point_, but toward **the viewpoint we expect to have at that destination**. That is, the look-at converges to where we'd be looking _from_ the next ROI's camera position.

- **Timing**: Begins during the second half of the transit, as the camera approaches the next dwell radius
- **Target**: The next ROI's look-at target as seen from the next ROI's camera position (the "arriving viewpoint")
- **Character**: Settling, stabilising — the view should feel composed as dwell begins

### The Distinction

The departure phase asks: _"Where should I look as I prepare to leave?"_ → Look toward where we're going.

The arrival phase asks: _"What view should I have when I get there?"_ → Look as we would from the destination.

These are subtly different. In departure, the look-at pulls toward a distant target. In arrival, it aligns with a specific viewing angle. A naive single-blend between targets conflates these two goals and produces cusps at the transition point between them.

## Current Architecture (for reference)

```
cinematicCamera.js
├── _positionSpline   CatmullRomCurve3 (closed, centripetal) through ROI camera positions
├── _targetSpline     CatmullRomCurve3 (closed, centripetal) through ROI look-at targets
├── _speedAt(u)       Speed ∈ [0.08, 1.0] via smoothstep proximity to ROI arc positions
├── _lookupTimeToArc  Float32Array[1000] mapping wall-clock time → arc-length u
├── _applyCamera(t)   Evaluates both splines at same u, applies to camera
└── _roiArcPositions  Arc-length u ∈ [0,1] for each ROI on the position spline
```

Both splines share the same `u` parameter derived from the position spline's arc-length. The speed profile only affects _how fast_ `u` advances — it doesn't decouple the two splines.

## Implementation Approach Candidates

### A. Phase-Shifted Target Parameter

Introduce a function `uTarget = f(uPosition)` that maps the position's arc-length to a phase-shifted value for the target spline. The target would "lead" by some fraction of the dwell radius on departure, and "settle" by arriving early on approach.

- **Pro**: Minimal structural change — still uses both CatmullRom splines
- **Con**: A single phase shift may not capture the two-phase nature well; both departure-lead and arrival-settle need different offsets

### B. Per-Segment Target Blending

Instead of a single target spline, compute the target at each `u` as a **weighted blend** between the current ROI's target and the next ROI's target, with the blend timing decoupled from the position progression.

- Define a `targetBlend(u)` function that returns a blend factor ∈ [0, 1]
- The blend would start earlier than the position transition (departure lead) and complete earlier (arrival settle)
- Target = `lerp(currentROI.target, nextROI.target, targetBlend(u))`

- **Pro**: Directly encodes the two-phase model; each phase can have its own easing curve
- **Con**: Loses the smooth interpolation quality of CatmullRom for the target path; may need additional smoothing

### C. Separate Target Speed Profile

Give the target spline its own speed profile that is **offset** relative to the position's speed profile. The target would accelerate and decelerate at different times than the camera position.

- The target's "dwell regions" would be shifted earlier in arc-length space
- This means the target transitions between ROIs _before_ the camera does

- **Pro**: Keeps both CatmullRom splines; the offset is conceptually clean
- **Con**: The target spline's arc-length parameterisation is independent of the position spline's — the "phase lead" is in a different arc-length space, which may make the offset hard to calibrate

### D. Hybrid: Per-Segment Blend with Smoothing

Combine approach B with a short Hermite or cubic interpolation for the target direction to eliminate any remaining discontinuity at segment boundaries.

- Compute departure and arrival targets per segment
- Use a smooth (C¹-continuous) blending curve between them
- Apply a direction-space smoothing filter to the final target trajectory

## Open Questions

1. **How much lead time** should the departure phase have? (Fraction of dwell radius? Fixed arc-length offset?)
2. **Should the arrival phase target be different from the departure target?** (They're the same _point_ — the next ROI's target — but the _intent_ differs: pulling-toward vs. settling-into)
3. **How to handle the 1-ROI and 2-ROI edge cases?** (Currently use synthetic orbits)
4. **Should micro-motion be phase-aware?** (Reduce micro-motion amplitude during fast transit to avoid compounding the visual noise)
5. **Validation**: How to verify cusp elimination quantitatively? (Gaze trace curvature analysis? Angular velocity of look-direction?)

## Next Steps

- [x] Choose an implementation approach (A, B, C, or D) — **Hybrid A+D**: per-segment variable phase shift on the CatmullRom target spline
- [x] Define the blending/offset parameters precisely — `f(p) = p + α·p·(1−p)²` with `α = 1.5` (TARGET_LEAD_ALPHA)
- [x] Implement the decoupled target evaluation in `_applyCamera()` — via `_computeTargetAt(u)`
- [x] Update `getTelemetryAtU()` to use the new target evaluation (for gaze trace)
- [ ] Test with both auto-generated and manually-captured ROIs
- [ ] Verify cusp elimination on the debug overlay's gaze trace
