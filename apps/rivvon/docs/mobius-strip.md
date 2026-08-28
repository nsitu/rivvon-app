# Möbius procedural source

Open **Draw → Procedural → Möbius**. Radius, band width, handedness, and
twist phase are editable with sliders or exact numeric values (Enter commits
a typed value). Width is capped at 1.6 times the radius to keep the surface
clear of the centre of the loop.

The source returns a sampled centreline for bounds and drawing previews, plus
an explicit closed circular geometry descriptor. `Ribbon` evaluates the circle
and its width frame analytically. The width direction rotates by one half-turn
around the loop, so the final left edge meets the first right edge. Existing
segmented meshes, double-sided materials, tile layout, and flow are retained.

Caps, tube, helix, spherical projection, corner narrowing, path-edge alignment,
and undulation are suppressed on this source without changing the user's
ordinary-ribbon preferences. Texture orientation normalization is skipped
because the band has no global facing side. Export cycle calculations exclude
the suppressed undulation. Static geometry is not rebuilt on animation ticks;
texture flow and layer cycling remain independent.

**Save Drawing** stores the normalized source parameters with the centreline
in the local drawing library. Reopening regenerates the surface from those
parameters, including after copying the drawing to cloud storage. Previews and
SVG downloads represent the centreline, not the 3D surface. Image/video export
uses the rendered surface as usual.

## Current boundary

The geometric join is closed, but texture continuity is not guaranteed. At the
join, V reverses and the final tile may be partial. Ordinary tile wrapping,
Mirror Bounce, Edge Drift, and Filmstrip can therefore reveal the join. No
seam blending or Möbius-specific conveyor mapping is applied in this version.

## Verification

`mobiusGeometry.test.js` covers normalization, analytic positions, segment
joins and reversed closure, both handedness values, phase changes, incompatible
geometry settings, static animation, flow rebinding, serialization, rebuilds,
and transitions to other drawing sources.
