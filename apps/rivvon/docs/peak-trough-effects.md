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
center texel plus broad axial and diagonal sample rings. The Blur Strength
setting expands nonlinearly into a source-texture radius, so the existing
default of `4x` covers roughly 32 source texels and the top of the range can
span the full texture.

Where the source contains mip levels, the blur also samples a lower mip chosen
from that effective radius. This prefilters fine detail before the wide kernel
is applied and allows high strengths to reduce the source almost to a color
field. Sources without mip levels still use the broad sample rings as a
fallback.

This is a single-pass, Kawase-style neighborhood kernel rather than the
scene background's low-resolution, multi-pass blur. Keeping this effect in the
ribbon material has two important properties:

1. Blur is confined to the texture and does not bleed across the ribbon
   silhouette into the scene background.
2. The additional texture samples are guarded by the blur setting and the
   peak/trough mask, so they are only needed where selective blur is active.

The toolbar has one master Peak/Trough Effects toggle followed by an Effect
Type selector for Transparency or Blur. The selected type is remembered while
the master toggle is off. Effects are automatically disabled when the active
texture does not use wave sampling.
