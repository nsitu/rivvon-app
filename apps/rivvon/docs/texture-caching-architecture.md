# Texture Caching Architecture

## Overview

Rivvon currently has multiple cache-like layers involved in getting KTX2 texture data onto screen. They are not all solving the same problem.

The main distinction is temporal:

- Some layers are hot, in-memory reuse within the current page session.
- Some layers are durable, IndexedDB-backed local copies that survive reloads.
- Some layers are only short-lived adapters that make a given renderer or component easy to drive.

This note maps those layers, how they interact today, where there is intentional overlap, and what the best cleanup opportunities appear to be.

---

## Cache Inventory

| Layer                                   | Scope                      | Survives reload | Stores                                                     | Primary purpose                                                                    |
| --------------------------------------- | -------------------------- | --------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `src/services/sessionTextureCache.js`   | App session                | No              | Session KTX2 tile bytes (`Uint8Array`)                     | Reuse and dedupe hot KTX2 bytes across renderers in the current session            |
| `src/services/localStorage.js`          | Browser durable storage    | Yes             | Texture-set metadata plus per-tile KTX2 bytes in IndexedDB | Persistent local texture storage and durable cloud-texture cache                   |
| `slyceStore.ktx2BlobURLs`               | Slyce session state        | No              | Object URLs for newly encoded tiles                        | Drive the in-progress authoring/output pipeline before save or publish             |
| `TextureBrowser.previewBlobURLs`        | One preview panel instance | No              | Object URLs for tile-linear preview input                  | Feed `TileLinearViewer` without making it know about IndexedDB or remote byte maps |
| `TileManager.zipFiles`                  | One `TileManager` instance | No              | Per-renderer KTX2 byte staging                             | Feed KTX2 parse/build inside a single renderer instance                            |
| `src/modules/slyce/sharedKTX2Loader.js` | Shared loader state        | No              | KTX2 loader/transcoder setup                               | Avoid duplicate loader setup; not a byte cache                                     |

Important distinction:

- `sessionTextureCache.js` and `localStorage.js` are the two real KTX2 data caches.
- `previewBlobURLs`, `ktx2BlobURLs`, and `zipFiles` are shorter-lived transport/staging layers.

The session cache lives in `sessionTextureCache.js`. Remote downloads populate it directly, and local/cached-local tile reads can also warm it.

---

## What IndexedDB Already Does

IndexedDB is already a valid place to load textures from instead of the cloud, and the app already does that in several paths.

Current behavior:

- The main ribbon viewer checks `getCachedLocalId()` first for cloud textures and loads from IndexedDB when a local cached copy exists.
- The texture overview also prefers IndexedDB when the selected cloud texture is marked as cached.
- The tile-linear preview prefers IndexedDB when the cloud texture has already been cached locally.

So the durable local cache is not hypothetical. It is already part of the normal load path.

---

## Why The In-Memory Session Cache Still Exists

If IndexedDB can already serve the texture, why keep `sessionTextureCache.js` at all?

Because it solves a different problem:

1. It avoids repeated network fetches before the durable local cache exists.
   A texture may be loaded remotely in one surface and only cached to IndexedDB afterward in a background task. During that window, another surface can still reuse the already-downloaded bytes from memory.

2. It dedupes concurrent or near-concurrent remote loads.
   If two surfaces ask for the same remote texture around the same time, they can await one shared in-flight download instead of starting two separate network requests.

3. It avoids forcing persistence as a prerequisite for reuse.
   Durable local caching can fail, be skipped, or be undesirable under quota/storage pressure. Session reuse should still work even if IndexedDB is unavailable or not yet populated.

4. It is cheaper than a write-then-read roundtrip through IndexedDB for immediate reuse.
   If the goal is to reuse bytes during the current session, memory is still the fastest place to do that.

So the in-memory session cache is not replacing IndexedDB. It is covering the hot-session gap before or instead of durable persistence.

---

## How The Layers Interact Today

### Main ribbon viewer

Current load order for cloud textures:

1. Check the shared session cache first when it is enabled for the surface.
2. If there is no warm session entry, check IndexedDB durable cache via `getCachedLocalId()`.
3. If IndexedDB is used, those tile bytes can warm the shared session cache.
4. Otherwise fetch remote metadata and load through `TileManager.loadFromRemote()`.
5. `TileManager.loadFromRemote()` also populates the same shared session cache.
6. After remote success, the viewer writes those bytes to IndexedDB in the background.

### Texture overview

Current load order:

1. If a session entry is already warm, load through the shared session cache.
2. Otherwise, if the texture is local, load from IndexedDB/local storage.
3. If the cloud texture is marked as cached, try IndexedDB.
4. IndexedDB loads can warm the shared session cache for later reuse.
5. Otherwise fetch remote metadata and load through `TileManager.loadFromRemote()`.

### Tile-linear preview

Current load order:

