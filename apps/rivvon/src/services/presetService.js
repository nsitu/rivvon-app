import { normalizeScenePreset } from '../../../../packages/shared-types/src/scenePreset.js';
import { promoteTextureSetToCachedCloudTexture } from './localStorage.js';

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

export async function savePreset({ scene, uploads = [], uploadTexture, thumbnail, name, visibility = 'private', parentPresetId = null, onProgress }) {
    const publishedLocals = new Map(uploads.filter(upload => upload.localId && scene.textures[upload.assignment].id)
        .map(upload => [upload.localId, scene.textures[upload.assignment].id]));
    for (const upload of uploads) {
        if (scene.textures[upload.assignment].id) continue;
        const texture = scene.textures[upload.assignment];
        if (upload.localId && publishedLocals.has(upload.localId)) { texture.id = publishedLocals.get(upload.localId); continue; }
        onProgress?.(`Uploading ${texture.name} to your texture library…`);
        const publication = await uploadTexture({ name: texture.name, description: 'Uploaded for a saved Rivvon preset',
            tileResolution: texture.tileResolution, layerCount: texture.layerCount, crossSectionType: texture.variant,
            tiles: upload.tiles, isPublic: false,
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
    const entries = [];
    let completed = 0;
    const total = scene.textures.reduce((sum, texture) => sum + texture.tileCount, 0);
    for (const [index, texture] of scene.textures.entries()) {
        const zipFiles = {};
        for (let tile = 0; tile < texture.tileCount; tile++) {
            const response = await fetch(presetAssetUrl(id, `texture-${index}-${tile}.ktx2`), { credentials: 'include' });
            if (!response.ok) {
                const detail = await response.json().catch(() => ({}));
                throw new Error(detail.error || 'A preset texture is unavailable. Your current ribbon has been preserved.');
            }
            zipFiles[`${tile}.ktx2`] = new Uint8Array(await response.arrayBuffer());
            onProgress?.(`Loading preset… ${++completed}/${total}`);
        }
        entries.push({ textureSet: { id: texture.id, name: texture.name,
            tile_count: texture.tileCount, tile_resolution: texture.tileResolution,
            layer_count: texture.layerCount, cross_section_type: texture.variant },
            tileEntry: { zipFiles, tileCount: texture.tileCount, layerCount: texture.layerCount, variant: texture.variant, isComplete: true } });
    }
    return entries;
}
