# Tile Builder Backends

## Current Backends

File-mode Slyce now exposes a `tileBuilderBackend` selector with three options:

- `canvas` for the legacy 2D canvas path in [src/modules/slyce/tileBuilder.js](../src/modules/slyce/tileBuilder.js)
- `webgl` for the WebGL2 atlas builder in [src/modules/slyce/webglTileBuilder.js](../src/modules/slyce/webglTileBuilder.js)
- `webgpu` for the WebGPU atlas builder in [src/modules/slyce/webgpuTileBuilder.js](../src/modules/slyce/webgpuTileBuilder.js)

The WebGL2 and WebGPU builders mirror the same file-mode contract used by `videoProcessor`:

- accept decoded frames one at a time
- maintain a live layer-0 preview canvas
- emit `complete` with a `readImages()` callback that returns per-layer RGBA buffers for KTX2 encoding

Canvas remains the widest-compatibility fallback. WebGL2 remains the default GPU path today. WebGPU is now available as an explicit opt-in backend.

## Current Design

Both GPU builders currently use a 2D atlas as the transient GPU target.

The WebGL2 implementation lives in [src/modules/slyce/webglTileBuilder.js](../src/modules/slyce/webglTileBuilder.js).
The WebGPU implementation lives in [src/modules/slyce/webgpuTileBuilder.js](../src/modules/slyce/webgpuTileBuilder.js).

The write path is:

1. Draw the decoded source frame into a 2D upload canvas.
2. Upload that canvas into a single `TEXTURE_2D` source texture.
3. Run one instanced draw call for the current frame row.
4. Write every layer's sampled strip into its own cell in one atlas texture.
5. After the tile is complete, read back each atlas cell with `gl.readPixels()` and hand the RGBA buffers to the KTX2 encoder.

The important property is the batching in step 3. For each source frame, the builder issues one GPU draw that populates all cross-section layers for that row.

That batching argument matters most for the WebGL2 path, which is why the atlas-versus-array discussion below focuses primarily on WebGL2 tradeoffs.

## Why Atlas Storage Was Chosen

The atlas is not just a storage format. It is what makes the current WebGL2 builder efficient.

- All layers for a frame can be written in one instanced draw call.
- The shader can map `gl_InstanceID` directly to an atlas cell.
- The framebuffer stays attached to one color target instead of being rebound for each layer.
- Readback is straightforward because each layer already occupies a rectangular region in one 2D texture.

This is why the current support probe is framed around atlas fit, not just generic WebGL2 availability.

- Tile width and height must fit the GPU texture-size limit.
- The packed atlas width and height must also fit that limit.
- The scaled source frame must fit that same limit for the upload texture.

If any of those checks fail, the builder falls back to the CPU/canvas path.

## Texture Array Alternative

Using a `TEXTURE_2D_ARRAY` as the transient builder target is feasible in WebGL2.

Relevant WebGL2 features already exist:

- `TEXTURE_2D_ARRAY`
- `SAMPLER_2D_ARRAY`
- `framebufferTextureLayer()`
- `MAX_ARRAY_TEXTURE_LAYERS`

That makes the idea architecturally appealing because the final asset is already assembled as a layered KTX2 texture, and the viewer already consumes array textures.

## What A Texture Array Would Improve

An array-backed builder would improve the conceptual model and some capability checks.

- The transient storage would match the final KTX2 array representation more closely.
- Width and height limits would stay per-layer instead of being inflated by atlas packing.
- Layer count would be governed by `MAX_ARRAY_TEXTURE_LAYERS` instead of only by atlas packing into `MAX_TEXTURE_SIZE`.
- The last row of a partially filled atlas would no longer waste cells.

This means some configurations that fail atlas packing could still fit in an array texture.

Example:

- A large output tile with many layers can exceed atlas width or height even though each individual layer slice is still small enough to fit on the GPU.

## What A Texture Array Would Not Fix

An array does not remove the main CPU boundary in the current pipeline.

- The builder still needs CPU-side RGBA buffers for KTX2 encoding.
- Readback would still happen layer by layer before Basis compression.
- The expensive handoff is still GPU transient storage to CPU encode inputs.

So the value of an array is not that it avoids readback or makes KTX2 assembly inherently cheaper.

## Why A Texture Array Is Not An Obvious WebGL2 Win

In the current WebGL2 architecture, a texture array would likely reduce batching efficiency.

The atlas path can write all layers for a frame in one instanced draw because every layer lands in a different part of the same 2D render target.

With a texture array, WebGL2 does not provide a simple equivalent path that writes each instance into a different array layer in one pass. In practice, the builder would likely need one of these approaches:

1. Reattach a different layer with `framebufferTextureLayer()` and draw once per layer.
2. Use multiple color attachments in chunks, still limited by `MAX_COLOR_ATTACHMENTS` and `MAX_DRAW_BUFFERS`.

Both approaches are less attractive than the current atlas write path.

- Per-layer attachment changes add framebuffer churn.
- Per-layer or chunked draws increase draw count significantly.
- WebGL guidance generally favors fewer attachment mutations and fewer draw passes.

For a representative tile, the difference is substantial:

- Atlas path: roughly one draw per source frame.
- Array path: likely one draw per source frame per layer, or at best several chunked draws per frame.

That tradeoff is the main reason the atlas remains the better WebGL2 fast path today.

## Memory Implications

Atlas and array storage are broadly similar in raw RGBA8 footprint.

- Atlas: about `tileWidth * tileHeight * layerCount * 4`, plus small waste from unused cells in the last row.
- Array: about `tileWidth * tileHeight * layerCount * 4`, without the partial-row waste.

The array representation is cleaner, but it should not be expected to deliver a major VRAM reduction by itself.

## Recommendation

For the current codebase:

- Keep the atlas as the primary WebGL2 builder target.
- Treat a texture-array builder as a possible compatibility or capability-expansion path, not as an assumed performance upgrade.
- If array support is explored later, the most plausible justification is handling settings that fail atlas packing but still fit per-layer size and `MAX_ARRAY_TEXTURE_LAYERS`.
- Texture arrays are a better fit for future WebGPU builder work than for replacing the current WebGL2 atlas path outright.

## Practical Summary

- Atlas storage is currently the fastest known WebGL2 write path because it preserves one-pass instanced batching.
- Texture-array storage is feasible and more elegant, but it likely trades away that batching advantage in plain WebGL2.
- Arrays may broaden the support envelope for some high-layer or large-tile settings.
- Arrays do not remove the current GPU-to-CPU readback boundary before KTX2 encoding.
