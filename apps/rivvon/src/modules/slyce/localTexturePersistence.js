import { saveTextureSet } from '../../services/localStorage.js';
import {
    assessTextureVariantDerivationWorkload,
    normalizeTextureVariantTargetResolutions,
} from './textureFamilyPlanning.js';

function getDefaultTextureName(fileInfo) {
    return fileInfo?.name?.replace(/\.[^.]+$/, '') || 'texture';
}

function buildDerivedTextureName(textureName, targetResolution) {
    return `${String(textureName || 'texture').replace(/\s+\(\d+px\)$/i, '').trim()} (${targetResolution}px)`;
}

function getEffectiveFrameCount(app) {
    return app.framesToSample > 0
        ? Math.min(app.framesToSample, app.frameCount)
        : app.frameCount;
}

async function blobToDataUrl(blob) {
    return new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(blob);
    });
}

async function collectKtx2BlobsFromUrls(blobUrls = {}) {
    const ktx2Blobs = {};
    for (const [tileIndex, blobUrl] of Object.entries(blobUrls)) {
        const response = await fetch(blobUrl);
        if (!response.ok) {
            throw new Error(`Failed to load generated tile ${tileIndex}`);
        }
        ktx2Blobs[tileIndex] = await response.blob();
    }
    return ktx2Blobs;
}

function buildDefaultSourceMetadata(source, effectiveFrameCount) {
    return {
        filename: source.fileInfo?.name,
        width: source.fileInfo?.width,
        height: source.fileInfo?.height,
        duration: source.fileInfo?.duration,
        sourceFrameCount: effectiveFrameCount,
        frame_count: effectiveFrameCount,
    };
}

function buildSourceTilesFromBlobs(ktx2Blobs = {}) {
    return Object.entries(ktx2Blobs)
        .map(([tileIndex, blob]) => ({
            tileIndex: Number(tileIndex),
            source: blob,
            label: `tile-${tileIndex}`,
        }))
        .sort((left, right) => left.tileIndex - right.tileIndex);
}

function formatFamilySaveProgress(stage) {
    switch (stage?.stage) {
        case 'variant-start':
            return `Generating ${stage.targetResolution}px variant (${stage.variantNumber}/${stage.variantCount})...`;
        case 'variant-progress':
            return `Generating ${stage.targetResolution}px variant (${stage.variantNumber}/${stage.variantCount})...`;
        case 'variant-complete':
            return `Generated ${stage.targetResolution}px variant (${stage.variantNumber}/${stage.variantCount}).`;
        default:
            return 'Generating local variants...';
    }
}

function buildVariantProgressMessage(stage) {
    if (stage?.stage !== 'variant-progress') {
        return formatFamilySaveProgress(stage);
    }

    switch (stage?.nestedStage) {
        case 'tile-start':
            return `Generating ${stage.targetResolution}px variant: tile ${stage.tileNumber}/${stage.tileCount}...`;
        case 'tile-progress':
            switch (stage?.nestedStage) {
                default:
                    return `Generating ${stage.targetResolution}px variant: tile ${stage.tileNumber}/${stage.tileCount}...`;
            }
        case 'decode-layer':
            return `Generating ${stage.targetResolution}px variant: decoding layer ${stage.layerIndex + 1}/${stage.layerCount} for tile ${stage.tileNumber}/${stage.tileCount}...`;
        case 'layer-complete':
            return `Generating ${stage.targetResolution}px variant: scaled layer ${stage.layerIndex + 1}/${stage.layerCount} for tile ${stage.tileNumber}/${stage.tileCount}...`;
        case 'encode':
            return `Generating ${stage.targetResolution}px variant: encoding tile ${stage.tileNumber}/${stage.tileCount}...`;
        case 'encode-progress':
            return `Generating ${stage.targetResolution}px variant: encoding layer ${stage.completed}/${stage.total} for tile ${stage.tileNumber}/${stage.tileCount}...`;
        case 'tile-complete':
            return `Generating ${stage.targetResolution}px variant: finished tile ${stage.tileNumber}/${stage.tileCount}.`;
        default:
            return `Generating ${stage.targetResolution}px variant (${stage.variantNumber}/${stage.variantCount})...`;
    }
}

