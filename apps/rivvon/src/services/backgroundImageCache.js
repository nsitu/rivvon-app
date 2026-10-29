import * as THREE from 'three';
import { normalizeBackgroundSource } from '../../../../packages/shared-types/src/imageAsset.js';
import { getBackgroundTextureOption } from '../modules/viewer/backgroundTextures.js';
import { fetchImageBlob } from './imageService.js';

const entries = new Map();
const MAX_IDLE_BYTES = 96 * 1024 * 1024;
let accessScope = '';
function dispose(entry) { entry.texture?.dispose(); if (entry.url) URL.revokeObjectURL(entry.url); entry.disposed = true; }
function evict() {
    let idleBytes = [...entries.values()].filter(entry => !entry.refs).reduce((sum, entry) => sum + (entry.bytes || 0), 0);
    for (const [key, entry] of entries) {
        if (entry.refs || !entry.texture) continue;
        if (entry.retired || idleBytes > MAX_IDLE_BYTES || entries.size > 4) {
            entries.delete(key); idleBytes -= entry.bytes; dispose(entry);
        }
    }
}
export function setBackgroundImageAccessScope(scope) {
    if (accessScope === scope) return;
    accessScope = scope;
    for (const entry of entries.values()) {
        entry.retired = true; entry.controller.abort();
        if (!entry.refs) dispose(entry);
    }
    entries.clear();
}
export function invalidateBackgroundImage(id) {
    for (const [key, entry] of entries) if (entry.id === id) {
        entries.delete(key); entry.retired = true; if (!entry.refs) dispose(entry);
    }
}
export async function acquireBackgroundImage(source, { legacy, presetId = '', maxTextureSize = 4096 } = {}) {
    source = normalizeBackgroundSource(source, legacy);
    const key = JSON.stringify([accessScope, source, presetId]);
    let entry = entries.get(key);
    if (!entry) {
        entry = { refs: 0, id: source.id, controller: new AbortController(), retired: false };
        entries.set(key, entry);
        entry.pending = (async () => {
            const loader = new THREE.TextureLoader(); loader.crossOrigin = 'anonymous';
            let url = getBackgroundTextureOption(source.id).url;
            if (source.kind === 'image') {
                const blob = await fetchImageBlob(source.id, { presetId, signal: entry.controller.signal });
                entry.url = url = URL.createObjectURL(blob);
            }
            const texture = await new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject));
            entry.texture = texture;
            if (entry.retired) throw new Error('Image access changed while loading');
            const image = texture.image, width = image?.naturalWidth || image?.width || 1, height = image?.naturalHeight || image?.height || 1;
            entry.bytes = Math.ceil(width * height * 4 * 4 / 3);
            texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
            texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter; texture.needsUpdate = true;
            return texture;
        })();
    }
    entry.refs++;
    let released = false;
    const release = () => { if (released) return; released = true; entry.refs--; if (entry.retired && !entry.refs) dispose(entry); evict(); };
    try {
        const texture = await entry.pending;
        if (Math.max(texture.image?.naturalWidth || texture.image?.width || 1, texture.image?.naturalHeight || texture.image?.height || 1) > maxTextureSize) {
            throw new Error(`This image exceeds your renderer's ${maxTextureSize}px texture limit`);
        }
        entries.delete(key); if (!entry.retired) entries.set(key, entry);
        return { texture, release };
    } catch (error) { entry.retired = true; if (entries.get(key) === entry) entries.delete(key); release(); throw error; }
}
