# Runtime Assets

This directory holds large application-owned runtime binaries that should not be shipped as part of the Cloudflare Pages deploy when external asset hosting is enabled.

## Current Architecture

- Application-owned source binaries live under `runtime-assets/source/`; package-owned binaries can be sourced from pinned dependencies in `node_modules/`.
- The source of truth is `../config/runtimeAssets.mjs`, which defines each logical asset id, its source file, its R2 object key, its local fallback path, and any response metadata such as `Content-Type`, `Cache-Control`, and `Content-Encoding`.
- `../src/modules/shared/runtimeAssets.js` resolves those logical asset ids at runtime.
- In external mode, runtime asset URLs resolve to `VITE_ASSET_BASE_URL + objectKey`.
- In local mode, runtime asset URLs resolve to files copied into the local build output.
- Local mode is used when `VITE_ASSET_BASE_URL` is unset or when `VITE_ASSET_MODE=local` is set.
- `../vite.config.mjs` copies the local fallback files into `dist/` only for local mode. This keeps large binaries out of the Pages bundle when the CDN-backed path is active.
- `../scripts/publish-runtime-assets.mjs` uploads manifest-listed assets to the existing `rivvon-textures` R2 bucket under the `runtime-assets/` namespace.
- CI runs that publisher on pushes to `main` when the manifest, this directory, publish script, app dependency manifest, or workspace lockfile changes. Pages deployment waits for the upload. PR previews require the versioned assets to be published already.

## Current Asset Strategy

- `rife422Model` is stored and published as a raw ONNX file.
- `ffmpegCoreWasm` is sourced from `@ffmpeg/core@0.12.10` and published as `application/wasm` with immutable caching. Its matching JS loader stays on Pages; local mode copies WASM into `vendor/ffmpeg/0.12.10/` alongside it.
- `u2netModel` is published as a Brotli-compressed source file (`u2net.quant.onnx.br`) to a plain `.onnx` object key with `Content-Encoding: br`.
- Local builds copy the raw `u2net.quant.onnx` fallback so local development does not depend on CDN delivery or compressed-origin handling.
- The older ZIP-based U2Net delivery path is not part of the active manifest anymore.

## Rationale

- Cloudflare Pages has a per-file size limit that large models can exceed.
- R2 plus the CDN custom domain lets the app fetch large runtime binaries without bloating the Pages deploy.
- A checked-in manifest keeps the repo as the source of truth for what should exist in object storage.
- Runtime code refers to logical asset ids instead of hardcoded URLs, which keeps local and external delivery modes behind one abstraction.
- Local fallback mode keeps experimentation practical without requiring every asset edit to be published before it can be tested.
- The Brotli-backed U2Net path keeps transfer size close to the old ZIP approach while removing client-side JSZip extraction from the active runtime path.

## Operational Notes

- Treat published object keys as immutable. If an asset changes incompatibly, prefer a new object key rather than mutating an old one silently.
- The publish script currently performs uploads only. It does not delete objects that are no longer present in the manifest.
- Standard Cloudflare edge caching applies to these R2-backed custom-domain assets. Long TTL improves freshness behavior, but it does not guarantee indefinite residency in cache.
- If Cloudflare-specific delivery behavior changes for a given asset, prefer expressing that in the manifest and publish flow instead of scattering one-off rules in feature code.

## Opportunities

- Add a safe pruning workflow for objects under the `runtime-assets/` prefix that are no longer present in the manifest. This should start as a dry-run diff before any destructive mode is introduced.
- Add manifest-level hashes or size metadata so CI can verify uploads more explicitly.
- Expand the same pattern to additional large WASM or demo assets if they begin to threaten deploy size or deserve an independent release cadence.
