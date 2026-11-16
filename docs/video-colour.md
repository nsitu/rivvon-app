# Deterministic SDR video exports

By default, MP4 exports convert displayed sRGB canvas pixels to BT.709 transfer and
limited-range 8-bit I420, encode with pinned browser-local x264, and mux AVC MP4.
Every encoded batch's SPS and the final MP4 nclx/SPS are checked before returning
the file. This applies to scene exports, live texture overview exports, and the
standalone texture overview exporter. WebM remains the existing WebCodecs path.
No Loop source changes or player colour compensation are involved. The export
dialog also offers WebCodecs AVC with a colour-range selector. Limited (the UI
default) and Full explicitly convert to BT.709 I420 before native compression;
Browser default retains the original CanvasSource path for comparison.

## Architecture diagram

[GPU-assisted YUV export](proposed-gpu-yuv-export.svg) shows the export-only
shader conversion and required CPU-visible YUV readback implemented on
27 October 2026. CPU conversion remains available as a comparison and fallback.

[Open the editable SVG architecture diagram](video-colour-architecture.svg).
It follows rendered canvas frames through the two current MP4 export methods,
the then-experimental explicit-YUV WebCodecs path, file transport, Loop, Media3,
MediaCodec and the Android display stack. Green boxes describe pixel handling;
blue boxes describe declarations. The diagram records the checked code and
measurements as of 10 October 2026, before explicit YUV became an available
WebCodecs export option on 26 October.

The diagram separates these assumptions:

- Rivvon interprets the legacy renderer's displayed canvas bytes as sRGB. Its
  explicit conversion decodes sRGB, applies the BT.709 opto-electronic transfer
  function (OETF), and produces limited-range Y′CbCr samples before compression.
- Loop's checked Media3 1.10.1 [MP4 extractor](https://github.com/androidx/media/blob/1.10.1/libraries/extractor/src/main/java/androidx/media3/extractor/mp4/BoxParser.java)
  prefers bitstream colour declarations. It uses `nclx` when both colour space
  and transfer remain absent, skips the `nclx` matrix field and derives the
  Android colour standard from primaries. Other player versions may differ.
- The codec and graphics stack interpret those declarations. The precise
  conversion stage depends on the driver and surface path; the panel's physical
  electro-optical transfer function (EOTF) and calibration were not measured.
  Android colour enums and H.273/CICP identifiers are different numbering systems.

The SVG contains clickable primary references for standards and APIs. Its
comparison notes refer to the digital frame captures in
[the validation record](video-colour-validation.json), not calibrated panel
measurements. No Android Loop source is changed by this documentation.

## Encoder choice and final reports

For MP4, choose **FFmpeg WASM** (the default) or **WebCodecs**. FFmpeg performs
the explicit conversion described below. WebCodecs offers **Limited**, **Full**
and **Browser default** colour range. Explicit ranges composite the scene/logo
onto opaque sRGB, convert its transfer, matrix and range into real I420 pixels,
and supply raw `VideoFrame`s through Mediabunny's `VideoSampleSource`. Compression
still uses the browser encoder. Explicit YUV conversion offers GPU and CPU
methods, independently of encoder preference. Browser
default retains canvas capture and the optional transparent logo compositor.
All three paths use native AVC encoding and Mediabunny muxing. A completed
WebCodecs MP4 is inspected and returned with its original encoded bytes. Missing
SPS declarations are reported without an automatic FFmpeg repair pass. Diagnostic
comparisons can opt in to `h264_metadata` stream-copy repair; that changes tags,
not the pixel range. WebM uses
WebCodecs/VP9. The optional WebCodecs preference is browser decides, prefer
hardware or prefer software; these are hints, not confirmation of the encoder
actually selected. Unsupported native configurations fail without an automatic
switch to another method.

Every completed export shows a colour report in the dialog, with a downloadable
JSON file. MP4 reports inspect the final MP4 `nclx` and every SPS in `avcC`,
including range, primaries, transfer, matrix, chroma format and bit depth. Missing
fields remain **not declared**; conflicting fields are reported. Limited-range
exports allow missing declarations with warnings, while known contradictory
container/SPS/encoder output declarations or pixel formats still fail. Malformed
metadata that cannot be inspected also fails explicit-range export. Full-range
exports retain strict target verification because missing range declarations
can lead players to assume limited range. Browser-default files remain downloadable when declarations
differ from the SDR target. Reports distinguish explicit input conversion from
browser-managed conversion; neither matching tags nor explicit input alone
prove that every backend preserves pixel values. WebM reports encoder metadata;
its container and VP9 bitstream are explicitly marked as not independently
inspected.

### Bitrate and size estimates

The export UI offers quality presets alongside explicit numeric encoder controls:

- **Quality presets** (WebCodecs only, stored as `basic`) offers Mediabunny's five named quality levels, initially Medium.
  WebCodecs receives `new Quality(level)` without manual bitrate/QP overrides.
  Mediabunny tries its codec-specific QP first, then a resolution-dependent VBR
  target if quantizer encoding is unavailable. The description shows both
  requests, rather than promising a fixed output bitrate or file size.

- **Variable bitrate (VBR)** (WebCodecs) sends `new Quality({ bitrate, bitrateMode: 'variable' })`.
  Its description explains the average bitrate target and extra allocation to
  complex frames; actual bitrate and size depend on content, browser and encoder.
- **Constant bitrate (CBR)** (WebCodecs) sends `new Quality({ bitrate, bitrateMode: 'constant' })`.
  It remains available for broadcast or bandwidth-constrained delivery. Its
  description explains the preference for steady data rate over consistent
  quality, with no promise of an exact bitrate or hard file-size limit.
- **Constant quantizer (QP)** (WebCodecs) sends `new Quality({ quantizer })` without a bitrate
  fallback. Unsupported quantizer configurations fail rather than substituting VBR.
- **Constant quality (CRF)** (FFmpeg WASM, recommended and initially selected) sends x264 `-crf` without `-b:v`
  or `-qp`. It targets quality while adapting quantization, rather than holding
  a fixed QP. It uses a 0–51 slider with half-step increments and starts at 23.
- **Average bitrate (ABR)** (FFmpeg WASM) sends x264 `-b:v` for single-pass average
  bitrate encoding. The stored `variable` mode value is retained for compatibility.
- **Constant quantizer (QP)** (FFmpeg WASM, advanced) sends x264 `-qp` without
  `-crf` or `-b:v`, using an integer 0–51 slider. QP and CRF are distinct modes.
  FFmpeg CBR is not offered: the current MP4 pipeline does not implement the
  buffer constraints and padding that a deliberate CBR mode would require.

Target bitrate is entered in Mb/s and converted to integer bits/s. The initial
suggestion is resolution-aware, but the visible numeric value stays fixed when
resolution changes. The dialog estimate uses that target and the actual planned
frame count divided by fps. VBR/CBR are encoder requests, not hard file-size caps.
QP has its own integer field: 0–51 for H.264, 0–63 for VP9 and 0–255 for AV1. Lower values retain
more detail and usually produce larger files; values are not comparable across
codecs. QP mode shows **Content-dependent** instead of a bitrate-based size estimate.
In Quality presets, QP or CRF mode, **Estimate bitrate & size** optionally renders and encodes the first
two seconds (or the full clip if shorter) with the selected resolution, frame
rate, codec, QP/CRF, x264 preset or encoder preference, colour conversion, logo and motion settings.
Animation and background-clip timing retain the planned full export period;
only the number of frames encoded is limited. The measured compressed bytes
divided by the actual sample duration supply an approximate bitrate and total
size estimate. Later motion or texture changes can differ substantially, and
container overhead is excluded. This is a prefix sample, not a whole-loop
complexity analysis or a guaranteed output size.

