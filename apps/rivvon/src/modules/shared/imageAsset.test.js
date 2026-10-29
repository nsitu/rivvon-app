import { describe, expect, it } from 'vitest';
import { inspectImage, normalizeBackgroundSource } from '../../../../../packages/shared-types/src/imageAsset.js';
import { normalizeArtworkSettings, normalizeScenePreset } from '../../../../../packages/shared-types/src/scenePreset.js';
const png = () => Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN6UAAAAASUVORK5CYII=', 'base64'));
const scene = artwork => ({ schemaVersion: 1, artwork, geometry: { paths: [[{ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }]] },
    textures: [{ id: 'texture', tileCount: 1, tileResolution: 512, layerCount: 1 }], camera: { position: [0, 0, 5], target: [0, 0, 0], quaternion: [0, 0, 0, 1], fov: 45 } });
describe('image contracts', () => {
    it('migrates every legacy built-in and preserves selected blend modes in version 2', () => {
        for (const id of ['card', 'textile', 'cenote']) {
            const migrated = normalizeScenePreset(scene({ backgroundTexture: id }));
            expect(migrated.schemaVersion).toBe(2);
            expect(migrated.artwork.backgroundTextureSource).toEqual({ kind: 'builtin', id });
            expect(migrated.artwork.backgroundTextureBlendMode).toBe('softLight');
        }
        const input = scene({ backgroundTextureSource: { kind: 'image', id: 'upload' }, backgroundTextureBlendMode: 'normal' }); input.schemaVersion = 2;
        expect(normalizeScenePreset(normalizeScenePreset(input)).artwork).toMatchObject(input.artwork);
        expect(() => normalizeScenePreset({ ...input, schemaVersion: 3 })).toThrow('version');
    });
    it('rejects arbitrary image URLs, malformed references and unknown blend modes', () => {
        for (const value of [{ kind: 'image', id: 'https://example.com' }, { kind: 'builtin', id: 'unknown' }, { kind: 'file', id: 'upload' }, 'card']) {
            expect(() => normalizeBackgroundSource(value)).toThrow('reference');
        }
        expect(() => normalizeArtworkSettings({ backgroundTextureBlendMode: 'multiply' })).toThrow('backgroundTextureBlendMode');
    });
    it('checks container dimensions before decoding and rejects animated or truncated PNGs', () => {
        expect(inspectImage(png())).toEqual({ mimeType: 'image/png', width: 1, height: 1 });
        const huge = png(); new DataView(huge.buffer).setUint32(16, 10000); new DataView(huge.buffer).setUint32(20, 10000);
        expect(() => inspectImage(huge)).toThrow('40 megapixels');
        const animated = png(); animated.set(new TextEncoder().encode('acTL'), 37);
        expect(() => inspectImage(animated)).toThrow('Animated');
        expect(() => inspectImage(png().slice(0, -8))).toThrow('Truncated');
        expect(() => inspectImage(new Uint8Array([1, 2, 3]))).toThrow('valid JPEG');
    });
});
