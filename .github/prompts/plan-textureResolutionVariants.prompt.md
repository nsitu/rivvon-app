## Plan: Texture Resolution Variants

This plan is now post-feasibility. Browser-side local variant derivation is working end to end: a dedicated Basis transcode worker decodes multi-layer KTX2 tiles to RGBA, per-layer downscaling and re-encode reuse the existing KTX2 worker pool and assembler, the browser can create a full lower-resolution local variant across every tile, source cloud textures are cached when derived locally, and derived local textures keep lineage metadata and can be applied immediately from TextureBrowser. The remaining work is to promote that local capability into a full texture-family system across D1, API responses, browser family cards, viewer resolution preference, and family-aware cloud workflows.

## Architecture Reset — April 2026

The clarified product scope is narrower than the implementation direction above. The primary use case for lower-resolution variants is accessibility for already-published textures, which changes the canonical model in a few important ways:

1. A texture family becomes canonical only in cloud storage. The root is published first, then derived variants are generated and uploaded as cloud children of that root.
2. A derivation job is not complete when browser-side re-encoding finishes. It is complete only after the derived texture has also been uploaded and registered in the cloud.
3. Local derived variants should be treated as transient job artifacts, not durable library entries. They may exist briefly in memory or temporary cache during a derivation/upload flow, but they should not drive the long-term Texture Browser model.
4. The Texture Browser should therefore optimize for two stable states:
   - local drafts / unpublished roots
   - published cloud families
     and not for mixed-storage families where the root is published but the derived child exists only locally.
5. Creation-time derived-resolution settings remain valid only when the user is also choosing to publish. In practice, an `Upload to Cloud` toggle should gate the derived-resolution options, because selecting derivations now implies `encode root -> upload root -> derive child variants -> upload child variants` as one publish workflow.
6. The Texture Browser tab names should reflect these lifecycle states directly. In practice, `Drafts` and `Cloud Cache` are clearer than generic labels like `Local` and `Cached`.

This means some of the recently implemented local-family behavior is broader than the intended v1 scope. It still works as plumbing, but it should now be treated as superseded by a cloud-canonical derivation model rather than as the target UX.

## Local Drafts vs Local Cache

There is also an opportunity to simplify the local model by treating local drafts and local cached cloud textures as two roles on top of the same IndexedDB substrate rather than as unrelated concepts.

1. A local draft is an unpublished working copy. Its primary identity is local.
2. A local cached texture is a mirror of a published cloud texture. Its primary identity is the cloud texture ID, while the local bytes are disposable acceleration.
3. When a local draft is uploaded successfully, the optimal v1 behavior is not to keep it around as a separate local draft plus later download a new cache copy. Instead, the existing local bytes should be promoted in place to become the cache entry for the newly published cloud texture.
4. This promotion should update the local record from `draft` semantics to `cache` semantics by attaching `cached_from` and the published family metadata, so the uploaded texture can be used immediately through the local cache without re-downloading.
5. Under this model, the local drafts tab naturally shrinks after publication, while the cloud card immediately gains cached/offline-ready behavior.

This suggests an explicit state machine:

1. local draft
2. publishing
3. cached copy of published cloud texture

For variants created during a publish flow, the same principle applies: once a derived child uploads successfully, the generated local bytes can be retained as the cache mirror of that cloud child instead of being treated as an independent local library entry.

**Status Summary**

- Complete foundation: worker derivation, family data model, API family flows, browser family cards, and root-first family upload orchestration.
- Superseded by scope reset: persistent local derived-family UX and post-save local-family upload as the default mental model.
- Next architecture pass: refactor the user-facing flows around cloud-canonical publication and derivation completion semantics.

**Phases**

