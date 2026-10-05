# Audio library activation and reactive viewer feasibility

Investigated 2026-10-05 against the repository and browser API documentation. The assessment below records the design before implementation. The live feature is now implemented and tested with an isolated browser audio fixture and a real production audio asset. Mobile Safari remains unverified.

Implementation follow-up: library/player **Use in viewer** actions now activate a shell-owned transport with play/pause, seeking, looping, volume/mute, and removal. Its settings expose an opt-in amplitude-to-camera-zoom mapping, amount, sensitivity, and an amplitude meter. Analysis combines channel energies before smoothing, so opposite-phase stereo remains reactive, and output gain does not affect the signal. The render modifier restores camera zoom after every render, while the background compensates projection zoom through mesh scaling. Hidden-tab, processing, creator/player preview, and export blockers coordinate transport; GPU reinitialization reuses the shell-owned player. Video exports explicitly omit the soundtrack/reaction and suspend/restore playback. Still-image rendering uses the current signal. Focused unit tests and the full frontend test suite cover the signal/controller/export contracts; Chromium smoke testing exercises the actual library, playback, render zoom, and responsive controls.

Validation: `pnpm --filter rivvon test:run` passed 127 tests across 22 files, and `pnpm --filter rivvon build` passed. The browser fixture was generated as opposite-phase stereo AAC in MP4 using the existing Mediabunny encoder. Its mocked authenticated library/CDN responses verified activation from both library and player, real media playback, mute-independent amplitude, transient rendered zoom with restored base zoom, pause/reset, processing pause/resume, removal, and a constrained 390 × 568 settings scroll region. Mobile Safari and synchronized video export remain outside this validation.

### Production playback cache follow-up

The first deployed implementation failed when a native library preview cached a CDN URL without CORS and the viewer later reused it with anonymous CORS. The bucket policy was already correct: fresh origin-bearing GET/range responses returned `Access-Control-Allow-Origin: *` and `Vary: Origin`. However, responses to previews without an Origin header omitted both headers and advertised `Cache-Control: public, max-age=31536000, immutable`. A browser could reuse that old response and block the viewer without a new network request.

