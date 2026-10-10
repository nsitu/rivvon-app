# Deterministic SDR video exports

By default, MP4 exports convert displayed sRGB canvas pixels to BT.709 transfer and
limited-range 8-bit I420, encode with pinned browser-local x264, and mux AVC MP4.
Every encoded batch's SPS and the final MP4 nclx/SPS are checked before returning
the file. This applies to scene exports, live texture overview exports, and the
standalone texture overview exporter. WebM remains the existing WebCodecs path.
No Loop source changes or player colour compensation are involved. The export
dialog also offers the original WebCodecs/CanvasSource AVC path as an explicit
choice, with a final colour report instead of a claim of deterministic conversion.

## Encoder choice and final reports

For MP4, choose **FFmpeg WASM** (the default) or **WebCodecs**. FFmpeg performs
the explicit conversion described below. WebCodecs retains the original canvas
capture and optional transparent 2D logo compositor, native AVC encoding and
Mediabunny muxing. A completed WebCodecs MP4 is inspected and, when eligible,
missing SPS declarations are added with FFmpeg's `h264_metadata` stream-copy
filter. This is metadata repair, not colour conversion. WebM uses
WebCodecs/VP9. The optional WebCodecs preference is browser decides, prefer
hardware or prefer software; these are hints, not confirmation of the encoder
actually selected. Unsupported native configurations fail without an automatic
switch to another method.

Every completed export shows a colour report in the dialog, with a downloadable
JSON file. MP4 reports inspect the final MP4 `nclx` and every SPS in `avcC`,
including range, primaries, transfer, matrix, chroma format and bit depth. Missing
fields remain **not declared**; conflicting fields are reported. Native files
remain downloadable even when the declarations differ from the SDR target. A
native file with matching declarations is still labelled as having unverified
browser-managed pixel conversion. WebM reports encoder output colour metadata;
its container and VP9 bitstream are explicitly marked as not independently
inspected.

### Missing SPS declarations on WebCodecs exports

The repair runs only when MP4 `nclx` and all observed encoder output colour
configurations provide complete, consistent declarations. Any already-declared
SPS fields must agree. Missing/unspecified SPS fields are filled with those
**observed output values**, not the desired BT.709 limited target. Existing
conflicts or insufficient evidence leave the original file available with an
explanation in the final report. Already-complete SPS declarations need no
repair tool. A tool failure or changed frame timing fails the export rather than
returning an incorrectly repaired file.

For the measured Chrome native output this means `1/13/1/full` (709 primaries,
sRGB transfer, 709 matrix, full range), not `1/1/1/limited`. The pinned local
FFmpeg WASM core applies [`h264_metadata`](https://ffmpeg.org/ffmpeg-bitstream-filters.html#h264_005fmetadata)
with `-c:v copy` and writes agreeing container fields. There is no re-encode or
sample conversion. The original movie/video clocks, sample durations,
composition offsets, edit-list presentation, frame count, dimensions and pixel
format must survive inspection unchanged. Cancellation terminates the repair
worker. The final JSON records original SPS values, applied filter, final
declarations and whether repair was added, unnecessary or skipped.

This can address decoders that mishandle absent bitstream declarations. It cannot
establish that the browser's RGB-to-YUV conversion was correct or normalize
full-range/sRGB/601 samples. FFmpeg WASM encoding remains the default for the
conventional BT.709 limited contract.

Reports capture the input `VideoFrame.colorSpace` (using the same canvas
constructor as CanvasSource), the first useful encoder output decoder config,
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
implementation produces bad video. Even on the same PC, the measured Chrome
hardware/no-preference output is full-range sRGB-transfer with missing SPS
colour, while software preference and Edge produce limited-range sRGB-transfer
with explicit SPS colour. Neither is the requested all-BT.709 contract.

There is a credible future native path: convert to real BT.709 limited I420
ourselves, construct a raw I420 VideoFrame with accurate colour metadata, and
encode via Mediabunny's VideoSampleSource. This eliminates implicit RGB-to-YUV
input conversion, but still needs real decoded chart-value checks, SPS/container
verification and fallback on each supported browser/backend. It has not been
validated as a production alternative here. Browser/backend fixes and additional
standardized controls could improve portability; there is no promised support
date. The final reports and repeatable chart make improvements measurable.

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
 → @ffmpeg/core 0.12.10 / libx264, single thread, no B frames
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
The batches concatenate into one elementary stream and remux without re-encoding.
The final movie, media, sample and edit-list duration fields are set from the
original CFR clock. This avoids FFmpeg raw-AVC timestamp and final-duration
rounding, verified with an independently decoded binary marker on every frame.

The existing synthetic render clock, `ceil(duration * fps)` frame count, texture
ticks and camera animation remain intact. No endpoint frame is added. Original
renderer dimensions, pixel ratio, camera and controls state are restored on
success, cancellation or error. Progress reserves its final 5% for muxing and
verification. Cancellation terminates the WASM worker rather than finishing and
returning an incomplete loop.

All five presets retain Mediabunny's AVC target bitrate formula: 3 Mbps at 1080p,
scaled by pixel count to the power 0.95, with multipliers 0.3/0.6/1/2/4. Actual
file sizes and compression differ because x264 replaces the native encoder and
each batch starts a new GOP. The existing white logo, shadow, size and corner
layout are reused before colour conversion.

## Repeatable comparison workflow

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
WebCodecs also loads this core when missing SPS declarations require repair;
that pass copies the compressed stream and does not encode on the CPU. Complete
or ineligible native SPS declarations do not load the core for repair.

The core is GPL-2.0-or-later (including x264), while the wrapper is MIT. See
`apps/rivvon/public/licenses/ffmpeg/NOTICE.md` and the shipped GPL text for
distribution/source-packaging requirements. Deployment must serve the copied
`/vendor/ffmpeg/0.12.10/` assets; they are bundled locally, not fetched from a
floating CDN version. The lab and generated large test files stay out of the
production app and Git history.
