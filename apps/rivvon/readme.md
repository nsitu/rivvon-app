# Note

Docs are in ./docs

## Runtime Assets

Large runtime binaries can be hosted outside the Pages deploy by setting `VITE_ASSET_BASE_URL` to a CDN base such as `https://cdn.rivvon.ca/`.

The source of truth for large runtime binaries lives in `config/runtimeAssets.mjs`. The shared resolver in `src/modules/shared/runtimeAssets.js` maps logical asset ids to versioned object keys under that base and falls back to local copied assets when `VITE_ASSET_BASE_URL` is unset.

Large source binaries should live under `runtime-assets/source/`, not `public/`. Vite copies them into the local build only when `VITE_ASSET_BASE_URL` is unset or `VITE_ASSET_MODE=local` is set.

U2Net now uses a raw local `u2net.quant.onnx` fallback and a Brotli-compressed upload source (`u2net.quant.onnx.br`) with `Content-Encoding: br` so production fetches get native browser decompression without the previous JSZip extraction step.

Set `VITE_ASSET_MODE=local` to force local copied assets even when `VITE_ASSET_BASE_URL` is configured. This is intended for local iteration before a new model or other large binary is published.

Use `pnpm --filter rivvon publish:runtime-assets` to upload manifest-managed runtime assets to the configured R2 bucket. Add `-- --dry-run` to inspect which assets would be published.

## Realtime Sampling

See [docs/realtime-sampling.md](./docs/realtime-sampling.md) for the current realtime webcam sampling design, why staging is now used everywhere, and why we intentionally do not enable `willReadFrequently` on the active sampling canvases.

## Head Tracking / MediaPipe

See [docs/head-tracking-mediapipe-patch.md](./docs/head-tracking-mediapipe-patch.md) for the rationale behind the version-pinned `@mediapipe/tasks-vision` patch, how the local wasm override works, and the workflow for updating the patch during a future library bump.

In a previous version I used coi-serviceworker.js to allow for SharedArrayBuffer to work, but that was when we were attempting to get the ktx2 encoder to work in mlutithreeaded mode. but now we spawn multiple ktx2 encoders inside of workers to avoid having to use shared array buffer.

If you still see coi-serviceworker hanging around in chrome dev tools, you can Un register the service worker in >Applicaiton . Service Workers
