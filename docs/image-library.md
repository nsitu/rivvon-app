# Image resources and backgrounds

Browse → Images opens `/images` over the existing viewer. Built-in images are
available without signing in. My Images supports authenticated upload, preview,
rename, deletion, and Apply as background. Uploading alone does not change the
scene. The current image and Change image action appear under Static Texture.

The **Blend dropdown** offers **Normal** and **Soft Light**. Existing scenes and
built-ins retain Soft Light by default; switching from built-in to uploaded
images selects Normal. Replacing a source of the same kind retains the chosen
blend. Both modes respect image alpha, cover fitting, vertical alignment,
contrast, saturation, and gradient mapping in WebGL and WebGPU. Disabling Static
Texture keeps its image selection.

The picker preserves Tools' original-state snapshot on cancellation. In Export
Video it hides the existing export panel without unmounting it; closing or
applying returns to that panel with its form state intact. Image replacement
and blend controls are disabled during encoding. Browsing retains the current
scene/query and closing uses browser history when opened from the viewer.

## Uploads and access

- Accept JPEG, PNG, and static WebP, at most 20 MiB and 40 megapixels.
- Inspect dimensions and reject unsupported/animated containers before decoding.
- Apply EXIF orientation and rasterize in the browser to remove embedded metadata.
- Save a render image of at most 4096 pixels on its longest side and a thumbnail
  of at most 512 pixels. The original source file is not retained. Actual stored
  format follows the browser canvas encoder, including its PNG fallback.
- Validate actual size, MIME signature, dimensions, upload expiry, and required
  objects on the server. Request bodies are read incrementally with a hard byte
  cap, then stored as bounded buffers in R2.
- Process the upload queue sequentially with per-file progress, cancel, and retry.

`image_assets` stores owner-scoped metadata in D1. Immutable raster objects and
thumbnails live in the private `IMAGES_BUCKET`. A separate object key per upload
attempt prevents late writes from overwriting completed images. Conditional
updates prevent completion or upload requests from reviving a deleting asset.
An hourly cleanup retries deletion and removes expired pending uploads, up to
50 image records per run. No new upload-signing credentials are needed.

Image bytes and thumbnails are fetched with session credentials and delivered
with `private, no-store` caching. The bounded in-memory texture cache deduplicates
requests, separates access scopes, and pins textures until all scene/preview
consumers release them. Account changes invalidate private cached resources.
Active renderer size limits are enforced when applying an image.

## Presets and exports

Preset schema version 2 adds a validated `{ kind, id }` background reference and
blend mode. Version-1 scenes and existing preferences migrate to their matching
built-in and Soft Light. The legacy built-in string remains as a compatibility
mirror; the discriminated reference determines the image used by the renderer.
Transient preset access grants and Blob URLs are not serialized into artwork.

An uploaded image retained by a preset is a dependency even when Static Texture
is disabled. A visible preset grants read access to that specific image through
the API, without listing it in another user's library. Derivative presets retain
the same image reference. A preset does not make a separate image copy.

Deleting an image reviews and requires consent for linked preset deletion,
including a server recheck for newly added links. Deleting a preset alone keeps
its images. D1 readiness/deletion triggers enforce these rules during races.

Replacement failures preserve the previous scene. A missing saved image leaves
its reference available for replacement, displays an error, and does not prevent
viewer initialization. Still/video exports wait for background readiness and
reject an unavailable enabled image instead of silently exporting a different
background. The live texture-overview video exporter also waits for readiness.

## Deployment

The implementation is local and has not been deployed. Before releasing it:

1. Create the `rivvon-images` R2 bucket named by `IMAGES_BUCKET` in
   `apps/api/wrangler.toml`. Keep r2.dev disabled and attach no public domain.
   The existing Worker binding supplies storage access.
2. Apply D1 migrations through `013_image_assets.sql` using
   `pnpm --filter api db:migrations:apply:remote`. The migration preserves existing
   texture/audio dependency rows while extending the exclusive dependency
   constraint and recreating its indexes/triggers.
3. Deploy the API before the viewer so both preset versions are accepted before
   the frontend starts writing version 2. The configured Worker cron performs
   image cleanup hourly.
4. Deploy the viewer and verify an authenticated upload and a shared preset
   against the real private bucket. API tests use in-memory R2 fixtures and real
   SQLite; no production upload was made during implementation.

For local API development use `db:migrations:apply:local` and point
`VITE_API_URL` at the local Worker. Built-in browsing and blending work without
the image bucket or a signed-in account.

## Verification

Frontend and API Vitest suites cover legacy migration, source/blend persistence,
byte validation, access grants, immutable writes, cleanup, linked-preset consent,
race handling, reference-counted caching, failed replacement/restore, and export
readiness. Browser checks covered narrow/desktop galleries, preview and Apply,
Normal/Soft Light in both renderers, Tools cancellation, signed-out My Images,
and preserving the Export Video panel across image selection.

The API's existing standalone TypeScript check still reports errors in the
unchanged audio upload, video routes, and texture-upload test files. Both
production builds and the complete Vitest suites pass.
