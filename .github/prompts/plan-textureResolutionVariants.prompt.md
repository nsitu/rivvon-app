## Plan: Texture Resolution Variants

This plan is now post-feasibility. Browser-side local variant derivation is working end to end: a dedicated Basis transcode worker decodes multi-layer KTX2 tiles to RGBA, per-layer downscaling and re-encode reuse the existing KTX2 worker pool and assembler, the browser can create a full lower-resolution local variant across every tile, source cloud textures are cached when derived locally, and derived local textures keep lineage metadata and can be applied immediately from TextureBrowser. The remaining work is to promote that local capability into a full texture-family system across D1, API responses, browser family cards, viewer resolution preference, and family-aware cloud workflows.

**Status Summary**

- Complete: Phases 0, 1, 2, 3, and 5.
- Partial: Phases 4, 6, 7, 8, and 13.
- Pending: Phases 9, 10, 11, 12, and 14.

**Phases**

1. Phase 0 — Worker-based KTX2 derivation foundation `[Complete]`: the worker-based roundtrip succeeded and is now real code, not a spike. `ktx2 array texture -> per-layer rgba -> downscale each layer -> re-encode each layer -> reassemble KTX2 array texture` works in-browser with `basis_transcoder.*`, the transcode worker, the shared encode worker pool, and the KTX2 assembler. Verified outcomes so far: representative-tile validation at 1024 -> 512, full-set local derivation at 1024 -> 256 across 3 tiles, preserved layer count/order/mips, viewer-compatible output, and materially better encode time with the shared adaptive worker policy. Do not spend more time on a GPU fallback unless a new format limitation appears.
2. Phase 1 — Family data model `[Complete]`: `parent_texture_set_id` now exists in D1 schema and migration form, is indexed, and is treated as a root/original pointer for derived variants.
3. Phase 2 — API creation flow `[Complete]`: `POST /texture-set` now accepts optional `parentTextureSetId`, normalizes children back to the family root, enforces family compatibility constraints, and reuses the existing upload/complete pipeline.
4. Phase 3 — API read flow `[Complete]`: `GET /textures` now returns root textures only with additive family summary fields such as `root_texture_id`, `available_resolutions`, and `variant_summaries`. `GET /textures/:id` still returns the exact concrete root/variant row and tiles for the requested ID, with additive family summary metadata attached.
5. Phase 4 — Local storage model `[Partial]`: IndexedDB texture-set records already persist `derived_from` and `variant_info` with lineage metadata and work without a schema migration. Remaining work is to normalize local records onto the same explicit family model as cloud data, likely by adding `parent_texture_set_id` and root-family helpers once family grouping is introduced.
6. Phase 5 — Shared family resolver `[Complete]`: a shared resolver/helper now groups flat records into families, normalizes `variant_summaries`, and selects the active concrete variant from a family using the desired rule: highest available resolution less than or equal to the preferred max, otherwise the smallest resolution above it.
7. Phase 6 — Shared derivation pipeline `[Partial]`: a non-reactive derivation module and decode worker already exist and can derive a full texture set from fetched cloud tiles or local blobs, reuse one shared encode worker pool across all tiles, report progress, and return a payload ready for local save. Remaining work is cancellation, upload-time reuse, and cloud upload orchestration against the eventual family model.
8. Phase 7 — Browser UX refactor `[Partial]`: TextureBrowser already supports “Create Local Variant”, saves the result to My Local, shows derived lineage on local cards, and can apply the saved variant immediately. Remaining work is the actual family UX: one card per family, resolution badge rows, active-resolution indication under the global cap, and only offering missing lower POT targets beneath the family root.
9. Phase 8 — Selection and preview behavior `[Partial]`: the viewer path already loads concrete variant IDs cleanly, which is compatible with the target end state. Remaining work is to make browser selection, preview, and multi-select family-aware through the shared resolver rather than a flat texture list.
10. Phase 9 — Viewer preference `[Pending]`: add `preferredTextureMaxResolution` to `viewerStore`, default it to 256 on mobile/coarse-pointer devices and 512 on desktop, persist it, and expose it via a PrimeVue `Select` in the tools panel.
11. Phase 10 — Family-aware copy `[Pending]`: update copy-to-cloud / copy-to-R2 so copying a family carries every variant in descending resolution order and recreates root-child relationships in the destination provider. Pragmatic failure behavior remains: keep successful copies, surface missing variants for retry, and avoid pretending there is a cross-storage transaction.
12. Phase 11 — Upload-time automation `[Pending]`: add a Slyce setting for target derived resolutions so file-mode create flows can optionally auto-generate lower-res variants after the root texture is encoded. The first implementation should reuse the existing post-encode derivation pipeline against in-memory root KTX2 blobs rather than changing the core video sampling path.
13. Phase 12 — Edit/delete semantics `[Pending]`: treat card-level rename as a family rename and keep child names synchronized with the root. Treat deleting a root as deleting the family; child-only delete/regenerate can live behind a variants action menu if needed.
14. Phase 13 — Cache semantics `[Partial]`: cache entries are still keyed by concrete cloud variant ID, which is the correct base rule. Current local derivation also caches the cloud source when deriving from cloud, and that behavior should stay. Remaining work is to aggregate cache state at the family level once family cards and resolver logic exist.
15. Phase 14 — Rollout hardening `[Pending]`: add migration(s), legacy handling, large-job memory safeguards, cancellation UX, and explicit messaging for long-running derivation jobs or mobile OOM conditions.

**Relevant files**

