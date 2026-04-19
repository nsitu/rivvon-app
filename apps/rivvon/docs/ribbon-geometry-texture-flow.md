# Ribbon Geometry, Texture Layout & Flow

## Overview

Rivvon renders ribbons as discrete mesh segments laid out along a smooth spline. Each segment maps one texture tile across its full U range. Seamless tiling comes from modular segment indexing, while conveyor-style motion comes from dual-texture flow materials that shift the sampled U coordinate. The old gap system is no longer part of the renderer.

---

## 1. Geometry Pipeline

### Path -> Curve -> Segments -> Meshes

```
User draws strokes (polyline points)
        |
        v
CatmullRomCurve3 (centripetal, arc-length-uniform)
        |
        v
Divide total arc length into N segments   (N = ceil(pathLength / ribbonWidth))
        |
        v
For each segment: sample points, generate ribbon vertices, build geometry
        |
        v
Assign material and add the mesh to the scene
```

### Curve Construction (`ribbon.js -> createCurveFromPoints`)

Input polylines are converted to a centripetal `CatmullRomCurve3`. The wrapper uses `getPointAt()` and `getTangentAt()` so sampling stays arc-length-uniform: equal `t` intervals correspond to equal physical distances along the path.

### Rotation-Minimizing Frames

`createFrameSamples()` precomputes tangent, normal, and binormal data with the Double Reflection method. This keeps helix strands stable and avoids visible twist jumps along curved paths.

### Segment Decomposition

```
segmentCount = ceil(totalPathLength / ribbonWidth)
```

Each segment spans a `[startT, endT]` interval on the curve. Segment length is tied to ribbon width so each tile appears roughly square when mapped onto the ribbon.

### Per-Segment Vertex Generation

For each segment, Rivvon samples a strip of points and generates left/right edge vertices.

Standard ribbon mode:

```
wavePhase = sin(arcLength * frequency + time * speed) * amplitude
animatedNormal = normal rotated by wavePhase around tangent
left  = point - (width / 2) * animatedNormal
right = point + (width / 2) * animatedNormal
```

Helix mode:

```
helixAngle = globalT * pitch * 2pi + strandOffset
animatedAngle = helixAngle + wavePhase
helixCenter = point + cos(angle) * radius * normal + sin(angle) * radius * binormal
acrossDir = tangent x radialDir
left  = helixCenter - (strandWidth / 2) * acrossDir
right = helixCenter + (strandWidth / 2) * acrossDir
```

### UV Mapping

Each segment maps exactly one tile across its U range:

```
U = localT   (0 at segment start -> 1 at segment end)
V = 0 (left edge) to 1 (right edge)
```

This 1:1 segment-to-tile mapping is the core constraint that ties geometry to texture management.

### End Caps

The first and last segments can use SVG-driven cap profiles instead of the standard strip geometry. Current cap styles are square, rounded, pointed, and swallowtail. Profile caps still preserve the same per-segment U mapping.

### Adaptive Corner Narrowing

Flat ribbons can now optionally narrow their body width around higher-curvature regions without changing cusp splitting. This is an experimental geometry feature intended to reduce the crunchy, self-intersecting look that can still happen at corners which fall just below the cusp threshold.

The important implementation detail is that the body is narrowed by retaining a smaller centered `V` interval from the tile, not by squeezing the full tile width into a thinner strip. That keeps the effect subtractive and mask-like, which matches the cap-profile approach more closely than a simple width scale would.

See `adaptive-corner-narrowing.md` for the full implementation note, current scope, and rollout constraints.

### Cap Profile Strategy

Cap profiles are not applied by directly projecting the triangulated SVG mesh onto the ribbon. That would preserve the 2D silhouette in parameter space, but it would let individual triangles shortcut across the ribbon's curvature and produce the wrong 3D surface on bends.

Instead, profile caps stay on the same strip-based construction model as the rest of the ribbon:

```
sample curve frames along segment U
        |
        v
slice the normalized SVG profile at those U values
        |
        v
turn each filled interval into a curved quad strip
        |
        v
map those quads through the ribbon frame sampler
```

This is the important invariant for future work: **caps must remain strip-based so they respect ribbon curvature**.

### Strip Boundary Alignment