All library/player previews now also use `crossorigin="anonymous"`. The shared `modules/viewer/audioPlayback.js` helper supplies a stable `rivvon_audio_cors=1` query parameter for public Rivvon CDN audio in previews and the viewer controller. This isolates playback from existing non-CORS browser/CDN cache entries without generating a new URL on every play. Other-provider, local, and potentially signed URLs are left unchanged. The asset metadata retains its original URL. Future bucket-policy changes may still require purging the custom-domain CDN cache. [Cloudflare R2 CORS and caching](https://developers.cloudflare.com/r2/buckets/cors/#use-cors-with-a-custom-domain).

This failure was reproduced in Chromium with browser caching enabled, without request interception, using the production file reported by the user. A plain preview loaded; anonymous playback of the unversioned URL was then blocked. The updated viewer controller loaded the versioned URL, played it, and reported a nonzero amplitude with no playback/analysis error. Production HEAD and range requests carrying `Origin: https://rivvon.ca` were also checked and returned the required wildcard CORS header. No bucket policy change was necessary. The frontend fix must be deployed before existing users receive the new playback URL.

## Recommendation

Proceed with one active library track, playback owned by the viewer shell, and a reusable amplitude signal mapped initially to camera zoom. The live feature is a moderate frontend change: existing audio assets, metadata endpoints, and Three.js rendering are sufficient. No new backend processing, dependency, or database migration is needed for session-only activation. Saving an audio association with an artwork or sharing it would require additional design and persistence.

Suggested experience: select **Use in viewer** on an audio card, return to the artwork, and retain a compact transport showing the track, play/pause, seek, volume, loop, and remove controls. Enable **Audio reactive > Camera zoom** with sensitivity and amount controls. Activation starts only through an explicit user action; if playback is blocked, the transport exposes Play. Audio activation and reaction enablement should be separate so a soundtrack can also play without affecting the artwork.

## Existing implementation and fit

| Area | Repository evidence | Implication |
| --- | --- | --- |
| Viewer lifetime | `src/router/index.js` routes home, textures, audio library, and audio player to `RibbonView.vue`. That view renders `ThreeCanvas` independently of the audio panels. | The artwork remains in the shared shell when browsing audio. Playback should be owned above the conditionally mounted panels. |
| Current playback | `AudioLibraryView.vue` creates a native audio element per card. `AudioPlayerView.vue` has a separate element. Both panels are mounted with `v-if`. | Playback belongs to the panel today and does not provide a viewer activation mechanism. Closing it removes its audio element. |
| Audio assets | `services/audioService.js` exposes library/detail requests; `apps/api/routes/audios.ts` returns completed, owner-scoped assets including `playback_url`, duration, sample rate, and channel count. | Reuse existing metadata and CDN URLs; library selection requires the existing session. |
| Saved speed | `AudioCreator.vue` calls `trimAudioSource` with the selected trim and playback rate. `modules/viewer/audioProcessing.js` renders the rate change into AAC in MP4 before upload. | Play the published file at 1x by default. Stored `playback_rate` describes creation; applying it again would double the speed change. |
| Existing analysis | `AudioCreator.vue` already connects microphone input to an analyser and calculates RMS for its recording waveform. | The amplitude calculation has an existing local precedent, though library playback needs a media-element source and its own lifetime management. |
| Render integration | `useThreeSetup.js` coordinates composables through a shared context; `useRenderLoop.js` updates camera drivers and OrbitControls before rendering. | Add a signal reader and apply the resulting effect at the final render stage. |
| Export | `useSceneExport.js` renders frame-accurate output at synthetic times and adds only a video track; legacy recording captures only the canvas stream. | Live reactivity and soundtrack export require separate integration. Neither exporter currently includes library audio. |

Paths in this table are relative to `apps/rivvon` except where explicitly qualified.

## Playback and variability architecture

Use a viewer audio controller, created/provided by `RibbonView.vue`, with one persistent audio element and one lazily initialized AudioContext. Keep native audio objects and sample buffers outside serializable Pinia state. Store only UI state and configuration there, if needed. Supply the controller to the Three.js context so GPU teardown/reinitialization can reattach the camera effect without creating a second audio player.

Route the element through a MediaElementAudioSourceNode. Split its output into an analysis branch and an audible branch through a GainNode to the audio destination. Place volume/mute gain after the analysis tap, leaving reactive intensity independent of listening volume. Keep the media element's volume at unity and implement these controls through gain. Create the media-element source once for that element and reuse it when replacing tracks. [Web Audio specification](https://www.w3.org/TR/webaudio-1.0/).

Expose an audio signal such as `amplitude` in the range 0 to 1 independently of the camera target. Additional signals such as bass energy or transients can be added later, and the same mapping layer could drive existing animation parameters. Start with a single amplitude-to-zoom binding rather than a full mapping editor. Per-frame values should stay in the controller/render context, with UI meter updates throttled; avoid writing viewer preferences or rebuilding geometry every frame.

For amplitude, read a reusable Float32Array with `getFloatTimeDomainData`, calculate RMS, apply a noise floor and sensitivity, clamp, and smooth. RMS is `sqrt(mean(sample * sample))`. Use a faster attack than release so changes respond promptly and settle gently. Starting values of 30 ms attack and 200 ms release are tuning proposals, not measured requirements. Use delta-time-based smoothing rather than a fixed lerp per frame. Analyser FFT smoothing is not a substitute for smoothing this time-domain envelope. [Time-domain samples](https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode/getFloatTimeDomainData), [analysis algorithms](https://www.w3.org/TR/webaudio-1.0/#fft-windowing-and-smoothing-over-time).

An analyser's time-domain signal is downmixed to mono. For robust stereo behavior, use per-channel analysis and combine channel energies so opposite-phase channels do not cancel; the offline export envelope should use the same policy. [Time-domain downmixing](https://www.w3.org/TR/webaudio-1.0/#time-domain-down-mixing).

The creator's existing waveform uses 1,200 peak bins across the entire source and is not stored with the asset. It is suitable for editing previews, but should not be treated as a sufficiently resolved RMS modulation envelope for arbitrary track lengths.

## Camera zoom without conflicting controls

Both renderer setups use a PerspectiveCamera. Prefer optical/projection zoom for the first effect, keeping camera position and OrbitControls target available for navigation. A proposed mapping is `effectiveZoom = baseZoom * (1 + amount * amplitude)`, initially limiting the extra zoom to roughly 20%. Louder audio then brings the artwork closer visually; silence returns to the user's underlying view. [Three.js PerspectiveCamera](https://threejs.org/docs/pages/PerspectiveCamera.html).

Apply this as a temporary render modifier after cinematic/recorded motion, head/mouse/scroll controls, and OrbitControls have established the frame's base state. Update the projection matrix, render, and restore the base zoom in a `finally` block. Never multiply the previous frame's already modulated zoom. This keeps the effect composable and prevents it from being accidentally baked into camera recordings or cinematic ROI capture. Camera-only recordings would then reproduce navigation; replaying audio supplies the reaction separately.

There are concrete projection dependencies to review:

- `useSceneBackground.js` sizes a camera-attached surface using raw `camera.fov`. It should account for effective FOV under projection zoom so the background framing stays correct.
- `useSceneLighting.js` already uses `getEffectiveFOV` in one sizing path, but its transmission-camera setup also needs inspection with the effect active.
- `headTrackingCameraController.js` derives movement scale from raw FOV. Decide whether this uses the unmodified navigation view or visible zoomed framing, and verify the resulting interaction.
- Camera motion samples currently store FOV, position, orientation, and target, but no zoom. Keeping modulation outside captured base state is deliberate; baking it later requires extending the recording format or storing effective FOV.
- Use the shared render helper for still-image captures as well, with an explicit signal snapshot, to preserve the current reactive view in exported images.

## Browser, media, and lifecycle requirements

Set `crossOrigin = 'anonymous'` before assigning the CDN URL. The CDN must return appropriate CORS headers on actual audio responses, including range responses. Existing `apps/api/r2-cors.json` permits cross-origin GET/HEAD, which is encouraging, but deployment and cached CDN headers still need verification. API CORS alone does not establish media CORS. A cross-origin file may play in an ordinary audio element while a Web Audio source is required to output silence when CORS access is absent. [Web Audio media security](https://www.w3.org/TR/webaudio-1.0/#MediaElementAudioSourceNode-security).

Create/resume AudioContext and request playback from the activation or Play gesture, handling rejected promises and suspended context state. Metadata loading can complete later; playback failure must leave a usable Play control. The existing player's `autoplay` attribute is not a guarantee of audible playback. [Autoplay guidance](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay), [AudioContext.resume](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/resume).

Pause library previews when activating a viewer track and coordinate player/creator previews so two tracks do not play unintentionally. On pause, buffering, end, track replacement, or seek, reset/decay the envelope appropriately and restore the base view. Replace tracks atomically, ignoring stale metadata/play promises. On viewer exit or logout, stop playback, remove listeners, disconnect nodes, and release the context. Offer a neutral error state for unavailable/deleted assets.

The render loop already pauses in hidden tabs and during processing. For the initial behavior, pause audio when the viewer is hidden/suspended and resume only if it was previously playing, handling any renewed gesture requirement. GPU recovery should preserve the selected track and transport state independently, then bind the replacement camera. Exact sound-to-screen alignment remains a browser smoke-test item; analysis windows and audio-device output latency can affect perceived timing.

Bounded analyser windows and one projection update per rendered frame suggest modest incremental CPU work and no geometry rebuild. This is an architectural expectation, not a performance benchmark. Stream playback through the media element; avoid decoding a whole long asset into memory for the live feature. The API permits up to two hours and 512 MiB per upload.

## Export scope

Treat synchronized video export as a second implementation stage. The current exporter pauses live rendering and evaluates frames at `frame / fps`; polling a live analyser there would make the reaction depend on encoding speed rather than the exported audio timeline.

Decode the published file into a bounded, timestamped RMS envelope, then sample that envelope on each synthetic frame and apply the same sensitivity, smoothing, and zoom mapping. Add an audio track to the output with format-compatible encoding. Define export start offset, seek position, looping, duration, and mute/output-volume semantics together. MP4/WebM require their own compatible audio choices. Process long sources incrementally and release decoded buffers rather than keeping the full PCM track resident.

For the live-only first stage, suspend and restore transport during export and explicitly show that video export does not yet include audio/reaction. Otherwise a static intermediate zoom or silent video could misleadingly appear to represent the reactive scene. Audio looping also does not automatically make the combined artwork/camera/audio output seamless; loop boundaries need explicit envelope and duration handling.

## Suggested implementation sequence and validation

1. Add the viewer-owned audio controller and library activation action; reuse existing endpoints. Verify playback remains alive when closing the audio library, returning to a texture, and opening Tools.
2. Add reusable amplitude analysis and controls, then a reversible projection-zoom modifier. Follow `DESIGN.md` for PrimeVue/shared controls, scroll regions, accessible names, narrow-screen behavior, and registration of any new Material Symbols.
3. Validate real CDN audio in a browser: CORS, gestures, play/pause, seek, buffering, end, loop, volume independence, track replacement, preview coordination, hidden-tab behavior, and GPU reinitialization. Check OrbitControls, cinematic and recorded camera motion, head/mouse/scroll modes, backgrounds, lighting, and still-image captures. Include mobile Safari and Chromium coverage on actual supported devices.
4. Add focused mathematical tests for RMS, stereo energy, silence, sensitivity/clamping, attack/release across frame rates, and zoom restoration/no accumulation. Browser playback and CORS need integration checks beyond mocks.
5. Extend frame-accurate export with an envelope evaluated at export timestamps and an audio track. Verify identical visual timing at different encoding speeds, correct offsets/loops, cancellation cleanup, and restored live camera/transport state.

The recommended first deliverable is a viewer track transport plus amplitude-driven zoom. Reusable signal/target boundaries leave room for bass-driven undulation, transient-driven pulses, and other mappings without coupling those behaviors to the library UI.
