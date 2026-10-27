# CPU versus GPU YUV conversion benchmark

Measured 27 October 2026 on Windows build 26300, Intel Core Ultra 9 275HX,
Intel Graphics through ANGLE/D3D11, with headless Chrome and Edge 156. These
results describe this device and workload, not every browser or GPU.

The shader path was faster after including readback. For production ribbon
geometry/materials, complete frame preparation improved by 2.8–4.6×. Complete
WebCodecs exports improved by 1.5–2.3×. The smaller export gain reflects the
remaining compression, queue draining, muxing and colour verification costs.

## Frame preparation

Each timed frame includes a fresh GPU render, opaque sRGB composition,
readback/conversion to BT.709 limited I420, and construction/closing of the raw
`VideoFrame`. CPU uses the production `willReadFrequently: true` compositor;
GPU uses `false`. Both use the production converter and identical scene states.
The output buffer is reused, as in the application.

Median milliseconds per frame for the animated ribbon:

| Resolution | Chrome CPU | Chrome GPU | Speedup | Edge CPU | Edge GPU | Speedup |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 960×540 | 5.77 | 2.07 | 2.79× | 5.40 | 1.76 | 3.06× |
| 1920×1080 | 18.57 | 5.93 | 3.13× | 17.49 | 4.48 | 3.90× |
| 3840×2160 | 72.30 | 15.75 | 4.59× | 70.14 | 15.33 | 4.58× |

A second fixture uses full-frame deterministic random RGB through the same
production tile material. It stresses conversion rather than representing an
ordinary ribbon scene. Chrome CPU/GPU medians were 10.94/2.39 ms at 540p,
41.18/7.54 ms at 1080p and 160.63/25.38 ms at 4K (4.57–6.33×). Edge showed
4.68–6.48×. Content affects the CPU cost considerably, so the stress-case gains
should not be substituted for the representative ribbon results.

Each method has 72 measured frames per resolution/content/browser: three
rounds of 24, excluding eight warm-up frames per block. Order alternates
CPU/GPU, GPU/CPU, CPU/GPU. Per-frame stage timings, p95 values and ranges are
in the [measurement record](yuv-conversion-benchmark.json). GPU work may be
charged to a later synchronizing composition/readback call; total frame time
is the comparison metric. Stage medians need not sum to the total median.

## Complete WebCodecs exports

Each export contains 60 animated ribbon frames at 30 fps, requests hardware
AVC encoding at Very High quality, uses limited I420 and omits the logo. Both
methods run through `createCanvasVideoExport`, including writer/converter
setup, rendering, frame submission, final encoder drain, Mediabunny muxing,
eligible SPS metadata repair and final colour declaration verification.

Median wall-clock seconds to export the two-second clip:

| Resolution | Chrome CPU | Chrome GPU | Speedup | Edge CPU | Edge GPU | Speedup |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 960×540 | 0.566 | 0.370 | 1.53× | 0.566 | 0.368 | 1.54× |
| 1920×1080 | 1.418 | 0.664 | 2.14× | 1.392 | 0.658 | 2.12× |
| 3840×2160 | 4.588 | 2.042 | 2.25× | 4.711 | 2.073 | 2.27× |

Each cell is the median of three complete exports, with alternating order:
36 timed exports across the two browsers. Every export established the
requested colour declarations and retained the requested converter method.
Separate warm-up traces observed the Media Foundation hardware encoder at all
three resolutions in both browsers. Tracing was disabled during timed samples.

Dependencies and repair-tool assets were fetched during warm-up. First-use
download/compilation costs are not included in these medians; the warm-up
exports and their costs are recorded separately. Per-export GPU context/shader
setup is included. These are offline export throughput measurements; 30 fps
sets the output timestamps and does not impose a realtime deadline.

This measures browser hardware AVC compression, not FFmpeg WASM/x264
compression. Both application encoders share the converter, but software
compression may dominate total time differently. Prior pixel-accuracy checks
are recorded in [GPU YUV validation](gpu-yuv-validation.json); this benchmark
checks converter selection and output colour declarations and does not replace
those decoded-pixel tests.

## Reproduction

Run one browser benchmark at a time from `apps/rivvon`:

```powershell
$env:BROWSER_BINARY = 'C:/path/to/chrome.exe'
$env:COLOUR_OUTPUT_DIR = 'colour-test-output/yuv-benchmark-chrome'
pnpm benchmark:yuv
```

Repeat with Edge and a different output directory. The script saves full
per-frame samples, individual export timings, warm-up traces and the environment
under the selected directory. Large raw records stay outside Git; the committed
[measurement record](yuv-conversion-benchmark.json) preserves summaries, p95/range
statistics, individual export runs, warm-up costs and methodology.

The benchmark is a development script; it changes no production export settings
and runs no conversion during normal viewer navigation.
