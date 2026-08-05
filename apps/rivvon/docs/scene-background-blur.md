# Scene background blur

The scene background is rendered as a camera-locked textured plane by
`src/composables/viewer/useSceneBackground.js`. When background blur is
enabled, the background is processed through an offscreen GPU pipeline before
it is displayed.

## How it works

1. The tiled background is rendered into a low-resolution render target. The
   longest side is capped at 384 pixels to keep the blur inexpensive.
2. The result is blurred through repeated full-screen passes. Two render
   targets are reused in a ping-pong pattern, so each pass reads the previous
   result and writes to the other target.
3. Each pass averages four diagonal neighboring texels using an increasing
   sampling offset. This is a Kawase-style blur: several inexpensive passes
   approximate a wider soft blur without requiring a large convolution kernel.
4. The final render-target texture is assigned to the background plane and
   composited with the optional background color overlay.

The blur amount controls the number of passes and their sampling offsets. It
does not represent a CSS pixel radius or a single Gaussian-kernel radius. The
current pass-count mapping is approximately `2 + amount * 0.6`, clamped to a
maximum of 32 passes.

The same overall pipeline is implemented for WebGL and WebGPU. The tiled
background shader also contains a small multi-sample path, but the effective
scene-background blur is performed by the separate low-resolution,
multi-pass pipeline when the blur setting is enabled.

## Performance and quality

This approach is well suited to the background because it is tolerant of
approximation and is rendered at reduced resolution. Its main cost is one
background render plus several full-screen blur passes per update. Compared
with a large single-pass Gaussian kernel, the fixed four-sample passes are
usually cheaper and easier to scale, though the result can be less uniform at
very high blur amounts.

## Video export

Frame-accurate video export uses a separate quality profile. The composed
background target matches the requested export dimensions, and the blur offsets
are scaled with the target so the apparent blur radius remains consistent at
the higher resolution.

Export frames use a two-pass separable Gaussian blur (horizontal then vertical)
instead of the realtime Kawase approximation. This produces a more uniform
blur with fewer directional artifacts while keeping the export work on the GPU.
Export resource usage therefore scales with the requested video resolution.

Background flow also receives the export frame's synthetic timestamp, so a slow
export does not turn realtime wall-clock time into uneven motion between frames.
