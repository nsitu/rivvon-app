# Ribbon Geometry, Texture Layout & Gap Architecture

## Overview

Rivvon renders animated ribbons by dividing user-drawn paths into discrete **mesh segments**, each textured with one tile from a KTX2 tile set. A dual-texture shader enables smooth conveyor-belt flow animation by blending adjacent tiles per-fragment. The gap system introduces transparent spacing between repeating tile sets using per-fragment virtual-cycle math inside the same shader.

---

## 1. Ribbon Geometry Pipeline

### Path → Curve → Segments → Meshes

```
User draws strokes (polyline points)
        │
        ▼
CatmullRomCurve3 (centripetal, arc-length-uniform)
        │
        ▼
Divide total arc length into N segments   (N = ceil(pathLength / ribbonWidth))
        │
        ▼
For each segment: sample ~50 points, generate 2 vertices per point (left + right edge)
        │
        ▼
Triangulate into a BufferGeometry, assign material, add Mesh to scene
```

### Curve Construction (`ribbon.js → createCurveFromPoints`)

Input polyline → `CatmullRomCurve3` with centripetal parameterization. The built-in `getPointAt()` / `getTangentAt()` methods provide **arc-length-uniform sampling**, ensuring equal `t` intervals correspond to equal physical distances. This prevents texture compression at sharp corners.

### Twist-Free Frames (Double Reflection RMF)

Before building segment geometry, the entire path's normal + binormal vectors are pre-computed using the **Double Reflection method** (Wang et al. 2008). This produces rotation-minimizing frames — critical for helix mode where accumulated twist would cause visible steps.

### Segment Decomposition

```
segmentCount = ceil(totalPathLength / ribbonWidth)
```

Each segment spans a `[startT, endT]` range along the curve, where `t ∈ [0, 1]` maps uniformly to arc length. The segment width roughly equals the ribbon width, making each segment approximately square.

### Per-Segment Vertex Generation

For each of ~50 sample points within a segment:

**Flat ribbon mode:**

```
wavePhase = sin(arcLength × frequency + time × speed) × amplitude
animatedNormal = normal rotated by wavePhase around tangent
left  = point - (width/2) × animatedNormal
right = point + (width/2) × animatedNormal
```

**Helix mode:**

```
helixAngle = globalT × pitch × 2π + strandOffset   (0 for A, π for B)
animatedAngle = helixAngle + wavePhase
helixCenter = point + cos(angle)×radius×normal + sin(angle)×radius×binormal
acrossDir = tangent × radialDir
left  = helixCenter - (strandWidth/2) × acrossDir
right = helixCenter + (strandWidth/2) × acrossDir
```

### UV Mapping

Each segment gets exactly one texture tile mapped across its full U range:

```
U = localT   (0 at segment start → 1 at segment end)
V = 0 (left edge) to 1 (right edge)
```

This 1:1 segment-to-tile mapping is the fundamental constraint that ties geometry to texture management.

### Rounded Caps (Optional)

Width tapers near ribbon endpoints using a semicircle profile: `f(t) = √(1 - (1-t)²)`. When active, V coordinates are remapped to show the visible center portion: `vMin = (1-taper)/2`, `vMax = 1 - vMin`.

---

## 2. Multi-Ribbon Architecture (RibbonSeries)

### Global Segment Indexing

`RibbonSeries` manages multiple `Ribbon` instances from separate drawn paths. It maintains a **global segment index** that counts continuously across all ribbons:

```
Ribbon 0:  segments 0, 1, 2, ..., 14      (segmentOffset = 0)
Ribbon 1:  segments 15, 16, 17, ..., 28    (segmentOffset = 15)
Ribbon 2:  segments 29, 30, 31, ..., 40    (segmentOffset = 29)
```

Each ribbon stores its `segmentOffset`, which is added to local segment indices during material assignment. This ensures textures tile seamlessly across multiple paths.

### Multi-Texture Round-Robin

When multiple TileManagers are loaded (e.g. user loads two texture sets), they are distributed **round-robin across strands**:

```
Path 0 strand A → TileManager 0
Path 0 strand B → TileManager 1   (helix only)
Path 1 strand A → TileManager 0
Path 1 strand B → TileManager 1   (helix only)
...
```

In flat ribbon mode (no helix), each path's single strand gets the next TileManager in sequence.

---

## 3. Texture Assignment: The 1:1 Segment–Tile Mapping

### Static Case (No Flow, No Gap)

```
tileIndex = (globalSegmentIndex + tileFlowOffset) % tileCount
material = tileManager.materials[tileIndex]
mesh.material = material
```

With 33 tiles and a 45-segment ribbon, tiles wrap: `0, 1, 2, ..., 32, 0, 1, 2, ..., 11`.