1. If a session entry is already warm, create object URLs directly from it.
2. Otherwise, if the texture is local, read tiles from IndexedDB and create object URLs.
3. If the cloud texture is already cached locally, read from IndexedDB and create object URLs.
4. Those IndexedDB reads can warm the shared session cache.
5. Otherwise fetch remote metadata and ask `sessionTextureCache.js` for the bytes.
6. Convert those bytes into object URLs for `TileLinearViewer`.
7. Persist those blobs to IndexedDB in the background.

### What this means in practice

The architecture is layered like this:

- Hot session reuse: `sessionTextureCache.js`
- Durable local reuse: `localStorage.js`
- Component adapters: object URLs and per-renderer byte staging

These layers do not strictly depend on each other, but they do opportunistically feed each other.

---

## Where Overlap Is Intentional

The same KTX2 bytes may temporarily exist in more than one place at once:

- In `sessionTextureCache.js` as in-memory `Uint8Array`s
- In IndexedDB as durable tile records
- In `previewBlobURLs` as object URLs
- In `TileManager.zipFiles` as per-renderer staging data

That overlap is not automatically a bug. It is the expected cost of having:

- one hot cache layer
- one durable cache layer
- renderer-local staging/adapters

The important question is whether those layers are clearly separated by purpose. Right now, mostly yes.

---

## What Is Redundant Or Messy Today

The bigger issue is not that both caches exist. The bigger issue is that the lookup and writeback policy is spread across multiple places.

Examples:

- The main viewer has its own background IndexedDB writeback path.
- The texture browser preview has another background IndexedDB writeback path.
- Some callers prefer IndexedDB first and only later touch the remote byte cache.
- Some cache-status decisions depend on `cachedCloudIds`, while others call `getCachedLocalId()` directly.

So the architecture has layered caches, but the policy for how to consult them is still partly duplicated at the component level.

---

## Core Conclusions

### 1. Keep both the session cache and the durable cache

This appears to be the right broad architectural decision.

- IndexedDB is the durable, reload-surviving, user-visible local store.
- `sessionTextureCache.js` is the hot, session-scoped reuse layer for bytes regardless of origin.

Those are complementary, not mutually exclusive.

### 2. IndexedDB should remain the durable source of truth for locally cached cloud textures

If a cloud texture has already been cached locally, it is entirely reasonable to load from IndexedDB instead of the network. The app already does this and should continue to do so.

### 3. The in-memory session cache is still justified even with IndexedDB present

It covers:

- immediate cross-surface reuse in the same session
- concurrent deduplication
- reuse before background persistence finishes
- reuse when persistence is unavailable or skipped

### 4. The real cleanup opportunity is policy unification

The biggest opportunity is not removing one of the caches. It is centralizing the logic that decides:

1. whether to use hot memory
2. whether to use durable local storage
3. whether to fetch remotely
4. whether and when to persist the result

That policy is currently distributed across components.

---

## Improvement Opportunities

### 1. Introduce one shared texture-byte resolver

Instead of each surface partially reimplementing cache lookup order, the app could have one service that resolves texture bytes using an explicit precedence policy.

For example:

1. Session memory cache if warm
2. IndexedDB durable cache if available
3. Remote fetch if needed
4. Optional background promotion to IndexedDB

That would make cache behavior easier to reason about and easier to instrument.

### 2. Keep the session cache API source-agnostic

The rename to `sessionTextureCache.js` is done, but the design constraint still matters: the session cache API should stay generic even when one path to populate it is a remote fetch.

That means:

- keep callers talking about `sessionTileEntry` or generic tile entries rather than remote-only names
- keep helper names generic, such as `getOrFetchTextureTiles()` and `getCachedTextureTiles()`
- keep the coordinator as the place that decides when local, durable, or remote paths should warm the session cache

### 3. Centralize background IndexedDB persistence

The app currently has more than one place that takes already-available bytes and writes them to IndexedDB in the background.

That is a reasonable pattern, but the implementation would be clearer if the writeback path lived in one service instead of being repeated per UI surface.

### 4. Use IndexedDB indexes more directly for cache lookups

`localStorage.js` already creates a `cached_from` index, but `getCachedLocalId()` and `getCachedCloudIds()` still perform broader record scans.

That is an obvious refinement if the local texture library continues to grow.

### 5. Add cache telemetry if cache behavior becomes performance-critical

If this architecture becomes important to tune, useful counters would be:

- session cache hit/miss
- IndexedDB cache hit/miss
- remote fetch count
- bytes reused from session cache vs bytes fetched remotely

That would make future cleanup decisions more evidence-based.

---

## Recommended Mental Model

When reasoning about these caches, the best model is:

- `localStorage.js` is the durable library and durable cloud cache.
- `sessionTextureCache.js` is the hot session cache for tile bytes, even when those bytes originally came from IndexedDB.
- object URLs and `zipFiles` are adapters/staging, not authoritative caches.

The overlap between the first two is acceptable. The more important architectural goal is to make their interaction explicit and centralized.
