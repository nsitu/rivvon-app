import { normalizeScenePreset } from '../../../../packages/shared-types/src/scenePreset.js';
import { getTextureSet, promoteTextureSetToCachedCloudTexture } from './localStorage.js';
import { createTextureThumbnail } from '../modules/shared/textureThumbnail.js';
import { cacheTextureTiles, getCachedTextureTiles } from './sessionTextureCache.js';
import { getMaxConcurrentTextureDownloads, mapWithConcurrency } from './textureDownloadConcurrency.js';
import { getTextureStorageLabel } from './textureStorage.js';

const API = import.meta.env.VITE_API_URL || 'https://api.rivvon.ca';
export const presetAssetUrl = (id, asset) => `${API}/presets/${encodeURIComponent(id)}/assets/${encodeURIComponent(asset)}`;
export const presetShareUrl = (id) => new URL(`/?preset=${encodeURIComponent(id)}`, window.location.origin).href;

async function request(path, options = {}) {
    const response = await fetch(`${API}/presets${path}`, { credentials: 'include', ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'The preset request failed.');
    return data;
}
export const fetchPresets = ({ scope = 'mine', limit = 24, offset = 0 } = {}) => request(`?scope=${scope}&limit=${limit}&offset=${offset}`);
export const fetchPreset = (id) => request(`/${encodeURIComponent(id)}`);
export const deletePreset = (id) => request(`/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const updatePreset = (id, updates) => request(`/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates) });

export async function savePreset({ scene, uploads = [], uploadTexture, storageProvider, thumbnail, name, visibility = 'private', parentPresetId = null, onProgress }) {
    const publishedLocals = new Map(uploads.filter(upload => upload.localId && scene.textures[upload.assignment].id)
        .map(upload => [upload.localId, scene.textures[upload.assignment].id]));
    for (const upload of uploads) {
        if (scene.textures[upload.assignment].id) continue;
        const texture = scene.textures[upload.assignment];
        if (upload.localId) {
            // The draft may have been published since this scene was captured.
            const existingId = publishedLocals.get(upload.localId) || (await getTextureSet(upload.localId))?.cached_from;
            if (existingId) {
                texture.id = existingId;
                publishedLocals.set(upload.localId, existingId);
                continue;
            }
        }
        if (typeof uploadTexture !== 'function') throw new Error('Choose an upload destination for the local textures before saving this preset.');
        onProgress?.(`Uploading ${texture.name} to ${getTextureStorageLabel(storageProvider)}…`);
        const thumbnailBlob = upload.thumbnailBlob || await createTextureThumbnail(upload.tiles);
        const publication = await uploadTexture({ name: texture.name, description: 'Uploaded for a saved Rivvon preset',
            tileResolution: texture.tileResolution, layerCount: texture.layerCount, crossSectionType: texture.variant,
            progressLabelPrefix: texture.name,
            tiles: upload.tiles, thumbnailBlob, isPublic: false,
            onProgress: (_, detail) => onProgress?.(detail) });
        // Retain the new library ID on a retry; it is the same media asset, not a preset copy.
        texture.id = publication.textureSetId;
        if (upload.localId) publishedLocals.set(upload.localId, texture.id);
        if (upload.localId) await promoteTextureSetToCachedCloudTexture(upload.localId, {
            cloudTextureId: texture.id, name: texture.name,
        }).catch(() => {}); // Cache bookkeeping must not discard a successful publication.
    }
    const created = await request('', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scene: normalizeScenePreset(scene), name, visibility, parentPresetId }) });
    const id = created.preset.id;
    try {
        onProgress?.('Saving preset thumbnail…');
        await request(`/${id}/assets/thumbnail`, { method: 'PUT', headers: { 'Content-Type': thumbnail.type }, body: thumbnail });
        return (await request(`/${id}/complete`, { method: 'POST' })).preset;
    } catch (error) {
        await deletePreset(id).catch(() => {});
        throw error;
    }
}

export async function preparePresetTextures(id, input, onProgress) {
    const scene = normalizeScenePreset(input);
    // A texture may be assigned to several strands. Download its bytes only once.
    const groups = new Map();
    const assignments = scene.textures.map((texture, index) => {
        const key = JSON.stringify([texture.id, texture.tileCount, texture.tileResolution, texture.layerCount, texture.variant]);
        if (!groups.has(key)) groups.set(key, { texture, index });
        return { texture, group: groups.get(key) };
    });
    let completed = 0;
    const total = [...groups.values()].reduce((sum, { texture }) => sum + texture.tileCount, 0);
    const fractions = new Map();
    const controller = new AbortController();
    const reportDownload = () => {
        if (controller.signal.aborted) return;
        onProgress?.('Downloading...',
            { stage: 'downloading', current: completed + [...fractions.values()].reduce((sum, value) => sum + value, 0), total });
    };
    reportDownload();
    const jobs = [];
    for (const group of groups.values()) {
        const { texture } = group;
        const cached = getCachedTextureTiles(texture.id);
        if (cached?.isComplete && cached.tileCount === texture.tileCount && cached.layerCount === texture.layerCount
            && cached.variant === texture.variant
            && Array.from({ length: texture.tileCount }, (_, tile) => cached.zipFiles[`${tile}.ktx2`]?.byteLength > 0).every(Boolean)) {
            group.tileEntry = cached;
            completed += texture.tileCount;
            continue;
        }
        group.tileEntry = { zipFiles: {}, tileCount: texture.tileCount, layerCount: texture.layerCount,
            variant: texture.variant, isComplete: true, source: 'preset' };
        group.cacheAfterDownload = true;
        for (let tile = 0; tile < texture.tileCount; tile++) {
            jobs.push({ group, tile });
        }
    }
    if (completed) reportDownload();
    try {
        await mapWithConcurrency(jobs, getMaxConcurrentTextureDownloads(), async (job) => {
            const { group, tile } = job;
            const response = await fetch(presetAssetUrl(id, `texture-${group.index}-${tile}.ktx2`), {
                credentials: 'include', signal: controller.signal,
            });
            if (!response.ok) {
                const detail = await response.json().catch(() => ({}));
                throw new Error(detail.error || 'A preset texture is unavailable. Your current ribbon has been preserved.');
            }
            group.tileEntry.zipFiles[`${tile}.ktx2`] = await readPresetTile(response, (received, length) => {
                fractions.set(job, length > 0 ? Math.min(0.99, received / length) : 0);
                reportDownload();
            });
            fractions.delete(job);
            completed++;
            reportDownload();
        });
    } catch (error) {
        controller.abort();
        throw error;
    }
    for (const group of groups.values()) {
        if (group.cacheAfterDownload) group.tileEntry = cacheTextureTiles(group.texture.id, group.tileEntry);
    }
    return assignments.map(({ texture, group }) => ({ textureSet: { id: texture.id, name: texture.name,
            tile_count: texture.tileCount, tile_resolution: texture.tileResolution,
            layer_count: texture.layerCount, cross_section_type: texture.variant },
        tileEntry: group.tileEntry }));
}

async function readPresetTile(response, onBytesReceived) {
    if (!response.body?.getReader) {
        const bytes = new Uint8Array(await response.arrayBuffer());
        onBytesReceived(bytes.byteLength, bytes.byteLength);
        return bytes;
    }
    const reader = response.body.getReader();
    const length = Number(response.headers.get('Content-Length')) || 0;
    const chunks = [];
    let received = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            received += value.byteLength;
            onBytesReceived(received, length);
        }
    } finally {
        reader.releaseLock();
    }
    const bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
}
