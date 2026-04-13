import { saveTextureSet } from '../../services/localStorage.js';

function getDefaultTextureName(fileInfo) {
    return fileInfo?.name?.replace(/\.[^.]+$/, '') || 'texture';
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
        frame_count: effectiveFrameCount,
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
        ...overrides,
    };
}

export async function saveProcessedTextureSetLocally(controller, source = {}) {
    if (!controller || controller.isSavingLocally) return controller?.savedLocalTextureId ?? null;

    const generation = controller.beginLocalSave();
    controller.set('saveLocalProgress', 'Preparing...');

    try {
        const blobs = source.ktx2Blobs ?? await collectKtx2BlobsFromUrls(source.ktx2BlobURLs);
        const textureName = source.textureName ?? getDefaultTextureName(source.fileInfo);
        const effectiveFrameCount = source.effectiveFrameCount ?? getEffectiveFrameCount(source);

        let thumbnailDataUrl = null;
        const thumbnailBlob = source.thumbnailBlob ?? null;
        if (thumbnailBlob) {
            thumbnailDataUrl = await blobToDataUrl(thumbnailBlob);
        }

        controller.set('saveLocalProgress', 'Saving to browser...');
        const savedId = await saveTextureSet({
            name: textureName,
            tileCount: source.tileCount ?? Object.keys(blobs).length,
            tileResolution: source.tileResolution ?? source.potResolution ?? 512,
            layerCount: source.layerCount ?? 60,
            crossSectionType: source.crossSectionType ?? 'planes',
            sourceMetadata: source.sourceMetadata ?? buildDefaultSourceMetadata(source, effectiveFrameCount),
            thumbnailDataUrl,
            ktx2Blobs: blobs,
            onProgress: (current, total) => {
                const pct = Math.round((current / total) * 100);
                controller.set('saveLocalProgress', `Saving ${pct}%`);
            },
        });

        if (controller.localSaveGeneration !== generation) {
            return null;
        }

        controller.set('savedLocalTextureId', savedId);
        controller.set('saveLocalProgress', '');
        console.log('[LocalTexturePersistence] Texture saved locally:', savedId);
        return savedId;
    } catch (error) {
        if (controller.localSaveGeneration !== generation) {
            return null;
        }

        console.error('[LocalTexturePersistence] Local save failed:', error);
        controller.set('saveLocalError', error.message || 'Save failed');
        controller.set('saveLocalProgress', '');
        return null;
    } finally {
        if (controller.localSaveGeneration === generation) {
            controller.set('isSavingLocally', false);
        }
    }
}