Sampling is a cancellable explicit action. Changing export settings clears the
estimate. It uses the same rendering and encoding paths as a normal export but
does not save a video or draft: WebCodecs counts packet bytes into a streaming
`NullTarget`, while x264 counts and discards compressed batches without joining
them or muxing an MP4. Final-file colour validation still occurs during the
normal export; the bitrate sample itself does not establish colour correctness.

The QP slider displays the codec, current numeric value and codec-specific
endpoints: lower means more detail/larger files, higher means less detail/smaller
files. It supports integer steps, arrow keys, Home and End. Changing to a codec
with a smaller range brings an out-of-range slider value down to its maximum;
values within the new range are retained without treating them as equivalent
quality across codecs.

For H.264 VBR/CBR through WebCodecs, **Browser decides** and **Prefer hardware**
show a warning about the observed Chrome 7–9 Mb/s plateau. The warning explicitly
identifies this as a test result rather than a universal ceiling, explains that
size estimates can differ, and suggests constant QP or FFmpeg WASM. It is hidden
for QP, software preference, FFmpeg WASM and other codecs.

The final report records mode, target bitrate or QP, and the actual WebCodecs
configuration. Binary file sizes are labelled MiB/KiB.

The Quality presets explanation matches installed Mediabunny
1.60.0. Its qualitative levels map to 0, 0.25, 0.5, 0.75 and 1, interpolating
codec-specific QP endpoints:

| Quality level | H.264 QP | VP9 QP | AV1 quantizer |
| --- | ---: | ---: | ---: |
| Very Low | 41 | 52 | 208 |
| Low | 35 | 44 | 176 |
| Medium | 29 | 36 | 144 |
| High | 22 | 28 | 112 |
| Very High | 16 | 20 | 80 |

