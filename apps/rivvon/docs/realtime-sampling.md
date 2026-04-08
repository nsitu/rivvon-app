# Realtime Sampling Notes

## Decision

Realtime webcam sampling now always uses a staging canvas before populating the per-layer canvases.

We removed the older direct-frame path because:

- On iPad Safari it was not just slower, it was incorrect for `waves` capture. The first completed tile showed `1/30` unique layer signatures, and the resulting textures did not animate properly.
- On Android Chrome, staging outperformed direct-frame in the tested capture path while preserving full layer diversity.
- On desktop Chrome, direct-frame sometimes reduced encode cost, but it did not produce a meaningful capture-loop advantage that justified keeping a second code path alive.
- One staging-based path is easier to reason about, easier to debug, and more compatible across browsers.

## Current Pipeline

For each camera frame:

1. Draw the full live frame into a staging canvas.
2. Sample 1px strips from that staging canvas into the per-layer canvases.
3. Keep writing into those per-layer canvases until a tile is complete.
4. After tile completion, read each layer canvas with `getImageData()` and send the RGBA buffers to the KTX2 encoder workers.

This means the staging canvas is write-only in the hot path. The layer canvases are write-dominated during capture and only become read-heavy once a tile finishes.

## Realtime Encode Throttling

Realtime capture now throttles encoding more aggressively than file-mode processing while sampling is still active.

- While the camera is still sampling, realtime keeps only one tile encode in flight at a time.
- While the camera is still sampling, realtime uses a single KTX2 worker, so only one layer encode runs at a time.
- Once sampling stops and the app is only draining queued tiles, realtime disables that extra throttle and switches to the same background encode policy as file mode: up to two concurrent tile encodes, with layer workers sized from `navigator.hardwareConcurrency`.
- File-mode processing uses that same shared background encode policy explicitly, rather than relying on the worker-pool default implicitly.

This split is intentional.

- File processing is offline work, so higher parallelism is acceptable.
- Realtime capture must keep up with camera cadence, so reducing encode pressure helps avoid dropped frames while sampling is still underway.

## Memory Safeguards

Low-memory mobile devices, especially Apple WebKit on iPad, needed explicit safeguards beyond the basic realtime throttle.

- The shared background encode policy still allows up to two concurrent tile encodes, but it now caps layer-worker count to `2` on Apple WebKit and on clearly memory-constrained devices instead of always using the full reported core count.
- Realtime does not escalate into the larger post-sampling background pool until the in-flight capture-time worker pool has gone idle. This avoids overlapping the old `1`-worker pool with a new larger pool during drain.
- Completed realtime tiles are retained safely until deferred readback and encode finish, so post-sampling drain does not lose queued tile data while the capture loop is shutting down.

These safeguards were added because the failure mode on low-powered iPad hardware was not a readback or canvas-lifetime bug once sampling ended. The tiles survived through readback, but worker-side Basis encoding could still abort with out-of-memory errors when the drain phase became too aggressive.

The resulting behavior is:

- Capture-time encoding stays conservative to protect sampling FPS.
- Post-sampling realtime drain and file-mode processing share the same background encode policy.
- Low-memory Apple/WebKit devices avoid the worker-count spike that previously caused queued tiles to disappear and partial local saves.

The important detail is that realtime encoding is only partially off the main thread.

- `getImageData()` readback still happens on the main thread.
- Final KTX2 array assembly still happens on the main thread.
- Only the per-layer Basis compression runs inside workers.

So reducing realtime worker concurrency is not just about worker CPU usage; it also reduces how often the main thread has to compete with encode-related work during live capture. Once sampling is over, that constraint relaxes, so realtime can safely drain the remaining tiles using the same background encode policy as file mode.

## Why We Are Not Using `willReadFrequently`

Chrome may warn:

```text
Canvas2D: Multiple readback operations using getImageData are faster with the willReadFrequently attribute set to true.
```

That warning is real, but it is easy to apply it to the wrong canvas.

### Which canvas is Chrome likely warning about?

In this pipeline, the warning most likely refers to the per-layer canvas pool, not the staging canvas.

- The staging canvas receives a full-frame `drawImage()` every source frame.
- The per-layer canvases receive one strip write per source frame and are later read with `getImageData()` after tile completion.
- The warning often appears as `60Canvas2D`, which lines up with two pooled sets of thirty layer canvases.

### Why we do not enable it anyway

Our priority in the active sampling path is write throughput, not readback throughput.

- The staging canvas is purely a write surface in the hot path, so `willReadFrequently` would optimize the wrong operation.
- The layer canvases are written continuously while the user is capturing. They are only read once per tile, after the tile is complete.
- In this project, preserving fast writes has been more important than optimizing the later readback step.

So even though Chrome warns about readback, we do not currently enable `willReadFrequently` on the active sampling canvases because doing so would risk slowing the hot write path that governs capture throughput.

If we ever want to test readback-focused tuning, the right experiment is a dedicated readback canvas after tile completion, not changing the active write surfaces.

## Removed Direct-Frame Reference

For reference, the removed direct path looked like this:

```js
processFrame(videoFrame) {
  const frameHeight = videoFrame.displayHeight || videoFrame.height;
  const frameWidth = videoFrame.displayWidth || videoFrame.width;

  for (let canvasIndex = 0; canvasIndex < this.crossSectionCount; canvasIndex++) {
    const ctx = getCached2dContext(this._currentCanvasSet[canvasIndex]);
    const sampleY = computeSampleY(canvasIndex, frameHeight);

    ctx.drawImage(
      videoFrame,
      0, sampleY, frameWidth, 1,
      0, this._currentRow, this.potResolution, 1
    );
  }
}
```

We are not using it anymore because:

- Safari/iPad could collapse layer diversity even when the KTX2 container itself still reported the expected depth.
- It made browser-specific behavior harder to understand because correctness and performance diverged by platform.
- The staging path is compatible everywhere we tested and keeps the code simpler.

## Practical Summary

- Staging everywhere is the chosen default because it is the most compatible path.
- The Chrome `willReadFrequently` warning does not outweigh the importance of fast writes in our capture pipeline.
- If future work targets readback performance, it should do so with isolated readback surfaces rather than changing the active sampling canvases.
