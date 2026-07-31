import * as THREE from 'three';

/**
 * Normalize KTX2Loader output into texture classes WebGPURenderer can upload.
 *
 * KTX2Loader uses CompressedArrayTexture for its uncompressed RGBA fallback.
 * WebGPURenderer consequently routes the data through its compressed uploader,
 * even though the resolved GPU format is rgba8unorm. Convert that fallback to
 * DataArrayTexture so it follows the uncompressed buffer upload path instead.
 *
 * @param {THREE.Texture} texture
 * @returns {THREE.Texture}
 */
export function normalizeWebGPUArrayTexture(texture) {
    if (!texture) {
        return texture;
    }

    if (texture.format === THREE.RGB_S3TC_DXT1_Format) {
        texture.format = THREE.RGBA_S3TC_DXT1_Format;
    }

    if (
        texture.isCompressedArrayTexture !== true
        || texture.format !== THREE.RGBAFormat
    ) {
        return texture;
    }

    const baseLevel = texture.mipmaps?.[0];
    const width = Number(baseLevel?.width || texture.image?.width) || 0;
    const height = Number(baseLevel?.height || texture.image?.height) || 0;
    const depth = Number(texture.image?.depth) || 0;

    if (!baseLevel?.data || width <= 0 || height <= 0 || depth <= 0) {
        throw new Error('Invalid uncompressed KTX2 array texture fallback');
    }

    const normalized = new THREE.DataArrayTexture(
        baseLevel.data,
        width,
        height,
        depth,
    );

    normalized.name = texture.name;
    normalized.format = texture.format;
    normalized.type = texture.type;
    normalized.colorSpace = texture.colorSpace;
    normalized.mapping = texture.mapping;
    normalized.wrapS = texture.wrapS;
    normalized.wrapT = texture.wrapT;
    normalized.wrapR = texture.wrapR;
    normalized.magFilter = texture.magFilter;
    // DataArrayTexture upload in Three r182 uses the base level only.
    normalized.minFilter = THREE.LinearFilter;
    normalized.anisotropy = texture.anisotropy;
    normalized.flipY = false;
    normalized.generateMipmaps = false;
    normalized.premultiplyAlpha = texture.premultiplyAlpha;
    normalized.unpackAlignment = texture.unpackAlignment;
    normalized.needsUpdate = true;

    return normalized;
}