### KTX2 Array Textures

Each tile is a `DataArrayTexture` with multiple layers (frames). A shared `uLayer` uniform cycles through layers over time (ping-pong for planes, wrap-around for waves), producing animation independent of flow.

---

## 4. Dual-Texture Flow Animation (Conveyor Belt)

### Concept

Rather than reassigning materials every frame (which causes 1-frame glitches), each segment's shader samples **two adjacent tiles simultaneously** and uses a continuous `flowOffset` uniform to slide between them:

```
Segment N material contains:
  uTexArrayCurrent = tile[N]
  uTexArrayNext    = tile[N+1]
  uFlowOffset      = 0.0 → 1.0 (animated)
```

### Fragment Shader Logic (WebGL)

```glsl
float shiftedU = vUv.x + uFlowOffset;

if (shiftedU >= 1.0) {
    // Fragment has scrolled past current tile → sample NEXT tile
    sampleUV = vec2(shiftedU - 1.0, vUv.y);
    outColor = textureGrad(uTexArrayNext, ...);
} else {
    // Fragment still within current tile
    sampleUV = vec2(shiftedU, vUv.y);
    outColor = textureGrad(uTexArrayCurrent, ...);
}
```

As `flowOffset` increases from 0 to 1, the visual boundary between current and next tile sweeps across the segment from right to left, creating smooth horizontal scrolling.

### Tile Pair Swapping

When `flowOffset` crosses 1.0:

1. Compute whole tiles shifted: `wholeTiles = floor(flowOffset)`
2. Call `tileManager.wrapFlowOffset(wholeTiles)`:
   - `tileFlowOffset += wholeTiles` (shifts which tiles each segment references)
   - `flowOffset -= wholeTiles` (wraps back to [0, 1))
3. Recreate all materials with new tile pairs
4. No visual discontinuity: new material's "current" tile = old material's "next" tile

### State Variables

| Variable         | Type  | Range     | Updated                    | Purpose                                          |
| ---------------- | ----- | --------- | -------------------------- | ------------------------------------------------ |
| `flowOffset`     | float | [0, 1)    | Every frame (via `tick()`) | Fractional slide within current tile pair        |
| `tileFlowOffset` | int   | unbounded | When flowOffset wraps      | Which tile pair each segment references          |
| `flowSpeed`      | float | ±N        | User control               | Tiles per second; `flowOffset += flowSpeed × dt` |

### Derivative Trick (Mobile Fix)

```glsl
// Compute derivatives BEFORE branching so both code paths share
// the same mip-level selection. Without this, fragments straddling
// the shiftedU=1.0 boundary produce a ~1.0 UV jump → blurry mip
// → visible dotted-line seam on mobile GPUs.
vec2 dPdx = dFdx(shiftedUV);
vec2 dPdy = dFdy(shiftedUV);
// ... then use textureGrad(..., dPdx, dPdy) in both branches
```

---

## 5. Data Flow Summary

```
User selects texture set (browser / Slyce / Realtime Apply)
        │
        ▼
TileManager.clearAllTiles()
TileManager.addTileFromBuffer(ktx2, index) × N
        │
        ▼
RibbonSeries.initFlowMaterials()
        │
        ▼
For each mesh segment:
    TileManager.getOrCreateMaterialForSegment(index, flowActive)
        │
        ├── flowActive → createFlowMaterial(index) [dual-texture with UV shift]
        └── static    → getMaterial(index)          [single texture]
```

---

## 6. Key Relationships: Geometry ↔ Texture

| Geometry concept               | Texture concept                  | Relationship                                                   |
| ------------------------------ | -------------------------------- | -------------------------------------------------------------- |
| Path arc length                | Total tiles displayed            | `segmentCount = ceil(pathLength / width)` tiles fit along path |
| One segment                    | One tile                         | 1:1 mapping; segment UV [0,1] = one full tile                  |
| Segment width ≈ ribbon width   | Tile is roughly square on ribbon | Visual aspect ratio preserved                                  |
| `segmentOffset` (multi-ribbon) | Global texture index continuity  | Prevents index gaps between ribbons                            |
| `flowOffset` (shader uniform)  | Horizontal UV shift              | Slides texture content within segment geometry                 |
| `tileFlowOffset` (integer)     | Base tile pair selection         | Which tile pair each segment shows                             |

The geometry never changes for flow — it's always the same mesh segments. All visual effects (conveyor scrolling) are achieved through shader-level UV manipulation within fixed geometry.

> **Note:** Gap architecture (per-fragment virtual cycle with `tileSetGap`, `realtimeGapFraction`, `uGapSize` uniform) was removed. Tiles now tile seamlessly with simple modular indexing.
