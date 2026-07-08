# Normalize Texture Orientation

## Overview

Normalize Texture Orientation keeps texture content mapped to a consistent side of each ribbon within a ribbon series.

The feature is exposed in the viewer texture tools as `Normalize Orientation` and is enabled by default through the `normalizeTextureOrientation` viewer preference.

It is intended for texture sets with meaningful cross-ribbon orientation, such as a sampled scene where one side of the tile contains sky and the other side contains ground. Without normalization, two ribbons can display the same texture with sky/ground on opposite sides even when the artwork should read as one coherent scene.

## Problem

Ribbons are generated from user paths. Each ribbon has:

- `U`: the along-ribbon texture axis
- `V`: the across-ribbon texture axis

The `V` axis determines which side of the ribbon shows the top or bottom of a texture tile.

For simple strokes, the issue may look like a stroke-direction problem: one line was drawn left-to-right and another right-to-left, so their textures appear opposed. But for curved or radial artwork, such as flower-petal paths, start/end direction is not a reliable signal. A petal can have a start/end chord that points in one global direction while its visible ribbon side points differently through the curve.

The feature therefore normalizes the rendered ribbon frame, not the drawn path direction.

## Design Rationale

Earlier approaches were rejected because they coupled normalization to the wrong axis.

### Reversing Stroke Or Tile Order

Reversing the local tile order or mirroring the along-ribbon `U` axis can make two opposing straight strokes read similarly, but it also changes the tile sequence.

That is risky because seamless textures depend on segment order:

```text
tile 0 -> tile 1 -> tile 2 -> ...
```

Changing that order can introduce visible seams or make organic tile runs appear to jump.

Normalize Texture Orientation currently does not reverse tile order and does not add an orientation-driven `U` mirror. Existing layout features such as `Mirror Tiles` remain responsible for along-ribbon tile sequencing.

### Start/End Direction Tests

A global start/end test, such as:

```js
flip = dot(pathEnd - pathStart, dominantSceneAxis) < 0
```

works only when all paths are roughly parallel. It fails for radial, looped, or petal-like artwork because there is no single global X/Y direction that describes the desired visual side of every ribbon.

### Frame-Based V-Axis Normalization

The current implementation samples the actual ribbon frame. This matches the geometry that will be rendered.

The decision asks:

```text
Does this ribbon's texture-V direction mostly point toward the stable artwork-facing side?
```

If not, the material flips only the `V` sample axis for that ribbon.

## Implementation

### State And UI

The persisted viewer preference is:

```js
normalizeTextureOrientation: true
```

Primary code paths:

- `stores/viewerStore.js`
  - owns `normalizeTextureOrientation`
  - persists it to viewer preferences
- `components/viewer/TextureSettingsControls.vue`
  - shows `Normalize Orientation`
  - places it before `Mirror Tiles`
- `components/viewer/ThreeCanvas.vue`
  - watches the store value
- `composables/viewer/useRibbonBuilder.js`
  - forwards changes to the live `RibbonSeries`

### Orientation Decision

`ribbonSeries.js` computes one boolean per ribbon path.

The constants are:

```js
const TEXTURE_ORIENTATION_SAMPLE_COUNT = 9;
const ARTWORK_FACING_NORMAL = new Vector3(0, 0, 1);
```

For flat drawings, paths are built in the XY plane and the default camera views them from +Z. `ARTWORK_FACING_NORMAL` is therefore a stable artwork-facing reference, rather than a value that changes as the orbit camera moves.

For each path:

1. Build a temporary `Ribbon` probe.
2. Use the same `createCurveFromPoints()` and `createFrameSamples()` path as the renderer.
3. Sample nine frames along the curve.
4. Accumulate the dot product between each frame's width direction and `ARTWORK_FACING_NORMAL`.
5. Flip the ribbon's texture `V` axis if the score is negative.

Conceptually:

```js
score += frame.widthDirection.dot(ARTWORK_FACING_NORMAL);
mirrorV = score < 0;
```

This decision is frame-aware. It works for straight strokes, loops, and radial artwork because it evaluates the actual rendered ribbon orientation instead of a start/end chord.

### Material Sampling

Each `Ribbon` stores:

```js
textureOrientationMirrorY
```

When `RibbonSeries.initFlowMaterials()` assigns segment materials, it passes:

```js
{ orientationMirrorY: ribbon.textureOrientationMirrorY }
```

`tileManager.js` resolves that option into `uMirrorY` for both static and flow materials.

The shader composes it with the existing global vertical flip:

```glsl
bool mirrorV = (uFlipVertical == 1) != (uMirrorY == 1);
float sampleV = mirrorV ? (1.0 - vUv.y) : vUv.y;
```

This keeps `Normalize Orientation` independent from, but compatible with, the existing `Flip Vertically` control.

### Interaction With Mirror Tiles And Flow

Normalize Texture Orientation affects only the `V` sample axis.

It does not:

- change `segmentOffset`
- reverse local tile order
- change `tileFlowOffset`
- alter `Mirror Tiles` repeat-cycle resolution
- alter flow pair selection

For flow materials, `uMirrorY` is included in the material cache key so a segment with a normalized V flip cannot accidentally reuse a material built for an unflipped segment.

## Current Scope

The current reference normal is intentionally stable and artwork-relative:

```js
ARTWORK_FACING_NORMAL = +Z
```

This matches the normal flat-ribbon drawing pipeline, where 2D artwork lives in the XY plane.

If future work introduces more fully 3D authoring modes, camera-dependent orientation, or spherical projection-specific texture semantics, the reference normal may need to become configurable per geometry mode. For now, the feature is designed to solve consistency for flat 2D artwork rendered as ribbon geometry.

## Regression Guardrails

- Do not base normalization on path start/end direction.
- Do not reverse tile order to solve cross-ribbon orientation.
- Do not use the live orbit camera position as the reference normal unless texture popping during camera movement is explicitly acceptable.
- Keep `Mirror Tiles` responsible for along-ribbon U mirroring.
- Keep Normalize Texture Orientation limited to per-ribbon V-axis sampling unless there is a new requirement for U-axis normalization.
