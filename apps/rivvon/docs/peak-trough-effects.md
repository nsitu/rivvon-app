# Peak and trough effects

Peak and trough effects are available for textures created with wave
cross-section sampling. They use the known wave phase to identify pixels that
originated near a sampling peak or trough.

## Shared effect mask

The ribbon materials reconstruct a normalized extremity value from the tile
position, texture layer, and wave phase. The toolbar's Effect Gradient range
turns that value into a smooth mask:

- Below the gradient start, the effect is not applied.
- Between the start and end, the effect fades in.
- At the gradient end, the selected effect reaches full strength.

The mask calculation is shared by the WebGL and WebGPU material paths and is
used by both available effects.

## Transparency

Transparency multiplies the sampled texture alpha by the inverse of the
peak/trough mask. Pixels remain opaque before the gradient start and approach
zero alpha at maximum extremity.

## Blur

Blur leaves alpha unchanged and blends the sampled RGB color toward a
texture-space neighborhood blur using the same mask. The blur kernel uses the
center texel, four nearer axial samples, and four wider diagonal samples. The
Blur Amount setting controls the sample radius in source texels.

This is a single-pass, Kawase-style neighborhood kernel rather than the
scene background's low-resolution, multi-pass blur. Keeping this effect in the
ribbon material has two important properties:

1. Blur is confined to the texture and does not bleed across the ribbon
   silhouette into the scene background.
2. The additional texture samples are guarded by the blur setting and the
   peak/trough mask, so they are only needed where selective blur is active.

Transparency and blur are mutually exclusive in the toolbar. Both effects are
automatically disabled when the active texture does not use wave sampling.
