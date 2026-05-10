# Renderer Resource Sharing

## Overview

Rivvon currently uses separate renderer instances for three related but distinct surfaces:

- The main ribbon viewer
- The texture overview panel
- The tile-linear texture preview in the texture browser

Those surfaces may display the same underlying KTX2 texture set, but they do not currently share GPU texture objects directly. This note captures why that is the current design, what is shared instead, and what would need to change if the app ever moves toward a single-renderer compositor.

For how session byte caching and IndexedDB durable caching fit around this renderer split, see `texture-caching-architecture.md`.

---

## Current Decision

The current architecture keeps multiple renderer instances, but shares everything that is cheap and safe to share:

- Renderer display policy is centralized in `src/modules/viewer/rendererConfig.js`
- Remote KTX2 bytes are shared in-session through `src/services/remoteTextureCache.js`
- KTX2 loader/transcoder setup is shared through `src/modules/slyce/sharedKTX2Loader.js`

What is still renderer-local:

- GPU textures and backend texture allocations
- Materials and renderer backend caches
- Scene, camera, and canvas ownership

This removes redundant network fetches and reduces renderer drift without introducing cross-renderer GPU lifetime coupling.

---

## Why GPU Objects Are Not Shared

The main reason is that GPU resources are typically owned by a specific renderer backend context:

- In WebGL, textures are tied to a single WebGL context
- In WebGPU, textures are tied to a specific `GPUDevice`
- Three.js renderer internals also maintain per-renderer backend caches for bindings, pipelines, and upload state

That means two renderer instances can reuse the same source KTX2 bytes, but each renderer still needs its own GPU upload.

Even if the app reused the same JavaScript `Texture` object across renderers, each renderer would still build its own backend representation. That is why sharing raw bytes is the practical optimization boundary in the current design.

---

## Why Multiple Renderers Still Make Sense

Keeping separate renderers still has real advantages for the current UI structure:

- The ribbon viewer is a global, full-scene surface
- The texture overview is a panel-local surface with its own scene and orthographic camera
- The tile-linear preview behaves like an embedded, scrollable panel canvas rather than a global scene surface

Separate renderer instances keep those surfaces isolated in a way that matches the Vue layout and panel lifecycle:

- Each surface can mount and dispose independently
- Canvas placement stays local to the panel that owns it
- Scroll, resize, and visibility behavior remain straightforward
- Device loss or disposal in one surface is less likely to break another surface

This isolation is one of the main reasons the app has not moved to a single shared renderer.

---

## What The Current Cache Actually Solves

The shared remote texture cache in `src/services/remoteTextureCache.js` avoids repeated downloads of the same KTX2 tiles when the same texture is shown in multiple surfaces during one session.

That means:

- The ribbon viewer can warm the cache
- The texture overview can reuse those remote KTX2 bytes
- The tile-linear preview can also reuse those same bytes

What the cache does **not** solve:

- Duplicate GPU texture residency across renderer instances
- Duplicate material creation across renderer instances
- Duplicate parse/upload work inside separate renderers

So the cache is primarily a network and fetch-latency optimization, not a full renderer unification strategy.

---

## What A Single-Renderer Architecture Would Change

A single-renderer architecture would mean one authoritative Three.js renderer for the app, with the ribbon viewer, overview, and tile-linear preview becoming separate scenes or render surfaces drawn by the same renderer.

That would allow true GPU object reuse because all surfaces would live under one backend context.

Likely gains:

- Shared GPU textures and materials
- Less duplicate GPU memory usage
- One central color-management and renderer-policy path
- One central render loop and scheduling model

Likely costs:

- More complicated viewport/scissor management
- Harder DOM-to-canvas layout coordination for embedded panels
- Harder scroll behavior for the tile-linear preview
- Tighter coupling between otherwise independent surfaces
- Broader recovery logic for device loss and teardown

For this app, the tile-linear preview is the least natural fit for a single shared canvas because it behaves more like an embedded document surface than a global scene.

---

## Why The Current Tradeoff Was Chosen

The current design is a pragmatic middle ground:

1. Keep multiple renderer instances because they match the UI structure well.
2. Centralize display settings so WebGL and WebGPU behavior stay consistent.
3. Share remote KTX2 bytes so repeated panel opens do not pay full download cost again.
4. Accept renderer-local GPU uploads as the cost of keeping those surfaces isolated.

This avoids turning a performance optimization into a large compositor rewrite.

---

## When To Revisit This Decision

Revisit the architecture if one or more of these become true:

- GPU memory duplication becomes a measured bottleneck on target devices
- Parse/transcode cost across multiple surfaces becomes a meaningful user-visible delay
- The app starts showing the same texture in multiple surfaces at once as a primary workflow
- The overview and preview surfaces move closer to the main viewer conceptually and structurally

If that happens, the next questions to answer are:

1. Is a CPU-side parsed texture cache enough?
2. Do only the ribbon viewer and overview need consolidation?
3. Is a full single-renderer compositor worth the complexity for the tile-linear preview too?

Until one of those pressures becomes real, the current shared-config plus shared-byte-cache design is the preferred default.
