# Scene background blur

The scene background is rendered as a camera-locked textured plane by
`src/composables/viewer/useSceneBackground.js`. Background blur processes the
tiled artwork through offscreen GPU render targets. The color overlay, static
paper texture, and procedural water are composited afterward and remain crisp.
Both WebGL and WebGPU implement the following profiles.

## Realtime preview

The background source is rendered into a target whose longest side is capped
at 384 pixels. Repeated horizontal and vertical 17-tap Gaussian-style passes
approximate the desired softness. The blur amount selects between one and six
pass pairs and changes their sampling offsets. Intermediate targets use
eight-bit RGBA storage. This profile favors interactive performance; widely
spaced samples can leave uneven softness at strong blur settings.

The slider is not a CSS pixel radius. Its existing amount-to-radius mapping
is preserved, including its discrete radius steps. The separate in-material
neighborhood blur is disabled; the offscreen passes perform the actual blur.

## Export quality

Frame-accurate video and still-image capture pass `blurMode: 'export'`, plus
the output width and height, to the shared background runtime. Texture-overview
video export uses the same path. Legacy realtime MediaRecorder recording
continues to capture the preview.

Export renders the background at the exact output dimensions and filters it
with one dense horizontal Gaussian convolution followed by one dense vertical
convolution. `src/modules/viewer/backgroundExportBlur.js` generates normalized
weights with support extending to four standard deviations. Each pair of
adjacent texels is combined into one bilinear lookup with a weighted offset.
This covers every texel in the support, rather than stretching a fixed number
of samples across a wider radius.

The Gaussian standard deviation is calibrated to the variance of the preview's
17-tap kernel and scales with the output's longest side relative to 384 pixels.
This preserves the approximate apparent blur width across resolutions. Exact
appearance may differ because the preview is an approximation and export
filters in linear light.

All three background render targets use linear-sRGB RGBA16F storage during
export. WebGL's legacy shaders treat source RGB as display-referred sRGB, so
the source shader explicitly decodes it before convolution. The display shader
encodes the filtered background again before applying the existing crisp
overlays. WebGPU's node materials use Three.js's linear working-space handling
and output conversion. The global renderer and video color conversion contracts
are unchanged.

Targets, kernel textures, and materials are reused between export frames and
recreated when dimensions, quality profile, or export blur amount change. The
next preview update releases export resources and restores the realtime profile,
even if its dimensions match the export dimensions. Blur passes restore the
caller's render target on success or failure.

Frame-accurate video retains synthetic timestamps for background animation, so
render time does not affect motion. Kernel size and work increase with blur
width and output resolution. The three RGBA16F background targets alone require
about 190 MiB at 3840 x 2160, excluding the scene and encoder resources.

## Validation

`backgroundExportBlur.test.js` compares the paired kernel with an independent
dense Gaussian reference, including image edges and fine patterns, and checks
normalization and radius scaling. `useSceneBackground.test.js` covers profile
switching, precision, reuse, disposal, exact dimensions, and render-target
restoration for both backends. `useSceneExport.video.test.js` checks still-image
quality selection and deterministic video timing.
