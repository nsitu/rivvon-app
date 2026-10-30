# Sampled background videos

The video creator offers **Ribbon textures** and **Background video** outputs
from the same selected input. Background generation produces one square
wave-sampled MP4 and saves through the existing private Clips upload path.
Switching between output types preserves the source and retained background;
neither animation nor sampling settings need to match the ribbon textures.

An optional KTX2 array representation is recorded in the
[deferred KTX2 background exploration](background-ktx2-exploration.md), including
GPU/memory limits and whether backgrounds need mipmaps. Implementation is deferred.

## Try it

Open Create with a video source and select **Background video**. Choose the long
or short sampling side, square size, loop duration, starting source frame and clip name, then **Generate
Background**. Progress and cancellation use the creator's existing Process step;
the Done step offers loop preview, download, **Save to Clips**, and **Open Clips**.
The viewer is suspended while generating. Navigating away stops generation;
already committed work is retained on the device.

Background settings retain the source-video preview with playback, seeking and
wave sampling lines. The overlay uses the selected background side and phase
settings, independent of ribbon crop/interpolation settings. Changing the start
frame seeks the source preview to that position. The preview stacks above the
settings on narrow screens and sits alongside them on wider screens.

The production encoder is the existing verified SDR FFmpeg WASM/x264 path, with
one worker per batch, high quality, no audio and no export logo. Saving to Clips
requires sign-in. Upload failures retain the local result for retry. Completed
videos appear under **On this device** and can be recovered after reload without
selecting the source again. Fully encoded interrupted jobs offer **Finish video**;
partially sampled jobs can be discarded. Discarding asks for confirmation and
removes local work only. Publication records are scoped to the signed-in user.

The standalone `/background-loop-lab.html` remains available on the development
server (`pnpm --filter rivvon dev`) for batch-size and encoder experiments,
including optional WebCodecs. That lab is excluded from production build entry
points. It uses PrimeVue controls and shared scrolling/actions, with no viewer
shell. Its work files are shared with the integrated creator.

## Revised sampling model

- Output is square, optimized for square frames. Cover cropping on rectangular
  displays is expected.
- Output frame rate is 30 fps. Duration selects phase count, rounded to a whole
  frame: `phases = round(seconds * 30)`. Minimum is 30 phases/one second; default
  is 240 phases/eight seconds, reduced when the input cannot support that count.
- The phase ceiling follows the input dimension perpendicular to the sampled
  line: the short edge when sampling the long edge, and the long edge when
  sampling the short edge. For 1920 × 1080 input, long-side sampling allows up to
  1920 square and 1080 phases/36 seconds; short-side sampling allows up to 1080
  square and 1800 phases/60 seconds. The existing clip duration limit adds a
  1800-phase/60-second ceiling for larger inputs; extending that is a separate
  product decision.
- The largest square without enlarging samples is the smaller of the chosen
  spatial edge, available source frames and 3840, rounded down to an even size.
  Changing sides clamps the selected size/duration only when the new limits
  require it, and preserves the side when switching between output types.
- A square of side S consumes S successive source frames, each contributing one
  row/column. S is independent of the number of output phases. The starting
  source frame is selectable in background settings.
- Waves retain the existing tile builder's amplitude, sampling and orientation.
  Output phase j is `2π * j / phases`. The endpoint is excluded. Global phase
  offsets prevent a new cycle from starting at each sampling batch.
- Low phase counts are an artistic choice. No motion-based rejection or hidden
  smoothing is applied.
- Source frames are counted in presentation order. Rotation/aspect adjustments
  are normalized before sampling. Transport-stream preparation and the existing
  supported Sony interlaced path are reused. Arbitrary crop selection, RIFE,
  and planes/ping-pong are not exposed for background videos.

## Memory and persistence

Each pass allocates a limited set of phase surfaces, decodes the source range,
and assembles those phases. Completed phases feed the existing video exporter.
An independently decodable MP4 batch is committed to IndexedDB before starting
the next sampling pass; its memory and canvases can then be released.

The default phase surface budget is 256 MiB and requested batch size is sixteen.
At 1920 square that is sixteen surfaces/225 MiB and fifteen passes for 240 phases.
At 3840 square it reduces to four surfaces/225 MiB. This budget does **not** include source/normalization surfaces,
GPU readback, encoder staging, WASM heaps or browser-managed memory. The current
Canvas implementation deliberately establishes a baseline before GPU tuning.

Assembly opens one stored batch at a time, validates its decoder configuration,
keyframe start, timestamps and frame count, and forwards encoded packets to
Mediabunny. It does not decode/re-encode frames or concatenate MP4 files. The
result is a fragmented MP4 written through an append-only stream to separate
IndexedDB output parts. A final Blob references those stored Blobs, avoiding an
explicit full-file ArrayBuffer join. Browser Blob residency remains an
implementation detail, not a hard process-memory guarantee.

Encoded batches are retained for assembly retries. Partial/cancelled sampling
jobs are listed for disposal; resuming sampling is not implemented. IndexedDB
quota/write errors fail the operation rather than silently buffering in memory.
Completed outputs and intermediate batches both consume storage until discarded.
This is temporary local work, not a backup or a published clip.