export function getProcessedTextureFamilyPlan(source = {}) {
    const textureName = source.textureName ?? getDefaultTextureName(source.fileInfo);
    const effectiveFrameCount = source.effectiveFrameCount ?? getEffectiveFrameCount(source);
    const tileCount = source.tileCount ?? Object.keys(source.ktx2Blobs || source.ktx2BlobURLs || {}).length;
    const tileResolution = Number(source.tileResolution ?? source.potResolution ?? 512) || 512;
    const layerCount = Number(source.layerCount ?? 60) || 60;
    const autoDerivedResolutions = normalizeTextureVariantTargetResolutions(
        tileResolution,
        source.autoDeriveResolutions || []
    );
    const derivationAssessment = assessTextureVariantDerivationWorkload({
        tileCount,
        tileResolution,
        layerCount,
        targetResolutions: autoDerivedResolutions,
    });

    return {
        textureName,
        effectiveFrameCount,
        tileCount,
        tileResolution,
        layerCount,
        autoDerivedResolutions,
        derivationAssessment,
    };
}

export function buildFileTextureSaveSource(app, overrides = {}) {
    return {
        ktx2BlobURLs: app.ktx2BlobURLs,
        fileInfo: app.fileInfo,
        framesToSample: app.framesToSample,
        frameCount: app.frameCount,
        tileResolution: app.potResolution,
        potResolution: app.potResolution,
        crossSectionCount: app.crossSectionCount,
        crossSectionType: app.crossSectionType,
        thumbnailBlob: app.thumbnailBlob,
        autoDeriveResolutions: app.autoDeriveResolutions,
        ...overrides,
    };
}