The browser path delegates the choice to Mediabunny's public Quality API; no
internal library API is used at runtime. FFmpeg WASM runs our own x264 pipeline;
Mediabunny's named quality levels are not mapped onto it. A parity test checks the explanation's
QP and fallback-bitrate formulas against the installed dependency for all levels,
all three available codecs and multiple resolutions. Dependency updates that
change those mappings require an explanation update. The final report
records the requested quality preset separately from the selected native QP/VBR
configuration. See [Mediabunny's Quality API](https://mediabunny.dev/api/Quality).

FFmpeg exposes x264's native `-preset` separately as **Encoding effort**, from ultrafast to placebo.
These trade encoding time for compression efficiency; they are not quality
levels. Veryfast remains this app's default. CRF and QP are distinct modes;
equal numeric values do not imply equivalent results. See the
[FFmpeg libx264 option reference](https://ffmpeg.org/ffmpeg-codecs.html#libx264_002c-libx264rgb).
The existing single-threaded batches and no-B-frame timing contract remain in
place, so presets operate within those constraints. Reports record CRF or QP and the
selected x264 preset. The FFmpeg QP slider explains its advanced use and the
difference from CRF and other encoders' QP values.

WebCodecs and FFmpeg retain separate rate-control choices and independent QP values, alongside FFmpeg's CRF value;
switching encoders does not numerically translate QP into CRF. Restoring old
FFmpeg Basic/CBR settings selects CRF with a visible review notice instead of
pretending those modes are equivalent; saved FFmpeg QP settings retain QP. Native quality-preset/CBR modes are rejected by
the FFmpeg writer. Settings travel unchanged through scene, texture overview,
texture preview and bitrate-sample exports.

Mediabunny 1.60's named quality presets prefer quantizer encoding when supported.
In particular, `QUALITY_VERY_HIGH` offers AVC QP 16 without a bitrate target.
Previously the dialog independently assumed 14 Mb/s for Very High at every
resolution. A 2160×2160, 30 fps, 120-second texture export was therefore predicted
as 200.3 MiB but encoded at 206.65 Mb/s (3,099,809,401 bytes). Its first slice
confirmed QP 16. This was a rate-control/estimate mismatch, not colour metadata
overhead.

At that resolution the ABR/VBR bitrate suggestion is 25.928 Mb/s, giving a 120-second target
estimate of 370.9 MiB. A three-second excerpt of the
reported file was decoded and re-encoded with the production hardware-preferred,
GPU-converted limited-range path: 76,737,227 source bytes became 12,255,041 output
bytes (32.68 Mb/s). The short test includes startup/GOP variation and does not
guarantee the final size of a full-length export.

To include a local source excerpt in the browser regression, set
`COLOUR_BITRATE_SOURCE=/colour-test-output/bitrate-regression/source.mp4` and run
`pnpm --filter rivvon test:video-colour`. It checks the actual native encoder
configuration, file size against a tolerance, and records the measured bitrate
in `browser-report.json`. Source/test outputs stay out of Git.
The regular colour regression also exercises H.264 and VP9 in all three native
rate-control modes and x264 in VBR/QP, checking the actual native configuration
and the absence of a bitrate fallback in QP mode.

### GPU shader or CPU colour conversion

For FFmpeg MP4 and explicit-range WebCodecs MP4, **Colour conversion** selects
**GPU shader** (the default) or **CPU**. Both implement the same sRGB-to-BT.709
transfer, matrix, range quantization and centred 2×2 chroma average. FFmpeg
always uses limited range; WebCodecs also offers full range. The choice controls
pixel conversion, independently of whether compression runs on CPU or hardware.
WebM and Browser default bypass this explicit conversion stage.

The GPU method uses an export-owned WebGL2 context. After scene/logo composition
onto opaque sRGB, it uploads the compositor, samples the same transfer lookup
table as the CPU reference, and packs four consecutive I420 bytes into each
RGBA8 framebuffer texel. `readPixels` reads those packed bytes into a reusable
CPU-visible buffer. Those bytes feed the raw I420 `VideoFrame` constructor or
the existing FFmpeg worker batches; the packed canvas is never encoded as RGB.
For ordinary frame sizes this reads 1.5 bytes per source pixel instead of the
CPU path's 4-byte RGBA readback (62.5% less data). Small/non-aligned sizes can
require padding in the internal readback surface; output I420 remains tightly
packed at the exact requested dimensions.

GPU conversion still incurs canvas upload, readback, synchronization and native
frame construction costs; it is not a zero-copy pipeline or a promise of faster
export on every device. Export runs offline and has no realtime frame deadline.
Shader compilation can add startup cost. CPU conversion remains useful for
comparison or compatibility. GPU initialization failure, texture-size limits or
context loss trigger CPU conversion for the remaining frames. Reports record
the requested and actual method, fallback reason and readback bytes per frame.
Both methods are instantiated only inside export writers; viewer navigation
does not allocate or invoke this converter.

`pnpm --filter rivvon test:gpu-yuv` checks real WebGL2 output against CPU output,
including random RGB, black/white endpoints, top/bottom orientation, subsequent
frame updates, non-aligned packing and context-loss fallback. Chrome and Edge
156 on Windows/Intel D3D11 passed six sizes from 2×2 to 3840×2160, both ranges.
Differences were at most one code value due to floating-point rounding. This
does not establish identical results on other GPUs or browsers; keep decoded
pixel and metadata validation when testing another platform.

[Validation results](gpu-yuv-validation.json) also record 24 production
WebCodecs exports (540p/30 in Edge and 1080p/29.97 in Chrome), both ranges,
all encoder preferences and logo settings. Their colour declarations, timing,
temporal markers and decoded chart patches passed; native hardware encoding
was observed in traces. Shader-fed FFmpeg exports also passed for chart/ribbon
and logo on/off. Diagnostic shader timings include upload/readback, while the
recorded CPU timings measure arithmetic only; they are not an end-to-end
throughput comparison.

[CPU versus GPU benchmark](yuv-conversion-benchmark.md) records a subsequent
comparison with identical timing boundaries, including GPU rendering, composition,
readback/conversion and `VideoFrame` construction, plus complete WebCodecs exports.
On the tested Windows/Intel device, the shader path improved representative
frame preparation by 2.8–4.6× and complete hardware AVC exports by 1.5–2.3×.
The benchmark includes Chrome/Edge 156, 540p through 4K and both representative
ribbon and random-RGB stress content; these gains are not a cross-device promise.

### Missing SPS declarations on WebCodecs exports

Normal WebCodecs exports do not load or run the repair tool. The explicit YUV
conversion already determines the input pixels' transfer, matrix and range.
Repair only adds declarations; it cannot prove that a browser encoder preserved
those samples. Limited-range files with incomplete metadata remain downloadable
with warnings and without claiming fully verified declarations. This avoids the
WASM heap, remux, and extra full-file allocations after encoding. The original
BufferTarget and final download still require memory; this is not a general
guarantee against allocation failures elsewhere in the export.

The comparison lab and production-input colour test explicitly request
`repairSpsColour: true`. This diagnostic repair runs only when MP4 `nclx` and all observed encoder output colour
configurations provide complete, consistent declarations. Any already-declared
SPS fields must agree. Missing/unspecified SPS fields are filled with those
**observed output values**, not the desired BT.709 limited target. Existing
conflicts or insufficient evidence leave Browser default files available with an
explanation in the final report; full range retains strict target validation.
Already-complete SPS declarations need no
repair tool. A tool failure or changed frame timing fails the export rather than
returning an incorrectly repaired file.

For the original Chrome 155 canvas output this meant `1/13/1/full` (709 primaries,
sRGB transfer, 709 matrix, full range), not `1/1/1/limited`. The pinned local
FFmpeg WASM core applies [`h264_metadata`](https://ffmpeg.org/ffmpeg-bitstream-filters.html#h264_005fmetadata)
with `-c:v copy` and writes agreeing container fields. There is no re-encode or
sample conversion. The original movie/video clocks, sample durations,
composition offsets, edit-list presentation, frame count, dimensions and pixel
format must survive inspection unchanged. Cancellation terminates the repair
worker. The final JSON records original SPS values, applied filter, final
declarations and whether repair was added, unnecessary or skipped.

The repair worker reads its input from a Blob mounted through WORKERFS. This
avoids transferring a complete MP4 ArrayBuffer through `postMessage` and keeping
another full input copy in FFmpeg's in-memory filesystem. Repair input and final
download packaging stream independently copied 32 MiB buffers into a Response
Blob. Passing one large buffer to `new Blob` also exceeds Chrome's WebIDL range;
holding many Blob parts can exhaust its Blob storage quota. Streaming lets the
browser move the data to storage with backpressure.

The repair-specific FFmpeg worker also streams binary `READ_FILE` responses
into Blobs instead of transferring their entire ArrayBuffers. The main thread
reads bounded Blob slices for metadata verification and reuses the worker Blob
for the final download. The protocol adapter targets pinned `@ffmpeg/ffmpeg`
0.12.15; the normal SDR encoder pool retains its existing worker protocol.

The colour regression includes a 256 MiB padded MP4 with imposed 128 MiB buffer
limits on Blob construction and worker transfers. Set
`COLOUR_REPAIR_PADDING_MIB=2048` to reproduce Chrome's actual direct-Blob
RangeError above 2 GiB and verify streaming packaging, mounted input repair,
and a complete large-file round trip from FFmpeg's MEMFS through the worker and
the main-thread Blob reader. The fixture uses padding rather than encoding a
multi-minute video; colour repair still verifies the actual sample timings.

This can address decoders that mishandle absent bitstream declarations. It cannot
establish that the browser's RGB-to-YUV conversion was correct or normalize
full-range/sRGB/601 samples. FFmpeg WASM encoding remains the default for the
conventional BT.709 limited contract.

Reports capture the input `VideoFrame.colorSpace` (raw I420 for explicit range,
or the same canvas constructor as CanvasSource), the first useful encoder output decoder config,
the last encoder configuration candidate considered by Mediabunny, the requested
acceleration preference and the observed final MP4 declarations. They also
capture browser-reported UA/platform, full browser versions and OS version/client
hints when available, and the source renderer's existing GL vendor/renderer.
Restricted hints and non-WebGL contexts leave unavailable values rather than
guessing. A Windows UA may say Windows NT 10 even on Windows 11; client-hint
`platformVersion` is the browser's platform version code, not a Windows build
number. Browser APIs do not expose the actual native encoder name or reliably
confirm hardware selection. Do not interpret the preference or GL renderer as
that identity.

The JSON is retained on the encoded export and, when the user publishes that
video, in `render_snapshot.export.colourReport`. There is no separate telemetry
upload. Cancelled/failed exports do not show a completed report. Callers outside
the dialog can use `onColourMetadata`, whose final event has `phase: 'complete'`.

## What limits WebCodecs, and what Mediabunny controls

The current [WebCodecs encoder configuration](https://www.w3.org/TR/webcodecs/#videoencoderconfig)
does not provide output colour-space, full/limited range or pixel-format/chroma
controls. The [AVC codec registration](https://www.w3.org/TR/webcodecs-avc-codec-registration/#avc-encoder-config)
adds AVC/Annex-B framing, not these colour controls. `VideoFrame.colorSpace`
describes input pixels; it is not a request for a particular output conversion.
The colour setting on `VideoDecoderConfig` is a **decoder** override, not an
encoder control. `VideoEncoder.isConfigSupported()` establishes configuration
support, not correct colour conversion or agreement between container and SPS.
The [hardware preference](https://www.w3.org/TR/webcodecs/#hardware-acceleration)
can be ignored and does not identify the selected implementation.

Mediabunny's `CanvasSource` takes a convenient browser-created sample from the
canvas. It leaves RGB-to-YUV conversion to WebCodecs and muxes the colour
information returned by the encoder. Mediabunny can accept explicitly created
`VideoSample`/`VideoFrame` inputs and can expose encoder callbacks, but cannot
add portable native encoder controls that WebCodecs lacks. Its muxer also cannot
correct already-encoded pixels or cause missing SPS colour declarations to
appear merely by writing `nclx`.

The observed differences are in the combination of browser, OS media backend,
GPU/driver and encoder selection. They are not proof that every WebCodecs
implementation produces bad video. Even on the same PC, the original Chrome 155
hardware/no-preference output is full-range sRGB-transfer with missing SPS
colour, while software preference and Edge produce limited-range sRGB-transfer
with explicit SPS colour. Neither is the requested all-BT.709 contract.

The explicit I420 path now implements the native alternative tested below.
It removes implicit RGB-to-YUV input conversion, but each supported backend
still needs decoded chart checks. Runtime verification checks declarations;
it does not decode and compare every export. Unsupported/mismatching output
fails without silently changing the requested range or compression method.

### Explicit YUV input experiment (2026-10-10)

The original canvas is full-range sRGB/RGB input. Chromium's Windows
[`GetEncoderOutputColorSpaceFromInputColorSpace`](https://github.com/chromium/chromium/blob/main/media/gpu/windows/format_utils.cc)
helper selects a YUV matrix from RGB primaries while retaining input range and
transfer. Other paths, such as GPU readback, can select limited range. This
explains how input description and the backend conversion path influence output;
it is not a content-based test of whether the artwork contains black or white.

The controlled chart was converted with the existing `rgbaToBt709I420` function,
then supplied as real I420 or NV12 `VideoFrame` buffers with BT.709 colour and
`fullRange: false`, through Mediabunny's `VideoSampleSource`. Compression still
used WebCodecs. This bypassed implicit canvas RGB-to-YUV conversion. Both input
formats were tested with browser-decides, prefer-hardware and prefer-software
on Chrome 155 / Windows / Intel ANGLE:

| Input | Browser decides / prefer hardware | Prefer software |
| --- | --- | --- |
| Canvas RGB | 709/sRGB/709/full | 709/sRGB/709/limited |
| Converted I420 | 709/709/709/limited | 709/709/709/limited |
| Converted NV12 | 709/709/709/limited | 709/709/709/limited |

All six converted-input cases decoded as `yuv420p`, with exact expected interior
chart patch values (maximum YUV error 0), 90 frames, 30 fps and 3 seconds.
Browser-decides/hardware preference still omitted SPS colour before the existing
metadata repair; software preference included it. After repair, independent
FFmpeg `trace_headers` verified SPS `1/1/1/limited`, agreeing with `nclx`.

Repeat with the browser and native-tool variables described above:

```sh
node apps/rivvon/scripts/test-webcodecs-input-colour.mjs
```

Artifacts default to `colour-test-output/explicit-yuv/`. The expanded experiment
saves original/repaired MP4s, native header/encoder traces and its report.
Merely labelling canvas pixels or compressing RGB values into 16–235 does not
perform the required transfer/matrix/range conversion.

### Repeated YUV range validation and production control (2026-10-26)

The checked result summary is [webcodecs-yuv-validation.json](webcodecs-yuv-validation.json).
Chrome 156.0.8078.47 and Edge 156.0.4314.42 were tested headlessly on the same
Windows/Intel Graphics D3D11 machine. This is evidence for that environment,
not a guarantee for other GPUs, operating systems, codecs or future versions.

- 72 raw-YUV exports cover I420/NV12, limited/full, all three preferences and
  two repeats at Chrome 960×540/30 fps and 1920×1080/29.97 fps, plus Edge
  960×540/30 fps. Nine canvas exports provide browser-default comparisons.
- 60 production-writer exports cover limited/full and all three preferences,
  logo off/on, three repeats in Chrome at 1080p and two in Edge at 540p.
- All 66 limited-range YUV exports have zero maximum interior chart YUV error
  across the first/middle/last frames. Hardware/full cases also have zero error;
  software/full cases differ by at most one code value. Lossy compression means
  this exactness is specific to the tested chart patches and quality setting.
- Chromium media tracing associates each case with native encoding activity.
  Hardware preference and browser-decides cases enter
  `MediaFoundationVideoEncodeAccelerator::ProcessInput` after initialization
  with `required_encoder_type: hardware`. Software-preferred cases do not.
  These diagnostics are lab-only; the browser API still cannot identify the
  implementation in the product's colour report.
- Independent FFmpeg/ffprobe verifies SPS `1/1/1`, the requested range, 8-bit
  4:2:0, frame counts and duration. MP4 inspection agrees. All production
  frame markers decode in order without dropped/duplicated frames. Decoded
  first/middle/last frames match before/after metadata repair.

The UI defaults to Limited when selecting WebCodecs MP4. Direct API callers
omitting `videoRange` retain `auto` for compatibility. `videoRange: 'limited'`
or `'full'` uses explicit I420 and requires matching final colour declarations.
Full range is a separate target; it does not pass the conventional limited SDR
contract and is displayed as a successful full-range declaration check instead.
Odd dimensions are rejected for explicit 4:2:0. WebM and the FFmpeg default
retain their existing behavior. Hardware output still needed SPS repair on this
machine; that stream copy adds declarations and does not convert samples.
Chrome 156 canvas output now declares limited sRGB, unlike the earlier Chrome
155 full-range result, further demonstrating that implicit conversion can change.
Android playback of these new native files and other hardware remain untested.

Set `BROWSER_BINARY`, `FFMPEG_BINARY` and `FFPROBE_BINARY` as above, then run
`node apps/rivvon/scripts/test-webcodecs-input-colour.mjs`. Optional environment
settings are `COLOUR_REPEATS` (default 3), `COLOUR_WIDTH`, `COLOUR_HEIGHT`,
`COLOUR_FPS`, `COLOUR_FRAMES` and `COLOUR_OUTPUT_DIR`. Set `COLOUR_PRODUCTION=1`
to test the real writer with logo off/on and changing frame markers. On Windows,
`COLOUR_REQUIRE_HARDWARE=1` additionally requires the Media Foundation hardware
trace for each hardware-preferred case. Reports and videos from this run are in
the ignored `apps/rivvon/colour-test-output/yuv-range-2026-10-26/` directory.

## Why the renderer stays as it is

The checkout investigated uses Mediabunny **1.60.0**, rather than the older 1.31
mentioned in the report. Its CanvasSource still delegates canvas conversion and
output colour metadata to the browser encoder.

The WebGL ribbon path deliberately has a legacy numeric-RGB contract:

1. KTX2/array textures are assigned `LinearSRGBColorSpace` in `tileManager.js`.
   This suppresses an sRGB texture decode; it does not establish that the source
   artwork's bytes are physically linear light.
2. Both array and dual-array `ShaderMaterial` shaders sample the texture RGB,
   perform their contrast/saturation/transparency/lighting arithmetic on those
   numeric values, and write `outColor` directly. Neither includes an output
   sRGB conversion. There are no `RawShaderMaterial` uses in Rivvon's source.
3. Render-filter shaders unpremultiply, modify numeric RGB and premultiply again.
   The background, water, lighting and composite shaders also write their output
   directly. Some background/gradient inputs and built-in materials *do* use
   Three.js sRGB texture/colour handling. These paths are mixed; changing the
   renderer's global colour space would alter them differently.
4. `rendererConfig.js` uses `LinearSRGBColorSpace` and `NoToneMapping`. The canvas
   is nevertheless a display surface: its displayed bytes are exported as sRGB.
   The colour chart rendered through the **actual production dual-array shader**
   matches the source numeric sRGB chart exactly, with maximum channel error 0
   on the tested Intel/Direct3D11 GPU.

Consequently the export boundary is the *displayed canvas*, not an assumption
that every material uses physically linear shading. The renderer configuration
and artwork/filter math are preserved. This change does not repair or redesign
Three.js material colour management.

## Pixel and encoding path

```
textures/materials → Three.js render/postprocess → WebGL or WebGPU canvas
 → opaque sRGB Canvas2D compositor (both logo settings; black matte)
 → getImageData() in sRGB, unpremultiplied RGBA
 → inverse sRGB transfer → BT.709 OETF
 → BT.709 Y′CbCr matrix → limited I420 (8-bit, centred 2×2 box chroma)
 → @ffmpeg/core 0.12.10 / libx264, up to four single-threaded workers, no B frames
 → lossless AVC remux → restore exact CFR MP4 timing fields
 → validate SPS/VUI, nclx, dimensions, frame count and duration → Blob
```

`exportColour.js` implements the transfer functions and matrix explicitly:

- `Y′ = 0.2126 R′ + 0.7152 G′ + 0.0722 B′`.
- `Y8 = round(16 + 219 Y′)`.
- `Cb8 = round(128 + 224 (B′ − Y′) / 1.8556)`.
- `Cr8 = round(128 + 224 (R′ − Y′) / 1.5748)`.
- Average each 2×2 block's unquantized chroma before quantization. Signal centred
  chroma in x264. Clip Y to 16–235 and Cb/Cr to 16–240.

For example, sRGB `(128,128,128)` converts to `(Y,Cb,Cr)=(115,128,128)`.
Simply labelling the sRGB samples as BT.709 would instead give Y=126; it is not
the implemented conversion. Fully saturated red gives `(63,102,240)` and blue
gives `(32,240,118)`, which distinguishes the 709 matrix from 601.

The default FFmpeg MP4 path does not create a VideoFrame or call VideoEncoder. WebCodecs does
not offer portable encoder controls guaranteeing this output, and a labelled
VideoFrame would not prove that an implementation performed the correct
conversion. The software encoder receives already-converted I420, and its
`colorprim`, `transfer`, `colormatrix`, range and chroma-location options describe
those actual samples. The tags are not applied to unconverted RGB or old files.

Raw batches are bounded to 32 MiB (at least one frame), then encoded as Annex B
AVC. Every batch begins with an IDR, has no B frames, and has its SPS inspected.
An adaptive pool reuses idle workers and loads additional independent FFmpeg
instances only when all current workers are busy, up to four workers. The limit
also respects the reported CPU count (leaving one CPU available when possible)
and the export's batch count. If an additional worker cannot load, the pool
continues with its existing workers. Each instance retains `-threads 1`, so no
SharedArrayBuffer or cross-origin isolation is required.

Frame production waits for a free slot before copying the next batch. At most
one 32 MiB raw input per worker plus the reusable producer buffer is retained
(up to 160 MiB of raw input at four workers, excluding WASM heaps and readback;
a single frame larger than 32 MiB is still allowed). Completed batches are kept
in submission order, even when workers finish out of order. Extra workers are
terminated before joining the stream to release their WASM heaps.
The batches concatenate into one elementary stream and remux without re-encoding.
The final movie, media, sample and edit-list duration fields are set from the
original CFR clock. This avoids FFmpeg raw-AVC timestamp and final-duration
rounding, verified with an independently decoded binary marker on every frame.

The existing synthetic render clock, `ceil(duration * fps)` frame count, texture
ticks and camera animation remain intact. No endpoint frame is added. Original
renderer dimensions, pixel ratio, camera and controls state are restored on
success, cancellation or error. Progress reserves its final 5% for muxing and
verification. Progress percentage, frame counts and average export fps track
completed encoding batches rather than queued frames. Active frame ranges stay
visible alongside those metrics. Cancellation terminates every WASM worker
rather than finishing and returning an incomplete loop.

All five presets retain Mediabunny's AVC target bitrate formula: 3 Mbps at 1080p,
scaled by pixel count to the power 0.95, with multipliers 0.3/0.6/1/2/4. Actual
file sizes and compression differ because x264 replaces the native encoder and
each batch starts a new GOP. The existing white logo, shadow, size and corner
layout are reused before colour conversion.

## Repeatable comparison workflow

`pnpm --filter rivvon test:video-pool` runs a real headless Chromium worker-pool
regression with cross-origin isolation disabled. It encodes eight bounded raw
batches, verifies SDR declarations, and decodes every frame's binary marker and
CFR timestamp to check ordering. On a machine with enough CPU cores, set
`POOL_MIN_WORKERS=4` to require four simultaneous encoding workers. The JSON
result is written to `apps/rivvon/colour-test-output/worker-pool/four-worker-report.json`.

Run `pnpm --filter rivvon dev` and open `/colour-test.html`. The development-only
page is not a production build entry. Its console API is:

```js
await colourLab.exportComparisons()
await colourLab.exportComparisons({ hardwareAcceleration: 'prefer-software' })
await colourLab.exportComparisons({ hardwareAcceleration: 'prefer-hardware' })
```

The lab presents and exports the same source canvases. The chart contains full
white/yellow/cyan/green/magenta/red/blue/black bars, near-black steps
0/1/2/4/8/12/16/24, near-white steps 231/235/239/243/247/251/254/255, neutral
32/64/96/128/160/192/224/240 patches, a grey ramp, and a red/blue gradient. All
numbers are **source sRGB code values**, listed on the page. The bars are
SMPTE-style, not a certified SMPTE pattern. The ribbon fixture uses production
`RibbonSeries` geometry and `TileManager` materials with saturated colours.

The lab saves preview PNGs, unrepaired CanvasSource MP4s (`*-before.mp4`),
SPS-repaired copies of those exact streams (`*-webcodecs-repaired.mp4`), software
BT.709 exports (`*-after.mp4`), desktop playback PNGs, and JSON metadata.
Native reports include `VideoFrame.colorSpace` and the
first useful `EncodedVideoChunkMetadata.decoderConfig.colorSpace`. New-path
reports include verified bitstream/container metadata. New production exports
also log this data in development and accept an `onColourMetadata` callback.

Automated browser/native regression:

```powershell
$env:BROWSER_BINARY = 'C:/path/to/chrome.exe'
$env:FFPROBE_BINARY = 'C:/path/to/ffprobe.exe'
$env:FFMPEG_BINARY = 'C:/path/to/ffmpeg.exe'
pnpm --filter rivvon test:video-colour
```

Without the native-tool variables the browser's own independent box/SPS checks
still run, but ffprobe, trace_headers and decoded sample/sequence checks are
skipped. Set `HARDWARE_ACCELERATION` to compare the legacy path. Set
`COLOUR_OUTPUT_DIR` to keep each run separately. `COLOUR_WIDTH`, `COLOUR_HEIGHT`,
`COLOUR_FPS`, and `COLOUR_FRAMES` support resolution and timing cases; chart sizes
must be multiples of 16×12. Defaults are 960×540, 90 frames, 30 fps. A second
tested case is 1920×1080, 25 frames, exactly 29.97 fps.

The native regression checks codec, format, all colour fields, both frame rates,
dimensions, decoded frame count, duration, actual SPS fields with `trace_headers`,
chart patch samples, and every binary temporal marker across batch boundaries.
It also checks that decoded native frames and timestamps have identical MD5
records before and after SPS repair.
The unit suite covers endpoints/primaries/transfer math, rejection of incorrect
or missing tags, parsing a real independently checked SPS, CFR timing repair,
synthetic scene timing, state restoration, errors and cancellation.

To inspect a file independently:

```sh
ffprobe -v error -select_streams v:0 -count_frames -show_streams -of json video.mp4
ffmpeg -i video.mp4 -map 0:v:0 -c:v copy -bsf:v trace_headers -frames:v 1 -f null -
```

Check nclx separately with `inspectMp4Colour` or another MP4 box inspector. A
merged ffprobe stream report alone can conceal missing/conflicting declarations.

To repeat the photo-frame comparison with the existing debug Loop diagnostic
build and an authorized ADB connection (one device, or set `ANDROID_SERIAL`):

```powershell
$env:ADB_BINARY = 'C:/path/to/adb.exe'
$env:COLOUR_OUTPUT_DIR = 'C:/path/to/sps-repair-comparison-output'
node apps/rivvon/scripts/test-android-video-colour.mjs
```

The script tests chart and ribbon, logo on/off, unrepaired/repaired/software
files on both surfaces. It saves diagnostics and screenshots, then restores the
original Loop preferences and removes its uniquely named device test files.
It does not change Android source or reinstall the app. Its eight-second wait
per case observes multiple three-second loops; screen captures compare digital
presentation rather than physical panel calibration.

## Results on 2026-10-09

Measured browser, ffprobe, SPS/container, gallery and Android diagnostic results
are saved in [video-colour-validation.json](video-colour-validation.json).
The generated comparison files and screenshots live in the ignored
`apps/rivvon/colour-test-output/` directory. `final/` contains the current
960×540 exports, `chrome-1080/` contains the fractional-rate case, and `android/`
contains the frame's screenshots and diagnostic dumps.

Windows 11, Intel Graphics via ANGLE/Direct3D11; Chrome for Testing 155.0.8059.39
and installed Edge 154. Both chart/logo settings and the saturated production
ribbon fixture were exported and played in desktop Chromium. Independent native
FFmpeg/ffprobe checks passed for the new files:

```
codec_name=h264  pix_fmt=yuv420p  color_range=tv
color_space=bt709  color_transfer=bt709  color_primaries=bt709
SPS: chroma_format_idc=1, bit_depth_*_minus8=0,
     video_full_range_flag=0, colour_primaries=1,
     transfer_characteristics=1, matrix_coefficients=1
nclx: primaries=1, transfer=1, matrix=1, full_range_flag=0
960×540: 90 decoded frames, 30/1 fps, 3.000000 seconds
1920×1080: 25 decoded frames, 2997/100 fps, 0.834168 seconds
```

Chart patch maximum decoded YUV error was **0**, with either logo setting.
The 1080p temporal-marker test found no dropped, duplicated or reordered frames.
Cancellation and the production build passed.

| Legacy native encoder selection | Input VideoFrame | MP4 nclx | AVC SPS colour declaration |
| --- | --- | --- | --- |
| Chrome hardware / no preference | 709 primaries, sRGB, RGB, full | 709/sRGB/709/full | absent |
| Chrome prefer-software | same | 709/sRGB/709/limited | 709/sRGB/709/limited |
| Edge no preference | same | 709/sRGB/709/limited | 709/sRGB/709/limited |
| New software path, all runs | explicit converted I420 | 709/709/709/limited | 709/709/709/limited |

This directly demonstrates encoder/browser-dependent metadata on the old path.
Logo on/off did not change its colour declarations on this machine. The restored
production WebCodecs option and final reports were retested using Chrome 155 on
2026-10-09; files and JSON are in `colour-test-output/encoder-choice/`. Software
exports passed independent ffprobe/SPS checks and exact frame-marker/patch tests.
Other GPUs
and operating systems were not independently tested; future MP4 encoding no
longer depends on their native encoder, but canvas rendering/readback still does.

The actual Android 13 Amlogic `t982_ar301` frame was tested with the existing Loop
diagnostic build, ARM Mali-G52 GPU and `c2.amlogic.avc.decoder`. The old Chrome hardware chart
reproduced the fault: pink white, teal black and severe primary-colour shifts.
The new chart had neutral grey steps and correct colour bars in **both**
SurfaceView and TextureView. Loop reported:

```
Input colour: BT709/Limited range/SDR SMPTE 170M/8/8
Codec colour: standard BT.709 (1) · range limited (2) · transfer SDR (3)
```

The input string's “SDR SMPTE 170M” is Media3's shared SDR transfer label; its
colour standard is BT709, and the actual file's transfer code is 1 (BT.709).
Logo on/off and ribbon playback were checked on both surfaces. The chart loops
reported zero dropped frames and a 33.333 ms boundary interval. Screen captures
and diagnostic text were saved, and the previous Loop selection/surface restored.
Screen captures validate the digital presentation; physical panel calibration
and viewing conditions are not measured.

There is a real presentation difference to retain in future comparisons:
Chrome's desktop video-to-sRGB-canvas capture returns approximately 115 for the
new file's source-sRGB-128 patch, whereas the Android SurfaceView capture returns
128. Android's neutral grey row differed from the source by at most 1 code value.
The exporter performs the requested BT.709 conversion; it does not compensate
for a particular player's presentation curve by retagging or altering the scene.

### WebCodecs SPS repair comparison

The production WebCodecs repair path was tested on the same Windows/Chrome/GPU
with chart and ribbon, both logo settings. Before repair, native `nclx` declared
`1/13/1/full` and SPS colour was absent. After repair, SPS also declared
`1/13/1/full`. Native FFmpeg `trace_headers` verified the added fields; decoded
frame MD5/timestamp records were identical for all four pairs. The 30 fps run
retained 90 frames and exactly 3 seconds. A second native fractional-rate run
retained its original 25 frames, `30000/1001` fps and 0.834167 seconds: Mediabunny
had already rounded the requested 29.97 rate on the native path. Repair does not
alter that original timing; the explicit software path represents 29.97 exactly
as `2997/100`.

On the Amlogic frame, filling SPS declarations **did not improve the colour
fault**. With either logo setting and either surface, unrepaired and repaired
chart captures had white `(255,128,128)`, black `(0,128,128)` and source-neutral
patches rendered as `(source,128,128)`. Loop's input/codec diagnostics remained
BT709/full/sRGB in both cases. The software baseline instead produced white
`(255,255,255)` and black `(0,0,0)`. Its SurfaceView neutral patches matched the
source within 1 code value; TextureView remained neutral but used a different
presentation curve (source 128 became 115). These results locate a remaining
problem beyond the absence of SPS declarations, without establishing which
specific backend conversion fails. The native path remains an explicit user
choice with an accurate report rather than a compatibility guarantee.
All 24 chart/ribbon × logo × encoding-copy × surface comparisons reported zero
dropped frames and 33.333 ms loop boundaries. The original Loop preferences were
verified restored, and all uniquely named device test files were removed.

Comparison artifacts are in `colour-test-output/sps-repair/`, including native
inspection reports, the original/repaired streams, Android screenshot samples
and diagnostic dumps. `sps-repair-fractional/` contains the fractional-rate check.

## Existing gallery files

`node apps/rivvon/scripts/audit-gallery-colour.mjs report.json` performs a
read-only HTTP Range audit of the public gallery's MP4 moov, nclx and avcC/SPS.
The audit identified **all eight** files as outside the new explicit AVC/SPS/nclx
contract, for different reasons:

| Gallery ID | Container | Bitstream / action |
| --- | --- | --- |
| `Ye6d1sitg7SBoTF1lQwnc` | 709/sRGB/709/full | AVC with no explicit SPS colour; regenerate or real sRGB/full → 709/limited transcode |
| `PjE4tkSCq_8TBu8N-ZjnF` | 170M/170M/170M/limited | SPS agrees; real 601/170M → 709 conversion or regenerate |
| `bTS18RiP0dYVf17RdXCwp` | 709/709/709/limited | AVC SPS colour absent; regenerate for explicit agreement |
| `7ssfTJLEXCUujRuIHcvWC` | 709/709/709/limited | AVC SPS colour absent; regenerate for explicit agreement |
| `RYYFWwjUDbNq-F6z8kb8G` | 709/709/709/limited | AVC SPS colour absent; regenerate for explicit agreement |
| `3NFsKsfsMmIJyW4Pnpk6N` | 709/709/709/limited | AVC SPS colour absent; regenerate for explicit agreement |
| `uqf5_Gpxokjtn9h9noFgl` | 709/709/709/limited | AVC SPS colour absent; regenerate for explicit agreement |
| `-mp3xqDYvGXHD3_SAPUxr` | 709/709/709/limited | **AV1**, not AVC; regenerate/transcode for the AVC requirement |

Absence of SPS colour does not prove that pixels in those five 709-tagged AVC
files are wrong. Historical encoder metadata also cannot prove their transfer
conversion. Do not silently relabel their samples. Prefer regenerating from
artwork/settings where available. Some historical gallery records have no saved
drawing/render snapshot, so identical scene regeneration is not always possible.

For a real normalization copy, with verified and trusted input colour metadata:

```sh
ffmpeg -i old.mp4 -vf "colorspace=all=bt709:range=tv:format=yuv420p" \
  -c:v libx264 -preset veryfast -crf 18 -pix_fmt yuv420p \
  -color_range tv -colorspace bt709 -color_primaries bt709 -color_trc bt709 \
  -fps_mode passthrough -movflags +faststart+write_colr -an normalized.mp4
```

This filter performs transfer/primaries/matrix/range conversion using declared
input properties. If metadata is absent or incorrect, establish the real input
space before supplying `iall`, `ispace`, `iprimaries`, `itrc`, or `irange` overrides.
Do not use `-c:v copy` plus new colour tags as a substitute. The representative
170M gallery file was normalized **as a local test copy**, preserving 2160×2160,
30 fps, 480 frames and 16 seconds. Its normalization copy also passed Loop's
BT709/limited/SDR diagnostics in both surface modes, with zero dropped frames and
a 33.333 ms loop boundary. The public gallery files were not changed.

## Supported environments and costs

### Native WebCodecs versus Mediabunny bitrate diagnostic

Run the Rivvon Vite development server and open
`/rate-control-test.html?source=/colour-test-output/bitrate-regression/source.mp4`
in the affected browser profile. Supply a detailed H.264 source excerpt at that
local URL, or change `source` to another local source URL. Keep private sources
and generated reports under the ignored `colour-test-output/` directory.
Click **Compare native WebCodecs and Mediabunny**, then optionally **Compare with
explicit quality latency**. This developer-only page is not a production entry.

The comparison decodes three seconds at 30 fps and explicitly converts pixels
to BT.709 limited I420. Each case uses matching AVC High level 5.0 settings,
frame timestamps, durations, and keyframe requests at frames 0 and 60. The native
path calls `VideoEncoder` directly; the Mediabunny path uses `VideoSampleSource`
with explicit bitrate-based `Quality`. Both count encoded packet payload bytes,
excluding MP4 overhead. SHA-256 fingerprints cover every input frame and every
encoded packet, and the JSON records packet timestamps, sizes and frame counts.
No encoder API is intercepted or replaced. Frame buffers are released as the
test advances rather than retaining the full raw sequence in memory.

On 2026-11-15, Chrome 157.0.8103.51 on Windows produced the following results
with the same 2160×2160, 90-frame input in the user's existing Chrome profile:

| Preference | Target Mb/s | Direct WebCodecs Mb/s | Mediabunny Mb/s |
| --- | ---: | ---: | ---: |
| Browser decides | 50 | 7.891821 | 7.891821 |
| Browser decides | 100 | 7.891821 | 7.891821 |
| Prefer hardware | 50 | 7.891821 | 7.891821 |
| Prefer hardware | 100 | 7.891821 | 7.891821 |
| Prefer software | 50 | 49.785064 | 49.785064 |
| Prefer software | 100 | 99.699245 | 99.699245 |

All 16 cases (12 baseline and four explicit-quality-latency cases) encoded all
90 frames and had identical input fingerprints. Native/Mediabunny output
fingerprints matched for each configuration. All hardware/no-preference
outputs also matched across the two bitrate targets; explicit
`latencyMode: 'quality'` made no difference. This reproduces the rate-control
failure below Rivvon/Mediabunny without establishing which native encoder ran.

The Windows driver inventory was Intel Graphics `32.0.101.8860` and NVIDIA
GeForce RTX 5070 Ti Laptop GPU `32.0.15.9201`. This inventory and the canvas GPU
renderer do not establish the GPU selected for video encoding. Browser-tool URL
policy blocked Chrome's internal diagnostics page, so no implementation name
was obtained. A separate fresh headless Chrome run on the same machine did
respond to the bitrate targets, which further limits any claim that this is a
universal hardware limit. The baseline and explicit-latency reports are saved
locally under `colour-test-output/rate-undershoot/native-comparison.json`.

#### Profile and latency follow-up (2026-11-15)

The **Compare latency and profile at 25.928 / 51.856 Mb/s** button runs 32 cases:
direct WebCodecs and Mediabunny, High/Main profile at level 5.0, quality/realtime
latency, CBR/VBR, and two bitrate targets. The targets match the reported
25.928 Mb/s case and twice that rate. Input frames and keyframe requests remain
identical to the earlier comparison; hardware preference remains explicit.
The output decoder configuration's AVC description header is also recorded to
distinguish the requested profile from the profile actually advertised by the
encoded output.

In the same Chrome profile, all 16 High cases produced **7.891821 Mb/s** and
identical encoded packet hashes. All 16 Main cases produced **7.827101 Mb/s**
and identical hashes within that profile. Decoder configuration headers confirmed
profile IDs 100 (High) and 77 (Main): profile changes were reflected in output,
but changing target bitrate, rate mode, or latency did not change encoded bytes
within either profile. All 32 cases encoded all 90 input frames, so the realtime
results did not conceal frame dropping. Input hashes were identical in all cases.
Neither realtime latency nor switching to Main fixed rate control in this
environment. No production encoder setting was changed based on this experiment.

Full results are in the ignored local artifact
`colour-test-output/rate-undershoot/profile-latency-comparison.json`.
The attached 23.6-second CBR example independently measured 7.316684 Mb/s video
payload in ffprobe, with 708 frames at 30 fps, High level 5.0, and first-frame
QP48. The probe is saved as `constant-25928-ffprobe.json` in the same directory.

#### Resolution and frame-shape isolation (2026-11-15)

The **Compare dimensions and bitrate response** button tests direct WebCodecs
at six output sizes, keeping High level 5.0, CBR, quality latency, 30 fps and
hardware preference fixed. The original three-second source is scaled to each
size; the 16:9 controls deliberately stretch the square source. Input hashes
match within each size, not across different resamplings. Four targets test
both low-rate response and the reported high-rate failure:

| Dimensions | 2 Mb/s target | 8 Mb/s target | 25.928 Mb/s target | 51.856 Mb/s target |
| --- | ---: | ---: | ---: | ---: |
| 640×640 | 1.960 | 7.567 | 8.880 | 8.750 |
| 1080×1080 | 1.998 | 6.635 | 8.780 | 8.555 |
| 1920×1920 | 2.074 | 7.421 | 7.593 | 7.593 |
| 2160×2160 | 2.090 | 7.404 | 7.892 | 7.892 |
| 1280×720 | 1.993 | 6.644 | 8.856 | 8.466 |
| 1920×1080 | 2.019 | 7.130 | 8.261 | 8.077 |

These are measured encoded-video payload rates in Mb/s, excluding MP4 overhead.
Four software controls at 1080×1080 and 2160×2160 reached 25.857–25.878 Mb/s
and 51.462–51.771 Mb/s for the two higher targets. All 28 cases encoded all 90
frames, and output timestamps matched the intended 30 fps timeline.

This narrows the earlier statement that hardware ignored bitrate: low targets
do affect output, while high targets show saturation around 7–9 Mb/s on this
source across both square and standard 16:9 dimensions. Reducing resolution did
not restore high-rate control. This is evidence for the tested Chrome profile,
source and fixed codec level, not a universal hardware ceiling or an identified
driver limit. Full local results are saved in
`colour-test-output/rate-undershoot/dimensions-comparison.json`.

#### Cross-codec isolation (2026-11-15)

The **Compare H.264, HEVC, AV1 and VP9** button tests native WebCodecs with
hardware preference, quality latency, the same 2160×2160 limited I420 source,
and both CBR/VBR. Each candidate is checked with `isConfigSupported()` at all
four bitrate targets before encoding. One codec string is held fixed across the
targets in each mode. Alternative HEVC/AV1 tier candidates are available when
the first candidate is rejected; support checks and recognized configurations
are retained in JSON. The selected strings in this run were `avc1.640032`,
`hev1.1.6.H150.B0`, `av01.0.12H.08`, and `vp09.00.50.08`.

| Codec | Mode | 2 Mb/s target | 8 Mb/s target | 25.928 Mb/s target | 51.856 Mb/s target |
| --- | --- | ---: | ---: | ---: | ---: |
| H.264 | CBR | 2.090 | 7.404 | 7.892 | 7.892 |
| H.264 | VBR | 2.090 | 7.404 | 7.892 | 7.892 |
| HEVC | CBR | 10.734 | 10.734 | 11.061 | 11.061 |
| HEVC | VBR | 10.734 | 10.734 | 11.061 | 11.061 |
| AV1 | CBR | 8.017 | 8.651 | 25.663 | 51.150 |
| AV1 | VBR | 8.017 | 8.651 | 25.663 | 51.150 |
| VP9 | CBR | 8.226 | 8.816 | 25.983 | 51.178 |
| VP9 | VBR | 3.738 | 8.922 | 26.498 | 52.200 |

Rates measure encoded video payload, excluding container overhead. All 32 cases
had identical input hashes, encoded all 90 frames and preserved the intended
timestamps. HEVC also shows poor rate control and a higher plateau, while AV1
and VP9 respond to the two higher targets. AV1 and VP9 CBR substantially
overshoot the low target over this three-second test; do not infer accurate
low-rate behavior or a fixed minimum without longer steady-state tests. These
results concern the requested hardware preference in this Chrome environment;
the actual encoder implementation remains unidentified. Those diagnostics
initially ran separately from the production export dialog.

Full local results and capability checks are saved in
`colour-test-output/rate-undershoot/codec-comparison.json`.

#### MP4 (AV1) test export option

The format menu now includes **MP4 (AV1 · test)** alongside MP4 (H.264) and
WebM (VP9). It emits `format: 'mp4', videoCodec: 'av1'` and uses WebCodecs;
FFmpeg WASM/x264 is unavailable for this choice. All three export routes forward
the codec choice, while filename extensions, MIME types and draft containers
remain MP4. Bitrate and constant-QP controls remain explicit; AV1 QP accepts
0–255 and has no hidden bitrate fallback. Browser/device codec support is checked
by the normal Mediabunny configuration path; unsupported configurations stop
instead of silently switching to H.264.

AV1 reuses the selected GPU/CPU BT.709 I420 conversion and limited/full range.
The independent AV1 inspector reads sequence-header OBUs from encoded packets,
and the completed report compares their colour declarations, bit depth and
subsampling with MP4 nclx declarations and the requested output. Missing limited
declarations remain warnings; known conflicts or malformed inspection fail
explicit-range export, and full range retains strict verification. H.264 SPS
repair is never run on AV1 output.

The actual dialog was exercised in Chrome 157.0.8103.51 with 640×360, 30-frame
colour-chart exports in limited VBR, full VBR and full QP23. FFprobe independently
confirmed AV1, 8-bit 4:2:0, 30 fps, one second and all 30 frames for limited/full
VBR, with BT.709 primaries/transfer/matrix and matching range flags. Decoded
interior chart patches differed from the expected converted YUV values by at
most 3 levels for limited and 4 for full. Limited white/black decoded as 235/17;
full white/black as 255/0. Full QP23 also completed with matching sequence-header
and container declarations, with no bitrate in the native encoder config.
These are environment-specific checks, not a guarantee for other encoders or
players. Artifacts are in the ignored `colour-test-output/av1-menu/` directory.

### H.264 constant-QP isolation (15 November 2026)

The same detailed three-second source used for the bitrate comparisons was
encoded at 2160×2160, 30 fps, BT.709 limited I420, High profile Level 5.0
(`avc1.640032`), quality latency, two-second keyframe requests. Chrome
157.0.8103.51 received `bitrateMode: 'quantizer'` without `bitrate`, and each
frame received `avc: { quantizer }`. Mediabunny received only
`new Quality({ quantizer })`, with the same fixed codec string and inputs.

| QP | Hardware-preferred payload Mb/s (native and Mediabunny) |
| --- | ---: |
| 16 | 196.226 |
| 20 | 140.570 |
| 24 | 101.422 |
| 28 | 71.448 |
| 32 | 47.443 |
| 36 | 29.734 |

All twelve hardware-preferred cases encoded all 90 frames. Input hashes were
identical across the sweep, and native/Mediabunny encoded packet hashes matched
at every QP. Independent FFmpeg `trace_headers` inspection of all 90 slices in
each saved Mediabunny MP4 confirmed `26 + pic_init_qp_minus26 + slice_qp_delta`
equalled the requested QP throughout. FFprobe confirmed 90-frame, three-second
H.264 High Level 5.0 tracks. Software-preferred WebCodecs QP configurations were
unsupported at these settings in both paths; no bitrate fallback was used.

This bypasses the earlier 7–9 Mb/s plateau on this Chrome/backend combination.
It does not identify which component caused the VBR/CBR problem or guarantee
behaviour on other drivers. QP supplies no application bitrate ceiling or file
size guarantee. Profile/level compatibility and browser memory limits remain:
for example QP16's measured average exceeds High Level 5.0's 168.75 Mb/s MaxBR,
calculated from [Chromium's H.264 level table and High-profile multiplier](https://chromium.googlesource.com/chromium/src/+/lkgr/media/parsers/h264_level_limits.cc).
No full HRD/CPB conformance or target-player playback test was performed here.

The diagnostic's **Compare H.264 QP 16–36 without bitrate** button reproduces the
sweep. Optional `saveQp=1` also saves MP4s when the local capture middleware is
running. Full report, MP4s, slice verification and browser screenshot are under
the ignored `colour-test-output/qp-sweep/` directory.

AV1's input bound was also corrected from 63 to 255, matching the installed
Mediabunny codec registry and the [current AV1 WebCodecs registration](https://www.w3.org/TR/webcodecs-av1-codec-registration/#av1-encode-options).

### Platform requirements

The default FFmpeg MP4 export requires WebAssembly, module workers, readable canvas pixels and a
Canvas2D context that confirms sRGB. It does not require VideoEncoder or
SharedArrayBuffer/COEP. Chrome and Edge on Windows were tested. Safari/Firefox,
other GPUs, colour-managed wide-gamut monitors and WebGPU scenes need their own
render/readback comparison; unsupported contexts fail rather than falling back
to an unverified native MP4 encoder. Explicitly selecting WebCodecs requires a
supported browser/native AVC configuration and makes no deterministic colour
promise; the final report documents the observed result.

Odd dimensions are rejected with a clear message, without padding/resizing.
8-bit 4:2:0 requires even dimensions. Frame rates up to 120 fps with up to six
decimal places are accepted. Original dimensions and requested rates are kept.
Very long exports can still hit browser/WASM memory limits: raw batch memory is
bounded, but the complete compressed stream and MP4 are held in memory.

The lazy-loaded core adds about **32 MB** of WASM plus its JS wrapper and encodes
on the CPU. High-resolution export can be slower than native WebCodecs. Short
batch GOPs may change size/quality at the same bitrate, especially at 4K. No
claim is made that arbitrary scenes render identically across GPUs.
Normal WebCodecs exports do not load this core for metadata repair. Diagnostic
comparisons can explicitly request repair of eligible missing SPS declarations;
that pass copies the compressed stream and does not re-encode it.

The core is GPL-2.0-or-later (including x264), while the wrapper is MIT. See
`apps/rivvon/public/licenses/ffmpeg/NOTICE.md` and the shipped GPL text for
distribution/source-packaging requirements. Deployment must serve the copied
`/vendor/ffmpeg/0.12.10/` assets; they are bundled locally, not fetched from a
floating CDN version. The lab and generated large test files stay out of the
production app and Git history.
