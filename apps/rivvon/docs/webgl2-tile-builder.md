# Tile Builder Backends

## Current Backends

File-mode Slyce now exposes a `tileBuilderBackend` selector with four options:

- `canvas` for the legacy 2D canvas path in [src/modules/slyce/tileBuilder.js](../src/modules/slyce/tileBuilder.js)
- `webgl` for the WebGL2 atlas builder in [src/modules/slyce/webglTileBuilder.js](../src/modules/slyce/webglTileBuilder.js)
- `webgpu-array` for the preferred WebGPU direct-array builder in [src/modules/slyce/webgpuDirectArrayTileBuilder.js](../src/modules/slyce/webgpuDirectArrayTileBuilder.js)
- `webgpu` for the WebGPU atlas fallback builder in [src/modules/slyce/webgpuTileBuilder.js](../src/modules/slyce/webgpuTileBuilder.js)

All GPU builders mirror the same file-mode contract used by `videoProcessor`:

- accept decoded frames one at a time
- maintain a live layer-0 preview canvas
- emit `complete` with a `readImages()` callback that returns per-layer RGBA buffers for KTX2 encoding

Canvas remains the widest-compatibility fallback. The default selection now prefers `webgpu-array` whenever WebGPU is exposed by the browser, then falls back to `webgl` on non-Apple/WebKit browsers and `canvas` on Apple/WebKit.

## Current Design

The file-mode pipeline now ships with two transient GPU storage models.

### Preferred WebGPU Direct-Array Path

The preferred WebGPU implementation lives in [src/modules/slyce/webgpuDirectArrayTileBuilder.js](../src/modules/slyce/webgpuDirectArrayTileBuilder.js).

The write path is:

1. Copy the decoded `VideoFrame` directly into one sampled source texture.
2. Run one compute dispatch for the current output row.
3. Fan that row out across all cross-section layers into one `rgba8unorm` 2D array texture.
4. When the tile completes, read back the whole array texture in one `copyTextureToBuffer()` operation.
5. Unpack the GPU rows into per-layer `{ rgba, width, height }` buffers for KTX2 encoding.

The important property is still batching. For each decoded source frame, the builder issues one dispatch that populates every layer for that row.

### Atlas Paths

The atlas implementations live in [src/modules/slyce/webglTileBuilder.js](../src/modules/slyce/webglTileBuilder.js) and [src/modules/slyce/webgpuTileBuilder.js](../src/modules/slyce/webgpuTileBuilder.js).

Their write path is:

1. Upload the decoded frame into one sampled source texture.
2. Run one instanced draw for the current output row.
3. Write each layer's sampled strip into its own atlas cell.
4. When the tile completes, read atlas cells back layer by layer and hand the RGBA buffers to the KTX2 encoder.

## Why WebGPU Direct-Array Is Preferred

The direct-array WebGPU path is now the preferred file-mode implementation because it improves the builder model without introducing a structural performance regression.

- The transient storage matches the final KTX2 array representation.
- Support checks are based on per-layer size plus `maxTextureArrayLayers`, not atlas packing.
- The builder performs one whole-array readback instead of layer-by-layer atlas cell copies.
- Preview and `readImages()` still preserve the existing `videoProcessor` and KTX2 encode contract.

Manual A/B runs on the same clips showed the direct-array path in the same performance class as the atlas path, with builder assembly/readback typically at about 0.2s to 0.4s per 240-layer tile while encode still dominated wall-clock time.

## Why Atlas Still Exists

Atlas storage is still the right fallback story for two cases.

### WebGL2 Fast Path

The atlas remains the best known WebGL2 write path.

- All layers for a frame can be written in one instanced draw call.
- The shader can map `gl_InstanceID` directly to an atlas cell.
- The framebuffer stays attached to one color target instead of being rebound for each layer.

That batching advantage is why the WebGL2 builder remains atlas-based instead of switching to a WebGL2 texture-array path.

### WebGPU Fallback and Debugging

The WebGPU atlas builder remains available as `WebGPU Atlas (Fallback)`.

- It provides an A/B baseline against the direct-array path.
- It remains useful for debugging browser-specific WebGPU issues.
- It keeps the older atlas implementation available without reopening the file-mode contract.

## Support Checks

The support gates now depend on the selected backend.

### `webgpu-array`

- source width and height must fit `maxTextureDimension2D`
- tile width and height must fit `maxTextureDimension2D`
- cross-section count must fit `maxTextureArrayLayers`
- `rgba8unorm` source upload, storage-texture writes, and readback must be supported

### `webgpu`

- source width and height must fit `maxTextureDimension2D`
- tile width and height must fit `maxTextureDimension2D`
- the packed atlas width and height must also fit `maxTextureDimension2D`

### `webgl`

- the scaled source frame must fit the WebGL texture-size limit
- the output tile must fit that limit
- the packed atlas must fit the same limit

If any of those checks fail, the builder falls back to the next available backend or to canvas.

## Readback and Encode Boundary

None of the file-mode backends remove the current GPU-to-CPU boundary before KTX2 encode.

- Every backend still ends at per-layer RGBA buffers for `KTX2Assembler.encodeParallelWithPool()`.
- The main difference is builder command shape and readback organization, not whether CPU-side encode inputs still exist.
- In current real-world runs, KTX2 encode remains the dominant wall-clock phase.

## Practical Summary

- Use `WebGPU` when available. This is the preferred direct-array builder.
- Use `WebGPU Atlas (Fallback)` only for troubleshooting or comparison.
- Use `WebGL` when WebGPU is unavailable but GPU assembly is still desirable.
- Use `Canvas` for widest compatibility or as the last fallback.