export async function saveProcessedTextureFamilyLocally(controller, source = {}) {
    if (!controller || controller.isSavingLocally) return controller?.savedLocalTextureId ?? null;

    const plan = getProcessedTextureFamilyPlan(source);
    const targetResolutions = plan.derivationAssessment.severity === 'danger'
        ? []
        : plan.autoDerivedResolutions;
    const abortController = targetResolutions.length > 0 ? new AbortController() : null;
    const generation = controller.beginLocalSave(abortController);
    controller.set('saveLocalProgress', 'Preparing...');

    if (plan.derivationAssessment.severity === 'danger') {
        controller.set('saveLocalNotice', `${plan.derivationAssessment.message} The root texture will still be saved locally, but derived variants are skipped for this run.`);
    }

    if (plan.derivationAssessment.severity === 'warning') {
        controller.set('saveLocalNotice', plan.derivationAssessment.message);
    }

    let savedRootId = null;
    const savedTextureFamilyIds = [];

    try {
        const blobs = source.ktx2Blobs ?? await collectKtx2BlobsFromUrls(source.ktx2BlobURLs);
        const thumbnailBlob = source.thumbnailBlob ?? null;
        const thumbnailDataUrl = thumbnailBlob ? await blobToDataUrl(thumbnailBlob) : null;
        const sourceMetadata = source.sourceMetadata ?? buildDefaultSourceMetadata(source, plan.effectiveFrameCount);

        controller.set('saveLocalProgress', targetResolutions.length > 0
            ? 'Saving root texture to browser...'
            : 'Saving to browser...');

        savedRootId = await saveTextureSet({
            name: plan.textureName,
            tileCount: plan.tileCount,
            tileResolution: plan.tileResolution,
            layerCount: plan.layerCount,
            crossSectionType: source.crossSectionType ?? 'planes',
            sourceMetadata,
            thumbnailDataUrl,
            ktx2Blobs: blobs,
            onProgress: (current, total) => {
                const pct = Math.round((current / total) * 100);
                controller.set('saveLocalProgress', `Saving root texture ${pct}%`);
            },
        });

        if (controller.localSaveGeneration !== generation) {
            return null;
        }

        savedTextureFamilyIds.push(savedRootId);
        controller.set('savedLocalTextureId', savedRootId);
        controller.set('savedLocalTextureFamilyIds', [...savedTextureFamilyIds]);

        if (targetResolutions.length > 0) {
            const { deriveKtx2TextureFamily } = await import('./ktx2RoundtripVariant.js');
            const familyResult = await deriveKtx2TextureFamily({
                sourceTiles: buildSourceTilesFromBlobs(blobs),
                sourceResolution: plan.tileResolution,
                targetResolutions,
                signal: abortController?.signal ?? null,
                onProgress: (stage) => {
                    controller.set('saveLocalProgress', buildVariantProgressMessage(stage));
                },
            });

            for (let variantIndex = 0; variantIndex < familyResult.variants.length; variantIndex++) {
                const variant = familyResult.variants[variantIndex];
                const variantName = buildDerivedTextureName(plan.textureName, variant.targetResolution);

                controller.set('saveLocalProgress', `Saving ${variantName} (${variantIndex + 1}/${familyResult.variants.length})...`);
                const savedVariantId = await saveTextureSet({
                    name: variantName,
                    tileCount: variant.result.output.tileCount,
                    tileResolution: variant.result.output.pixelWidth,
                    layerCount: variant.result.output.layerCount,
                    crossSectionType: source.crossSectionType ?? 'planes',
                    sourceMetadata,
                    thumbnailDataUrl,
                    ktx2Blobs: variant.result.outputBlobs,
                    derivedFrom: {
                        texture_set_id: savedRootId,
                        root_texture_set_id: savedRootId,
                        storage_provider: 'local',
                        name: plan.textureName,
                        tile_resolution: plan.tileResolution,
                    },
                    variantInfo: {
                        family_id: savedRootId,
                        root_texture_set_id: savedRootId,
                        parent_texture_set_id: savedRootId,
                        source_resolution: plan.tileResolution,
                        target_resolution: variant.targetResolution,
                        generated_at: Date.now(),
                        method: 'file-mode-roundtrip-family-v1',
                    },
                    parentTextureSetId: savedRootId,
                    rootTextureSetId: savedRootId,
                    onProgress: (current, total) => {
                        const pct = Math.round((current / total) * 100);
                        controller.set('saveLocalProgress', `Saving ${variantName} ${pct}%`);
                    },
                });

                if (controller.localSaveGeneration !== generation) {
                    return savedRootId;
                }

                savedTextureFamilyIds.push(savedVariantId);
                controller.set('savedLocalTextureFamilyIds', [...savedTextureFamilyIds]);
            }
        }

        controller.set('saveLocalProgress', '');
        console.log('[LocalTexturePersistence] Texture family saved locally:', savedTextureFamilyIds);
        return savedRootId;
    } catch (error) {
        if (controller.localSaveGeneration !== generation) {
            return null;
        }

        const message = error?.name === 'AbortError'
            ? 'Variant generation cancelled'
            : (error.message || 'Save failed');

        console.error('[LocalTexturePersistence] Local family save failed:', error);

        if (savedRootId) {
            const partialCount = savedTextureFamilyIds.length;
            controller.set('savedLocalTextureId', savedRootId);
            controller.set('savedLocalTextureFamilyIds', [...savedTextureFamilyIds]);
            controller.set(
                'saveLocalNotice',
                error?.name === 'AbortError'
                    ? `Saved ${partialCount} local texture${partialCount === 1 ? '' : 's'} before cancellation.`
                    : `Saved ${partialCount} local texture${partialCount === 1 ? '' : 's'} before variant generation stopped: ${message}`
            );
            controller.set('saveLocalError', null);
            return savedRootId;
        }

        controller.set('saveLocalError', message);
        return null;
    } finally {
        if (controller.localSaveGeneration === generation) {
            controller.set('saveLocalProgress', '');
            controller.finishLocalSave?.();
        }
    }
}

export async function saveProcessedTextureSetLocally(controller, source = {}) {
    return saveProcessedTextureFamilyLocally(controller, {
        ...source,
        autoDeriveResolutions: [],
    });
}