Uniform strip density by itself is not enough for sharp caps. If a swallowtail tip, cusp, or shoulder falls between sampled U values, the strip solver approximates it with a beveled transition even when the source SVG is correct.

To avoid that, Rivvon aligns cap strips to the profile's real feature boundaries:

- Start with the normal per-segment strip grid.
- Inject additional slice positions from the normalized SVG vertex `u` coordinates.
- Sample profile intervals exactly at those aligned slice positions.
- If a feature collapses to a single point at a slice, preserve it with a degenerate interval instead of dropping it.

This keeps the cap on curved strips while ensuring important features land on actual strip boundaries. For swallowtail, that means the outer tips and inner notch can remain sharp instead of being rounded off by an arbitrary grid.

### Regression Guardrails

- Do not replace strip-based cap generation with direct SVG triangle warping unless ribbon curvature is handled explicitly.
- When adding a new cap shape, think in terms of feature-aligned slice placement, not only higher slice counts.
- If a cap looks softened, first check whether the important SVG vertices are represented in the slice positions before increasing strip density.
- Preserve the existing U contract: full SVG width maps to the full end-segment length, full SVG height maps to the ribbon width, and the SVG right edge remains the join edge.

---

## 2. Multi-Ribbon Indexing

### Global Segment Indexing

`RibbonSeries` manages multiple `Ribbon` instances and keeps a global segment index across all of them:

```
Ribbon 0: segments 0, 1, 2, ..., 14      (segmentOffset = 0)
Ribbon 1: segments 15, 16, 17, ..., 28   (segmentOffset = 15)
Ribbon 2: segments 29, 30, 31, ..., 40   (segmentOffset = 29)
```

Each ribbon stores its `segmentOffset`, which is added to local segment indices during material assignment. This keeps texture continuity seamless across multiple drawn paths.

### Multi-Texture Round-Robin

When multiple TileManagers are loaded, `RibbonSeries` assigns them round-robin across strands:

```
Path 0 strand A -> TileManager 0
Path 0 strand B -> TileManager 1   (helix only)
Path 1 strand A -> TileManager 0
Path 1 strand B -> TileManager 1   (helix only)
...
```

In standard ribbon mode, each path's single strand gets the next TileManager in sequence.

---

## 3. Texture Assignment & Flow

### Static Seamless Tiling

Without active flow, material selection is simple modular indexing:

```
tileIndex = (globalSegmentIndex + tileFlowOffset) % tileCount
mesh.material = tileManager.getMaterial(tileIndex)
```

With 33 tiles and a 45-segment ribbon, tiles wrap as `0, 1, 2, ..., 32, 0, 1, 2, ..., 11`.

### Texture Layout Modes

Rivvon exposes a `Texture Layout` control in the viewer toolbar. This changes how segment indices are resolved into tile samples without changing ribbon geometry.

`Wrap Tiles`

```
0, 1, 2, 3, 4, 0, 1, 2, 3, 4, ...
```

This is the classic modulo layout. Once the last tile is reached, indexing wraps back to tile `0`.

`Mirror Bounce`

```
0, 1, 2, 3, 4, 4R, 3R, 2R, 1R, 0R, 0, 1, 2, 3, ...
```

`R` means the same tile is sampled with mirrored U coordinates. No extra texture data is loaded; the shader flips sampling horizontally along the ribbon direction.

Mirror Bounce is intended to reduce the hard `last -> first` seam that appears with short, organic tile sets. Instead of jumping directly from the last tile back to the first tile, the sequence walks back through mirrored samples so adjacent seams reuse matching edge content.

For example, with 5 tiles:

```
Wrap Tiles:    0, 1, 2, 3, 4, 0, 1, 2, 3, 4
Mirror Bounce: 0, 1, 2, 3, 4, 4R, 3R, 2R, 1R, 0R
```

In static mode, Mirror Bounce doubles the logical repeat cycle from `tileCount` to `2 * tileCount`, while still referencing the same underlying tile textures.

### KTX2 Array Textures

Each tile is a `DataArrayTexture` with multiple layers. A shared `uLayer` uniform advances independently of flow: ping-pong for planes and wrap-around for waves.

### Dual-Texture Conveyor Flow