1. Phase 0 — Worker-based KTX2 derivation foundation `[Complete]`: the worker-based roundtrip succeeded and is now real code, not a spike. `ktx2 array texture -> per-layer rgba -> downscale each layer -> re-encode each layer -> reassemble KTX2 array texture` works in-browser with `basis_transcoder.*`, the transcode worker, the shared encode worker pool, and the KTX2 assembler. Verified outcomes so far: representative-tile validation at 1024 -> 512, full-set local derivation at 1024 -> 256 across 3 tiles, preserved layer count/order/mips, viewer-compatible output, and materially better encode time with the shared adaptive worker policy. Do not spend more time on a GPU fallback unless a new format limitation appears.
2. Phase 1 — Family data model `[Complete]`: `parent_texture_set_id` now exists in D1 schema and migration form, is indexed, and is treated as a root/original pointer for derived variants.
3. Phase 2 — API creation flow `[Complete]`: `POST /texture-set` now accepts optional `parentTextureSetId`, normalizes children back to the family root, enforces family compatibility constraints, and reuses the existing upload/complete pipeline.
4. Phase 3 — API read flow `[Complete]`: `GET /textures` now returns root textures only with additive family summary fields such as `root_texture_id`, `available_resolutions`, and `variant_summaries`. `GET /textures/:id` still returns the exact concrete root/variant row and tiles for the requested ID, with additive family summary metadata attached.
5. Phase 4 — Local storage model `[Complete, likely over-scoped]`: IndexedDB texture-set records now normalize onto the same explicit family model as cloud data with `root_texture_id`, `parent_texture_set_id`, root-family indexes, migration of legacy records during the DB upgrade, and local family helper queries. Under the April 2026 scope reset, this should be retained mainly for local drafts and transient cache coherence, not as a primary published-family surface.
6. Phase 5 — Shared family resolver `[Complete]`: a shared resolver/helper now groups flat records into families, normalizes `variant_summaries`, and selects the active concrete variant from a family using the desired rule: highest available resolution less than or equal to the preferred max, otherwise the smallest resolution above it.
7. Phase 6 — Shared derivation pipeline `[Complete]`: the non-reactive derivation module now supports `AbortSignal`, reusable multi-target family derivation, workload assessment helpers for memory-sensitive devices, and root-first cloud family upload orchestration for both Google Drive and R2. The active architectural direction is now to use this pipeline as `derive-and-upload`, not `derive-and-store-locally`.
8. Phase 7 — Browser UX refactor `[Complete, requires narrowing]`: TextureBrowser now renders one card per family for both local and cloud textures, shows resolution badge rows, highlights the active concrete variant under the global cap, and only offers missing lower POT targets beneath the family root when creating a local variant. Under the April 2026 scope reset, the derive action should move toward cloud-published families as the canonical target and away from durable local-child outcomes.
9. Phase 8 — Selection and preview behavior `[Complete]`: browser card selection, preview, and multi-select now resolve through the shared family resolver so the viewer loads the active concrete variant ID rather than a flat root-only list item.
10. Phase 9 — Viewer preference `[Complete]`: `preferredTextureMaxResolution` now lives in `viewerStore`, defaults to 256 on mobile/coarse-pointer devices and 512 on desktop, persists to browser storage, and is exposed via a PrimeVue `Select` in the tools panel.
11. Phase 10 — Family-aware copy `[Complete]`: copy-to-cloud / copy-to-R2 now uploads the canonical source root first, then carries the remaining family variants in descending resolution order so root-child relationships are recreated correctly in the destination provider. Pragmatic partial-failure behavior is implemented in the browser: successful copies stay put, missing variants are surfaced, and the user can retry only the missing variants without pretending there is a cross-storage transaction.
12. Phase 11 — Upload-time automation `[Complete in plumbing, needs UX reset]`: Slyce settings now expose target derived resolutions and the code can upload a root-first family. Under the clarified scope, these derived-resolution settings should be gated behind an `Upload to Cloud` choice, because selecting them implies a publish workflow rather than a local-save workflow.
13. Phase 12 — Edit/delete semantics `[Complete]`: card-level rename now behaves as a family rename, syncing cloud child names through the API and local child names through IndexedDB updates. Root deletes already remove the whole family in cloud and local browser flows; child-only delete/regenerate can still live behind a variants action menu if needed.
14. Phase 13 — Cache semantics `[Complete]`: cache entries remain keyed by concrete cloud variant ID, which is the correct base rule, and the browser now aggregates cached state, cached tabs, and cache eviction at the family-card level while local derivation continues to cache cloud sources when deriving from cloud.
15. Phase 14 — Rollout hardening `[Complete in infrastructure, needs product-policy tightening]`: legacy IndexedDB records are migrated and normalized, long variant jobs now surface explicit progress and notice messaging, root saves survive variant cancellation/failure, lower-memory devices receive workload guidance, and file-mode results expose cancellation for local family generation. With the scope reset, completion/error semantics should now be defined around cloud publication success rather than local save success.

**Implications For The Active UX**