- `d:/rivvon-app/apps/api/db/schema.sql` — add `parent_texture_set_id` and family indexes.
- `d:/rivvon-app/apps/api/db/migrations/` — add a migration for the family relationship.
- `d:/rivvon-app/apps/api/routes/upload.ts` — extend create flow to accept `parentTextureSetId`; keep upload/complete behavior compatible.
- `d:/rivvon-app/apps/api/routes/textures.ts` — return root-only family summaries in list responses and additive family metadata in detail responses.
- `d:/rivvon-app/apps/api/utils/textureFamilies.ts` — shared API-side family aggregation and summary decoration used by list/detail routes.
- `d:/rivvon-app/apps/rivvon/src/services/localStorage.js` — current local lineage persistence lives here; extend it to explicit local family fields when shared family grouping lands.
- `d:/rivvon-app/apps/rivvon/src/services/textureService.js` — consume family summary fields and any new list/detail response shape.
- `d:/rivvon-app/apps/rivvon/src/modules/shared/textureFamilyResolver.js` — shared frontend family grouping and variant resolution helper.
- `d:/rivvon-app/apps/rivvon/src/services/api.js` — pass `parentTextureSetId` when creating child variants and orchestrate family uploads/copies.
- `d:/rivvon-app/apps/rivvon/src/components/viewer/TextureBrowser.vue` — current local variant creation and lineage UI live here; remaining work is family cards, resolution badges, and family-aware copy/delete/edit flows.
- `d:/rivvon-app/apps/rivvon/src/views/RibbonView.vue` — keep loading resolved concrete variant IDs while remaining agnostic to family grouping.
- `d:/rivvon-app/apps/rivvon/src/composables/viewer/useTextureLoader.js` — confirm callers pass concrete resolved variant IDs/records.
- `d:/rivvon-app/apps/rivvon/src/stores/viewerStore.js` — add persistent global preferred max resolution.
- `d:/rivvon-app/apps/rivvon/src/components/viewer/BottomToolbar.vue` — add the global preferred max-resolution selector in the tools panel.
- `d:/rivvon-app/apps/rivvon/src/stores/slyceStore.js` — hold automatic derived-resolution targets / derivation job state if upload-time automation is added.
- `d:/rivvon-app/apps/rivvon/src/components/slyce/SettingsArea.vue` or nearby Slyce settings UI — configure automatic derived resolutions for newly created textures.
- `d:/rivvon-app/apps/rivvon/src/modules/slyce/ktx2RoundtripVariant.js` — live derivation orchestration module for local/manual variant generation.
- `d:/rivvon-app/apps/rivvon/src/workers/ktx2TranscodeWorker.js` — live decode worker used for per-layer RGBA extraction from saved KTX2 tiles.
- `d:/rivvon-app/apps/rivvon/src/modules/slyce/ktx2-worker-pool.js` — reused for re-encoding derived tiles.
- `d:/rivvon-app/apps/rivvon/src/modules/slyce/ktx2-assembler.js` — reused for assembling derived KTX2 array textures.
- `d:/rivvon-app/apps/rivvon/public/wasm/basis_transcoder.js` and `d:/rivvon-app/apps/rivvon/public/wasm/basis_transcoder.wasm` — decode runtime used by the live browser derivation path.
- Recommended new frontend modules: one shared family resolver/helper. The derivation orchestration module and decode worker now already exist.

**Verification**

1. Complete: validate the worker decode path on a representative multi-layer tile and confirm timings, preserved layers, mip behavior, and viewer compatibility. This is done.
2. Complete: derive a full local variant from a cloud texture and confirm it saves locally, carries lineage metadata, and applies cleanly through the viewer. This is done for a 3-tile 1024 -> 256 set.
3. Pending: create a local root texture plus multiple local variants and verify each child stores the explicit root relationship field expected by the shared family resolver.
4. Pending: upload a root + variants family to Google Drive and to R2; verify the browser shows one family card with all resolutions.
5. Pending: change the global preferred max resolution between 256 and 512 and confirm browser selection, preview, and RibbonView load the expected concrete variant IDs.
6. Pending: copy a local family to cloud and verify all child variants are copied and linked to the new cloud root.
7. Pending: delete a root family and confirm all child variants are removed in D1/R2/Drive and from IndexedDB.
8. Pending: rename a family and confirm all variants keep the same display name in browser cards and load flows.
9. Pending: exercise cached cloud variants, mixed cached/non-cached families, and multi-select to confirm family grouping does not create duplicate cards or wrong resolution loads.

**Decisions**

- Support both local and cloud families.
- Copying a texture to cloud should copy its variants too, preserving the family relationship in the destination.
- Support both on-demand derivation from TextureBrowser and automatic derivation during initial create/upload flows.
- Use a global preferred maximum resolution instead of connection sniffing; default to 256 on mobile and 512 on desktop.
- Keep family relationships single-level: all children point to the root/original.
- When deriving from a cloud texture in the browser, caching the source locally is desirable and should remain part of the flow.

**Further Considerations**

1. The worker-based Basis decode path is proven, so treat GPU fallback or server-side derivation as contingency work only if a new unsupported format or memory ceiling appears.
2. The first upload-time automation pass should reuse the post-encode derivation pipeline, even though it implies second-generation compression. Only optimize to pre-encode RGBA branching if quality or runtime proves unacceptable.
3. Realtime webcam textures can still benefit from the browser-based derivation path immediately; dedicated realtime auto-derive hooks can remain a follow-up unless they are required for v1.