When flow is active, each segment material holds two adjacent tiles and a shared `uFlowOffset`:

```
Segment N material contains:
  uTexArrayCurrent = tile[N]
  uTexArrayNext    = tile[N + 1]
  uFlowOffset      = 0.0 -> 1.0 (animated)
```

Under Mirror Bounce, `tile[N]` and `tile[N + 1]` are resolved from the full mirrored repeat cycle, and each one may carry its own horizontal mirror flag.

The fragment shader does not blend the two tiles. It shifts the sampled U coordinate and switches between the current and next tile at the moving boundary:

```glsl
float shiftedU = vUv.x + uFlowOffset;

if (shiftedU >= 1.0) {
    sampleUV = vec2(shiftedU - 1.0, vUv.y);
    outColor = textureGrad(uTexArrayNext, ...);
} else {
    sampleUV = vec2(shiftedU, vUv.y);
    outColor = textureGrad(uTexArrayCurrent, ...);
}
```

As `flowOffset` moves from 0 to 1, the boundary between the two tiles sweeps across the segment and produces continuous conveyor motion.

When Mirror Bounce is active, the shader applies the same branch logic but may mirror the U coordinate for the current sample, the next sample, or both. This keeps flow compatible with the mirrored layout instead of treating mirrored segments as a separate geometry mode.

### Tile Pair Swapping

When `flowOffset` crosses an integer boundary:

1. Compute how many whole tiles were traversed.
2. Call `tileManager.wrapFlowOffset(wholeTiles)`.
3. Rebuild segment materials with the new tile pairs.
4. Keep the wrapped fractional `flowOffset` in `[0, 1)`.

This avoids visual discontinuities while still allowing a continuous scrolling effect.

The repeat cycle used for wrapping depends on the selected texture layout:

- `Wrap Tiles` uses a cycle length of `tileCount`
- `Mirror Bounce` uses a cycle length of `2 * tileCount`

### State Variables

| Variable         | Type  | Range   | Updated                    | Purpose                                          |
| ---------------- | ----- | ------- | -------------------------- | ------------------------------------------------ |
| `flowOffset`     | float | [0, 1)  | Every frame (via `tick()`) | Fractional slide within the current tile pair    |
| `tileFlowOffset` | int   | modular | When flowOffset wraps      | Base tile pair selection for each segment        |
| `flowSpeed`      | float | +/-N    | User control               | Tiles per second; `flowOffset += flowSpeed * dt` |
| `repeatMode`     | enum  | fixed   | User control               | Chooses `wrap` or `mirrorBounce` layout          |

### Derivative Handling

The shader computes derivatives before the branch and uses `textureGrad()` on both paths. That keeps mip selection stable across the `shiftedU = 1.0` boundary and avoids visible seam artifacts on mobile GPUs.

---

## 4. Runtime Data Flow

```
Tiles are loaded into TileManager
        |
        v
RibbonSeries.initFlowMaterials()
        |
        v
Animation loop:
    tileManager.tick(dt)
    ribbonSeries.updateFlowMaterials()
    ribbonSeries.update(time)
```

`initFlowMaterials()` creates dual-texture materials when flow is active and single-texture materials when it is not.

---

## 5. Key Relationships

| Geometry concept               | Texture concept                 | Relationship                                                   |
| ------------------------------ | ------------------------------- | -------------------------------------------------------------- |
| Path arc length                | Total tiles displayed           | `segmentCount = ceil(pathLength / width)` tiles fit along path |
| One segment                    | One tile                        | Segment UV `[0,1]` maps one full tile                          |
| Segment width ~= ribbon width  | Tile aspect on ribbon           | Keeps tiles roughly square on the surface                      |
| `segmentOffset` (multi-ribbon) | Global texture index continuity | Prevents index resets between ribbons                          |
| `flowOffset` (shader uniform)  | Horizontal UV shift             | Slides texture content within fixed segment geometry           |
| `tileFlowOffset` (integer)     | Base tile pair selection        | Chooses which adjacent tile pair each segment shows            |
| `repeatMode`                   | Repeat-cycle shape              | Controls whether the cycle wraps or mirrors back through tiles |

Flow does not rebuild geometry every frame. The mesh stays fixed while shader uniforms and material pairs control what part of which tile is visible.