1. Derive from Texture Browser should target published cloud roots/families first. The result of a successful derive action is a new cloud child variant, not a durable local texture card.
2. File-mode Slyce should separate `save locally` from `publish`. If `Upload to Cloud` is off, the output is just a root draft. If `Upload to Cloud` is on, derived-resolution controls appear and the workflow becomes one publish transaction: upload root first, then derive and upload selected variants.
3. The current `Upload Saved Family` post-processing panel is broader than the intended model. The preferred flow is to decide publish intent up front, not to save a local family and then optionally upload it later.
4. Local cache of cloud roots remains useful as an implementation detail for browser derivation and preview performance, but cache entries should not be treated as equivalent to published variants in the user mental model.
5. Partial failure handling should now be phrased as `published root with missing requested variants`, not `local family partially saved`.
6. Successfully published local drafts should be promoted to cache entries in place so the viewer and preview layers can immediately reuse the local bytes through the existing cache-preference path.
7. Texture Browser navigation should use lifecycle-oriented labels such as `Drafts`, `My Published`, `Published`, and `Cloud Cache` so users can tell unpublished local work apart from cached cloud mirrors.

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
- `d:/rivvon-app/apps/rivvon/src/components/slyce/OutputActions.vue` — surface family save notices, cancellation, and direct root-first upload actions after processing.
- `d:/rivvon-app/apps/rivvon/src/modules/slyce/ktx2RoundtripVariant.js` — live derivation orchestration module for local/manual variant generation.
- `d:/rivvon-app/apps/rivvon/src/modules/slyce/textureFamilyPlanning.js` — lightweight workload-planning helpers shared by settings, persistence, and derivation orchestration.
- `d:/rivvon-app/apps/rivvon/src/modules/slyce/localTexturePersistence.js` — file-mode family save workflow that persists the root first, optionally derives local variants, and preserves partial progress.
- `d:/rivvon-app/apps/rivvon/src/modules/slyce/videoProcessor.js` — current seam where root encoding completes and where a publish-first root upload plus follow-on derive/upload pipeline should be attached.
- `d:/rivvon-app/apps/rivvon/src/services/localStorage.js` — should become the home of a `promote draft to cached cloud texture` helper so upload flows can reuse local bytes without duplicating storage.
- `d:/rivvon-app/apps/rivvon/src/workers/ktx2TranscodeWorker.js` — live decode worker used for per-layer RGBA extraction from saved KTX2 tiles.
- `d:/rivvon-app/apps/rivvon/src/modules/slyce/ktx2-worker-pool.js` — reused for re-encoding derived tiles.
- `d:/rivvon-app/apps/rivvon/src/modules/slyce/ktx2-assembler.js` — reused for assembling derived KTX2 array textures.
- `d:/rivvon-app/apps/rivvon/public/wasm/basis_transcoder.js` and `d:/rivvon-app/apps/rivvon/public/wasm/basis_transcoder.wasm` — decode runtime used by the live browser derivation path.
- Recommended new frontend modules: one shared family resolver/helper. The derivation orchestration module and decode worker now already exist.

**Verification**

1. Complete: validate the worker decode path on a representative multi-layer tile and confirm timings, preserved layers, mip behavior, and viewer compatibility. This is done.
2. Complete: derive a full local variant from a cloud texture and confirm it saves locally, carries lineage metadata, and applies cleanly through the viewer. This is done for a 3-tile 1024 -> 256 set.
3. Pending, revised: validate a publish-first file-mode flow where enabling `Upload to Cloud` uploads the root before deriving/uploading any requested variants.
4. Pending, revised: derive additional variants from an already-published cloud root and verify the browser only ever shows the cloud family state, not a durable local-only child state.
5. Pending, revised: upload a local draft root and confirm the same IndexedDB bytes are repurposed as the cache entry for the new cloud texture without a re-download.
6. Pending: change the global preferred max resolution between 256 and 512 and confirm browser selection, preview, and RibbonView load the expected concrete variant IDs.
7. Pending: copy a local family to cloud and verify all child variants are copied and linked to the new cloud root.
8. Pending: delete a root family and confirm all child variants are removed in D1/R2/Drive and from IndexedDB.
9. Pending: rename a family and confirm all variants keep the same display name in browser cards and load flows.
10. Pending: exercise cached cloud variants, mixed cached/non-cached families, and multi-select to confirm family grouping does not create duplicate cards or wrong resolution loads.

**Decisions**

- Treat cloud publication as the canonical home of a complete texture family.
- Keep local drafts, but do not treat locally derived children as the intended end-state for accessibility variants.
- Support on-demand derivation from published cloud textures and automatic derivation during initial publish flows.
- Gate creation-time derived resolutions behind explicit publish intent.
- Treat local draft and local cache as two lifecycle states over the same local storage substrate, and prefer in-place draft-to-cache promotion after successful upload.
- Use a global preferred maximum resolution instead of connection sniffing; default to 256 on mobile and 512 on desktop.
- Keep family relationships single-level: all children point to the root/original.
- When deriving from a cloud texture in the browser, caching the source locally is desirable as an implementation detail, but the derived result should still only count once uploaded to cloud.

**Further Considerations**

1. The worker-based Basis decode path is proven, so treat GPU fallback or server-side derivation as contingency work only if a new unsupported format or memory ceiling appears.
2. The first publish-time automation pass should reuse the post-encode derivation pipeline, even though it implies second-generation compression. Only optimize to pre-encode RGBA branching or source-video-preserving workflows if quality or runtime proves unacceptable.
3. Because root publication precedes derivation in the canonical model, the browser can simplify many mixed local/cloud family cases away. The main remaining complexity is retrying missing cloud variants under an already-published root.
4. Realtime webcam textures can still benefit from the browser-based derivation path immediately, but the same publish-first rule should apply if those variants are meant to become part of the published library.
5. The current cache API is already close to supporting promotion because viewer and browser paths already prefer a cached local copy when `cached_from` points at a cloud texture ID. The missing piece is an explicit promotion/update path rather than creating a second cached record after upload.
