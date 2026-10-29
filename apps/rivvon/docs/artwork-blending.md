# Artwork blending

Tools → Scene → **Artwork Blend** offers Normal and Soft Light. The same control
appears in Export Video. It is independent of Static Texture's background blend.
Normal is the default for existing preferences and presets. The setting is saved
as `artworkBlendMode` in viewer preferences, Tools snapshots, and the shared
preset artwork contract. No database migration or new storage is needed; deploy
the API's updated shared preset allowlist with the viewer.

Normal uses the existing rendering path. Soft Light renders the completed,
depth-tested ribbon into an offscreen target and blends that image over a
separately rendered backdrop. Ribbon crossings retain their existing depth
ordering; individual surfaces do not accumulate Soft Light at each crossing.
The camera-locked background and lighting shadow catcher are explicitly tagged
as backdrop objects. Other drawables remain part of the artwork layer.

The artwork pass produces the shadow maps. The backdrop pass preserves them
while drawing the background and projected shadows. Visibility, shadow settings,
background material flags, clear color/alpha, and the caller's render target are
restored even if a pass throws. Cap and alpha-to-coverage materials use the
existing offscreen alpha/depth override pattern and are restored after drawing.

Both GLSL and TSL blend straight sRGB colors using the same Soft Light formula
as the background, then combine source and backdrop coverage with source-over
alpha. Render targets contain premultiplied pixels. The WebGPU compositor
handles linear/sRGB conversion before and after blending and applies the branch
independently to each RGB channel. A transparent backdrop retains the original
artwork color. Scene filters run after compositing, with alpha applied once.

Soft Light adds two offscreen targets and two draws relative to Normal. Targets
track the output resolution, including temporary export dimensions, and are
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
  depth-tested crossings, export resizing, and restoring preview dimensions.
- `pnpm --filter rivvon test:background-gradient` checks the existing background,
  scene-filter, and preview/export paths in both renderers.
