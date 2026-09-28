# Sony A7 AVCHD deinterlacing

Create Texture supports the format verified in the repository's `00023.MTS`:
1920×1080, 59.94 fields/s, top-field-first, H.264 High level 4.0, 8-bit
4:2:0, separate coded field pictures with matching presentation timestamps.
Recognition checks the SPS and every field pair, rather than trusting a file
extension or assuming that every Sony recording has this format. Other interlaced
cadences, resolutions, bit depths, and frame-coded interlacing are rejected with
an explicit error. Progressive transport streams retain their existing path.

The example contains 960 encoded field packets, 480 decoded interlaced frames,
and 960 output progressive frames (60000/1001 fps, 16.016 seconds). Treating
each packet as a complete frame led to incorrect dimensions/timing and the
reported stall at tile 2, frame 220. Remuxing alone does not repair that assumption.

## Processing

1. Mediabunny demuxes the original MTS. A cached MP4 remux remains available for
   the browser's setup preview; a WeakMap associates it with the original source.
   The A7 remux explicitly preserves all fields, corrects the SPS-derived dimensions,
   and normalizes the full presentation timeline, fixing the previous 536px height
   and truncated beginning in setup playback.
2. Native WebCodecs `VideoDecoder` decodes field pairs, using software preference
   for interlaced AVC compatibility. Output presentation timestamps are validated
   directly; Mediabunny's packet-to-sample timestamp mapping is bypassed.
3. Three reusable full-resolution YUV frames feed a WebGPU BWDIF shader. Both
   fields are emitted in temporal order. The native field's scanlines are retained;
   temporal/spatial reconstruction fills the other lines. Static fine detail is
   preserved. At the first/last field, BWDIF's cubic spatial boundary filter is used.
4. Deinterlaced Y, U, and V are converted to BT.709 limited-range RGB on the GPU.
   Only then do existing crop, scale, interpolation, tile assembly, and KTX2
   encoding run. No FFmpeg binary or FFmpeg WASM runs in the application.

The software decoder's I420 planes must be copied/uploaded. Reconstructed pixels
remain on the GPU until the existing texture pipeline needs readback. Decoder
backpressure and a three-slot GPU ring bound working memory independently of clip
length. Selected ranges decode reference preroll from the beginning, then upload
only the preceding frame and requested range. Cancellation closes native frames,
the decoder, demuxer, and GPU resources. Stalled decoding/GPU work has a 30-second
watchdog; early EOF and GPU failures become visible processing errors.

WebGPU and a WebCodecs decoder producing native I420 are required. There is no
lower-quality bob fallback. This path is verified in Windows Edge with an Intel
GPU; other browser/OS decoder implementations still need validation. BWDIF
preserves static vertical detail but cannot guarantee exact reconstruction of
moving detail that was never captured in a field. Setup playback uses the
browser's own playback/deinterlacing behavior; the BWDIF path is for texture input.

## Regression checks

Run from the repository root:

```
pnpm --filter rivvon test:run
pnpm --filter rivvon test:deinterlace
pnpm --filter rivvon build
```

The browser test starts its own Vite server and isolated headless Edge/Chrome
profile. Set `BROWSER_BINARY` when the browser is not in a default location.
It requires real WebGPU and WebCodecs support and uses the tracked `00023.MTS`.
It verifies all 480 decoded pairs, 960 progressive timestamps/dimensions, selected
ranges, cancellation, premature EOF, GPU failures, and three complete
256×256×60-layer KTX2 textures. Six native-YUV SHA-256 references cover both
fields at the beginning, middle, and end. A static alternating one-pixel-line
pattern checks that both outputs preserve full vertical detail.

The golden YUV references were generated offline using native FFmpeg's BWDIF
(n4.1), which the WGSL arithmetic follows. For example, the middle pair:

```
ffmpeg -i 00023.MTS -an -vf "bwdif=mode=send_field:parity=tff:deint=all,trim=start_frame=598:end_frame=600" -vsync 0 -pix_fmt yuv420p -f rawvideo reference.yuv
```

Hash each 3,110,400-byte frame separately. Use ranges 0:2 and 958:960 for the
boundary references. `-vsync 0` matters: timestamp synchronization must not drop
the beginning of the reference sequence. FFmpeg is only an offline test oracle.

The shader's LGPL-2.1-or-later license, attribution, and source are distributed
under `licenses/bwdif/` in the app build and maintained beside the shader source.