## Benchmark and validation

Run `pnpm --filter rivvon benchmark:background-loop` for the full benchmark, or
append `--quick` for a small smoke test. `BROWSER_BINARY` can select Chromium;
`BACKGROUND_LOOP_OUTPUT_DIR` changes the output directory.

Run `pnpm --filter rivvon test:background-loop-workflow` for the integrated browser
check with an isolated local test API. It exercises actual file selection,
duration controls, generation, all-frame decode, video/poster upload and
finalization, output switching with the same source, and recovery after reload.
Desktop/mobile settings and result screenshots are captured under `integration/`.

The driver starts a local Vite server and isolated headless browser profile. It
creates a deterministic animated source MP4, then measures the actual sampler,
FFmpeg encoder, IndexedDB transactions and packet assembly. Default cases are
512 square/one second and 1920 square/eight seconds from a 1920 × 1080 source
containing 1920 frames. Source generation and final decode verification are
excluded from generation timing.

Browser checks compare every raw phase against an unbatched reference, including
a partial last batch, landscape input and rotated portrait input. They exercise
cancellation, reassembly from committed batches, actual clip validation and
decoding every final frame to verify its timestamp, count and duration.

Outputs are written under `apps/rivvon/colour-test-output/background-loop/full/`
(or `quick/` for the smoke test, so it cannot overwrite a full benchmark):

- `report.json`: per-batch timings, decode work, output size, surface estimate,
  observed JS heap, source, browser and host facts.
- `sampled-background.mp4`: the final/largest measured output.
- `*-poster.png`: output frame previews.
- `lab-desktop.png`, `lab-mobile.png`: prototype layout captures; the driver also
  checks horizontal overflow at both widths.

JS heap measurements exclude GPU, decoder and WASM allocations; they must not be
reported as total memory usage. Synthetic gradients and moving hard edges test
the mechanics, not compression behavior for every artist's footage. Repeated
passes and encoder initialization per batch are intentional baseline costs to
measure before adding a source cache or persistent encoder service.

### Measured baseline: 30 October 2026

The [full measurement record](background-loop-benchmark-2026-10-30.json) was
captured on Windows with an Intel Core Ultra 9 275HX, headless Chrome 156,
Canvas sampling and FFmpeg WASM/x264. Source generation took 9.68 seconds and is
excluded from these totals.

| Output | Phases | Source passes | Generation | Assembly | File size |
| --- | ---: | ---: | ---: | ---: | ---: |
| 512 square, 1 second | 30 | 4 | 10.61 s | 17.8 ms | 79.3 KiB |
| 1920 square, 8 seconds | 240 | 30 | 302.55 s | 81.2 ms | 9.58 MiB |

The larger case decoded 57,600 source frames. Stage totals were 239.23 seconds
waiting for decoded samples, 15.85 seconds drawing/assembling samples, 46.57
seconds encoding/finalizing independent batches, and 139 ms committing encoded
batches. Async decoder prefetch can shift work between the decode/draw stages;
total elapsed time is the reliable comparison. JS heap samples peaked at
62.7 MiB, while phase surfaces alone were estimated at 112.5 MiB: those figures
measure different allocations and cannot establish total peak memory.

All 240 final frames decoded with the expected timestamps and eight-second
duration. Reassembly from stored batches passed. A subsequent quick check also
passed through the optional WebCodecs path. That small check is functional
coverage, not a high-resolution encoder performance comparison.

### Integrated default: 256 MiB

The [larger-budget measurement](background-loop-benchmark-256mib-2026-10-30.json)
uses sixteen phases per pass on the same host, browser, source recipe and encoder.

| Output | Phases | Source passes | Generation | Assembly | File size |
| --- | ---: | ---: | ---: | ---: | ---: |
| 512 square, 1 second | 30 | 2 | 5.08 s | 12.3 ms | 79.5 KiB |
| 1920 square, 8 seconds | 240 | 15 | 172.95 s | 61.7 ms | 8.78 MiB |

For 1920 square this is 43% less elapsed time (1.75× throughput). Decoded source
frames halved from 57,600 to 28,800. Measured decode waiting fell to 120.89 seconds,
sampling draws took 9.68 seconds, encoding 41.86 seconds and batch persistence
99 ms. Phase surfaces increased from 112.5 to 225 MiB; observed JS heap peaked
at 69.0 MiB, still excluding GPU, decoder and WASM allocations. All 240 output
frames, timestamps and reassembly checks passed. These are individual synthetic
runs, not a statistical performance guarantee for other footage or devices.

Further optimization should target repeated source decoding, such as reusable
decoded source data or sampled strips on disk. GPU-only sampling optimization
would leave most of this measured cost in place. Keep compressed batch persistence
and streamed packet assembly: their measured overhead remained small.

## Clip policy

Client preparation and API finalization now share a 3840 × 3840 pixel limit.
The other clip limits remain 1 GB, 60 seconds and 60 fps. Browser decoder support
and a successfully decoded first frame are still required. Raising the limit
does not imply every device can play/export 3840-square media at full rate.
