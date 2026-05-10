import * as THREE from 'three';

export const BASE_RENDERER_DISPLAY_CONFIG = Object.freeze({
    clearColor: 0x000000,
    clearAlpha: 0,
});

export function getDefaultRendererDisplayConfig(rendererType = 'webgl') {
    if (rendererType === 'webgl') {
        return {
            ...BASE_RENDERER_DISPLAY_CONFIG,
            outputColorSpace: THREE.LinearSRGBColorSpace,
            toneMapping: THREE.NoToneMapping,
            toneMappingExposure: 1,
        };
    }

    return {
        ...BASE_RENDERER_DISPLAY_CONFIG,
    };
}

export function readRendererDisplayConfig(renderer, rendererType = 'webgl') {
    const config = getDefaultRendererDisplayConfig(rendererType);

    if (!renderer) {
        return config;
    }

    if (typeof renderer.getClearColor === 'function') {
        config.clearColor = renderer.getClearColor(new THREE.Color()).getHex();
    }

    if (typeof renderer.getClearAlpha === 'function') {
        config.clearAlpha = renderer.getClearAlpha();
    }

    if ('outputColorSpace' in renderer && renderer.outputColorSpace) {
        config.outputColorSpace = renderer.outputColorSpace;
    }

    if ('toneMapping' in renderer && renderer.toneMapping !== undefined) {
        config.toneMapping = renderer.toneMapping;
    }

    if ('toneMappingExposure' in renderer && renderer.toneMappingExposure !== undefined) {
        config.toneMappingExposure = renderer.toneMappingExposure;
    }

    return config;
}

export function applyRendererDisplayConfig(renderer, config = null, rendererType = 'webgl') {
    if (!renderer) {
        return renderer;
    }

    const nextConfig = {
        ...getDefaultRendererDisplayConfig(rendererType),
        ...(config || {}),
    };

    if (typeof renderer.setClearColor === 'function') {
        renderer.setClearColor(nextConfig.clearColor, nextConfig.clearAlpha);
    }

    if ('outputColorSpace' in renderer && nextConfig.outputColorSpace) {
        renderer.outputColorSpace = nextConfig.outputColorSpace;
    }

    if ('toneMapping' in renderer && nextConfig.toneMapping !== undefined) {
        renderer.toneMapping = nextConfig.toneMapping;
    }

    if ('toneMappingExposure' in renderer && nextConfig.toneMappingExposure !== undefined) {
        renderer.toneMappingExposure = nextConfig.toneMappingExposure;
    }

    return renderer;
}