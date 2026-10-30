# Clip resources and looping backgrounds

Implemented locally. Browse → Clips opens `/clips` over the existing scene. Clips are private source resources and are separate from rendered results in the Video Gallery. Uploading does not change the scene; Apply as background selects the clip and enables Background Media (the former Static Texture section).

Background Media accepts one image or clip, retaining cover fitting, vertical alignment, Normal/Soft Light blending, flips, contrast, saturation, gradient mapping, and the existing background composition. A change from another source kind to a clip defaults to Normal. Playback is muted; embedded audio is ignored, and original file bytes are retained. Pause/Play affects live playback only. Exports animate the clip using their own synthetic clock.

## Formats and storage

- Self-contained MP4, MOV/QuickTime, WebM, MKV/Matroska, MPEG-TS, and Ogg video files that Mediabunny can read. Upload checks the detected primary video track, browser decoder capability, and an actual decoded first frame. No H.264-only codec/profile allowlist is applied. Playlists and external stream segments are excluded.
- At most 1 GB (1,000,000,000 bytes), 60 seconds, 60 fps, 3840 pixels on the longest side, and 3840 × 3840 pixels total.
- A decoded first frame becomes a poster of at most 512 pixels on either side. Uploads run sequentially with progress, cancellation, and retry.
- The API accepts small uploads through the existing bounded stream endpoint. Clips above 64 MiB use R2 multipart uploads with sequential 8 MiB requests, so the 1 GB file limit does not depend on accepting a 1 GB Worker request. `clip_upload_sessions` records owner-scoped multipart state for cancellation and expiry cleanup; each chunk is streamed through a fixed-length stream. Part retries reuse the same part number, and assembly is idempotent. It verifies the actual container MIME, readable video codec configuration, dimensions, duration, size, and the thumbnail before finalization. Media inspection uses bounded R2 ranges and an explicit read budget. No Worker-side video decode or transcoding is required.
- Immutable objects use unique keys per attempt. Finalization, deletion, and late upload requests use conditional state transitions. Scheduled cleanup removes expired uploads, aborts unfinished multipart sessions, and retries deletions. The inspection byte budget remains 128 MiB independently of the 1 GB file limit; the API reads media metadata by range rather than buffering the full file.

Owner or preset access is required for metadata, posters, HEAD, and byte-range playback. Responses use private, no-store caching. Preset dependencies are retained even when Background Media is disabled. A visible preset grants read access to its registered clip; derivative presets retain their own dependency. Deleting a preset keeps its clip. Deleting a clip reviews and rechecks linked-preset deletion, following the image library's existing consent behavior.

## Automatic speed alignment

Original speed plays the clip at 1× independently. **Speed up to align with loop** chooses the minimum speed increase that completes a whole number of clip repetitions in the target loop:

```text
repetitions = ceil(targetDuration / clipDuration)
speed = repetitions × clipDuration / targetDuration
```

For a 12-second loop, an 8-second clip repeats twice at 1.333×; a 20-second clip plays once at 1.667×; a 6-second clip stays at 1×. Durations and sample mapping retain full precision; the UI rounds only the displayed numbers.

During ordinary viewing the target is the scene cycle. Export settings preview the selected target period. Automatic export quantizes one cycle to a whole number of output frames, then repeats that cycle for the requested loop count. Manual duration aligns the clip to the encoded file's actual duration. Camera preparation can update an automatic export duration; the exporter resolves the final rate after that preparation and reports it in export status. Clip alignment does not retime other artwork, camera motion, or audio.

Matching phase does not remove a cut in the source clip between its ending and beginning. No hidden crossfade or interpolation is applied. Extremely high rates are not silently capped. If a device cannot represent the calculated native playback rate, the player switches to timestamp-directed decoded playback. It keeps one live decode in flight and drops obsolete live samples rather than accumulating work; exports still await every requested frame.

## Rendering and exports

Each consumer owns its native player, canvas texture, and mutable decoder state. The texture uses native playback when supported and a Mediabunny canvas-decoding fallback when the native player cannot play the container, fails, or cannot represent the requested speed. The library preview uses the same adapter with accessible Play/Pause controls, so accepting a file does not depend on native video-element compatibility. Frame-accurate exports in both the main scene and texture overview decode the sample at the requested presentation timestamp with Mediabunny, draw it into that same canvas texture, render, then encode. Clip sampling is independent of existing texture-array RIFE/crossfade interpolation. Nonzero track origins and variable frame rates use presentation timestamps. Source frames are drawn into the existing SDR/sRGB scene canvas; this does not add HDR export or transcoding. Original bytes and the detected container MIME are preserved, including multipart uploads.

Still images and preset thumbnails freeze the current clip phase while capturing. Video export starts at clip phase zero, pins a timing plan, and restores live playback on completion, cancellation, or failure. Missing enabled resources reject export. Renderer changes, source replacement, disabling the layer, account changes, and teardown release media resources. Reduced-motion users start paused with an explicit Play action.

Preset schema 3 stores the stable clip reference and playback mode. Schemas 1 and 2 remain readable and migrate with their existing image appearance. Runtime durations, rates, pause state, media URLs, decoder state, and GPU resources are excluded from saved artwork. Existing source-setting and transient grant field names remain compatible with the image implementation.

## Validation and release

The frontend/API test suites cover timing, frame preparation order, failure cleanup, persistence/migrations, private access, range responses, verified upload completion, immutable writes, linked-preset consent, and expiry. Large-upload tests exercise the exact 1 GB boundary with a virtual file (without allocating or uploading a gigabyte), bounded parts, retry receipts, ownership, assembly races, cancellation, and cleanup. `pnpm --filter rivvon test:clip-background` runs a real Chromium check for native playback, synthetic sample changes, exact first-frame pixels after repeated wraps, WebGL/WebGPU sharp/blurred backgrounds, library preview, focus return, Apply, and clearing private cards on sign-out. Generated fixtures cover MP4/H.264, HEVC, AV1, MOV, WebM/VP9, MKV/VP9, and MPEG-TS with a nonzero timeline origin. Browser checks verify generic-MIME uploads, first-frame probes, live playback, decoded fallback, and exact export wraps. HEVC reports an actionable first-frame decode failure on the tested Windows Chromium host despite its advertised codec capability; support remains device dependent.

Before release:

1. The private R2 bucket `rivvon-clips` was created with Wrangler on 2026-10-29 and its r2.dev access was verified disabled. `CLIPS_BUCKET` is declared in `apps/api/wrangler.toml`. Keep delivery private.
2. Apply cumulative D1 migrations through `015_clip_multipart_uploads.sql`. Migration 014 preserves texture, audio, and image dependency rows and recreates their integrity triggers/indexes; migration 015 adds multipart upload sessions. Deploy the migrated API before the frontend that uploads large clips.
3. Deploy the API that accepts preset schemas 1–3, then the frontend that writes schema 3.
4. Verify authenticated cross-origin upload/range playback, shared presets, and export against actual deployed storage. Local tests do not exercise production cookies or bucket configuration.

Chromium WebGL/WebGPU is exercised locally. Safari/mobile compatibility, 1080p performance on low-power devices, and extreme-rate preview behavior still need device verification. No remote migrations or deployments were run for the format-support change. It needs no database migration; deploy the API accepting the additional detected MIME/container types before the frontend. Existing MP4 clips remain compatible. The standalone API TypeScript check retains existing errors in unchanged audio upload, video routes, and texture-upload tests; the clip routes add no TypeScript errors.
