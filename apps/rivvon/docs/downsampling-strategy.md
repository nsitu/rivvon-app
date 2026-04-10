# Downsampling Strategy: Why "Upfront" Only

## Background

Slyce previously offered two downsampling strategies when the target tile resolution was smaller than the source video frame dimension:

- **`upfront`** — Downscale the entire video frame once before extracting cross-section samples
- **`perSample`** — Let each `drawImage` call implicitly scale the 1px-wide (or 1px-tall) strip from source resolution to tile resolution

The `perSample` option was removed in favour of always using `upfront`.

## Rationale

### Performance

With `perSample`, every `ctx.drawImage()` call in `tileBuilder.js` implicitly rescales when source and destination dimensions differ. For a typical configuration of 60 cross-sections per frame, this means **60 scaling operations per frame** — one for each sample strip.

With `upfront`, the full frame is scaled **once** via a single `drawImage` in `samplingSources.js` before any sampling begins. The subsequent per-sample draws become 1:1 pixel copies (no rescaling), which are essentially memcpy-level operations.

The performance gap widens with:

- Higher cross-section counts (more redundant scaling per frame)
- Larger source video resolutions (more pixels to resample per strip)

### Quality

The `upfront` path uses `imageSmoothingQuality: 'high'` on a full-frame resize, enabling the browser to apply a proper resampling filter (typically Lanczos or bicubic). The `perSample` path relied on the browser's default interpolation applied independently to each 1px-wide strip — producing lower quality results with potential aliasing artifacts.

### Simplicity

Removing the option simplifies the processing pipeline and eliminates a configuration choice that was strictly inferior in both quality and performance for the common case.

## Where the scaling happens

`samplingSources.js` → `VideoFileFrameSource.frames()` generator:

1. Decode video frame
2. Optionally crop (if region-of-interest is set)
3. **Upfront downscale** via `OffscreenCanvas` if `tilePlan.isScaled`
4. Yield the processed frame to `tileBuilder.js` for cross-section sampling
