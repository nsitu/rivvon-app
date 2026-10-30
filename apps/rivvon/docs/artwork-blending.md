# Artwork blending

Tools → Scene → **Artwork Blend** offers Normal, Soft Light, Multiply, Screen,
Overlay, Difference, Darken, Lighten, Hard Light, Exclusion, Color Dodge,
Color Burn, Hue, Saturation, Color, and Luminosity. The same control appears in
Export Video. Static Texture's independent background blend offers the same modes.
Normal is the default for existing preferences and presets. The setting is saved
as `artworkBlendMode` in viewer preferences, Tools snapshots, and the shared
preset artwork contract. No database migration or new storage is needed; deploy
the API's updated shared preset allowlist with the viewer.

Both controls offer **Blend Strength** for non-Normal modes. The independent
`artworkBlendStrength` and `backgroundTextureBlendStrength` values range from
0 to 1 and default to 1, including legacy preferences and presets. Strength mixes
between the Normal result and the selected blend result without changing alpha.
For artwork, WebGPU's Normal endpoint uses linear-light source-over before the
final displayed results are interpolated; WebGL's Normal endpoint follows its
existing encoded RGB rendering. Backgrounds retain their existing color-space
and legacy Soft Light treatment. Mode/strength edits update uniforms without
allocating a new compositor. Both menus use the shared blend-mode registry,
which also supplies the API preset allowlist.

The additional modes follow [W3C Compositing Level 1](https://www.w3.org/TR/compositing-1/#blending).
Hue, Saturation, Color, and Luminosity use its luminosity weights (0.3, 0.59, 0.11),
channel-range saturation and gamut clipping, rather than an HSL lightness swap.
Greys have zero channel-range saturation. Color Dodge and Color Burn explicitly
handle black/white boundaries without dividing by zero. WebGPU artwork preserves
exact white during sRGB encoding so transfer-function rounding does not change
those boundary cases. The original mode indices remain stable; additions append
to the registry. WebGPU uses uniform shader branches to run only the selected
mode's colour math, and the new modes use the existing render passes and targets.

Normal uses the existing rendering path. Other modes render the completed,
depth-tested ribbon into an offscreen target and blend that image over a
separately rendered backdrop. Ribbon crossings retain their existing depth
ordering; individual surfaces do not accumulate the blend at each crossing.
The camera-locked background and lighting shadow catcher are explicitly tagged
as backdrop objects. Other drawables remain part of the artwork layer.

The artwork pass produces the shadow maps. The backdrop pass preserves them
while drawing the background and projected shadows. Visibility, shadow settings,
background material flags, clear color/alpha, and the caller's render target are
restored even if a pass throws. Cap and alpha-to-coverage materials use the
existing offscreen alpha/depth override pattern and are restored after drawing.

Both GLSL and TSL use shared blend formulas on straight sRGB artwork colors,
then combine source and backdrop coverage with source-over alpha. Render targets contain premultiplied pixels. The WebGPU compositor
handles linear/sRGB conversion before and after blending and applies the branch
independently to each RGB channel. A transparent backdrop retains the original
artwork color. Scene filters run after compositing, with alpha applied once.

Each non-Normal mode adds two offscreen targets and two draws relative to
Normal. Targets track the output resolution, including temporary export dimensions, and are
released on switching back to Normal or tearing down the renderer. The artwork
target uses MSAA when antialiasing is enabled. Targets use half-float color where
supported, with an unsigned-byte fallback on WebGL devices without float color
attachments. Normal does not allocate these targets.

Live viewing, still capture, video frames, and live texture-overview exports use
the shared render filter/compositor. Export disables the Artwork Blend selector
while encoding. Each renderer owns its own compositor resources.

Verification:

- `pnpm --filter rivvon test:run` covers settings, preset defaults/validation,
  layer isolation, error cleanup, shadow preservation, render-target sizing,
  cap-state restoration, and returning to the Normal path.
- `pnpm --filter rivvon test:artwork-blend` checks real WebGL/WebGPU pixel output
  against known colors, including mixed RGB branches, transparency, filtering,
  depth-tested crossings, actual export targets, strength endpoints/midpoints,
  and all three background paths (sharp, blurred, gradient). Native Canvas 2D
  blending is also used as an independent oracle for black/white boundaries,
  greys, saturated colours and all channel orderings.
- `pnpm --filter rivvon test:background-gradient` checks the existing background,
  scene-filter, and preview/export paths in both renderers, plus all menu options
  and keyboard access to Luminosity in both selectors.
