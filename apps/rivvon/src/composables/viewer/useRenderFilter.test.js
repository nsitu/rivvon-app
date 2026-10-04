import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { useRenderFilter } from './useRenderFilter.js';

describe('useRenderFilter', () => {
    it.each([
        ['brightness', 0],
        ['color', 1],
        ['saturation', 2],
        ['unknown', 0],
    ])('syncs %s transparency and inversion to scene materials', (method, methodId) => {
        const material = new THREE.MeshBasicMaterial();
        material._transparentShadowsOriginalState = {
            transparent: material.transparent,
            depthWrite: material.depthWrite,
            alphaToCoverage: material.alphaToCoverage,
        };
        material._transparentShadowsUniform = { value: 0 };
        material._transparencyMethodUniform = { value: -1 };
        material._transparentHighlightsUniform = { value: 0 };
        material._transparentShadowsMinUniform = { value: 0 };
        material._transparentShadowsMaxUniform = { value: 1 };
        const geometry = new THREE.PlaneGeometry();
        const scene = new THREE.Scene();
        scene.add(new THREE.Mesh(geometry, material));
        const app = {
            renderFilterMode: 'none',
            transparentShadowsEnabled: true,
            transparencyMethod: method,
            transparencyMode: 'highlights',
            transparentShadowsThresholdMin: 0.2,
            transparentShadowsThresholdMax: 0.6,
        };
        const renderFilter = useRenderFilter({
            app,
            renderer: { value: { setRenderTarget: vi.fn(), render: vi.fn() } },
            scene: { value: scene },
            camera: { value: new THREE.OrthographicCamera() },
        });

        renderFilter.renderScene();
        expect(material._transparencyMethodUniform.value).toBe(methodId);
        expect(material._transparentHighlightsUniform.value).toBe(1);
        expect(material._transparentShadowsMinUniform.value).toBe(0.2);
        expect(material._transparentShadowsMaxUniform.value).toBe(0.6);
        expect(material.transparent).toBe(true);
        expect(material.depthWrite).toBe(false);

        app.transparencyMethod = 'brightness';
        app.transparencyMode = 'shadows';
        app.transparentShadowsEnabled = false;
        renderFilter.renderScene();
        expect(material._transparencyMethodUniform.value).toBe(0);
        expect(material._transparentHighlightsUniform.value).toBe(0);
        expect(material.transparent).toBe(false);
        expect(material.depthWrite).toBe(true);
        geometry.dispose();
        material.dispose();
    });

    it('renders standalone scenes with only a primary tile manager ref', () => {
        const renderer = {
            setRenderTarget: vi.fn(),
            render: vi.fn(),
        };
        const tileManager = {
            setOverlapMaskTexture: vi.fn(),
        };
        const scene = new THREE.Scene();
        const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
        const renderFilter = useRenderFilter({
            app: {
                renderFilterMode: 'none',
                transparentShadowsEnabled: false,
                peakTroughTransparencyEnabled: false,
                peakTroughBlurEnabled: false,
                transparencyMode: 'shadows',
                transparencyMethod: 'luminance',
            },
            renderer: { value: renderer },
            scene: { value: scene },
            camera: { value: camera },
            tileManager: { value: tileManager },
        });

        expect(() => renderFilter.renderScene()).not.toThrow();
        expect(tileManager.setOverlapMaskTexture).toHaveBeenCalledWith(null);
        expect(renderer.setRenderTarget).toHaveBeenCalledWith(null);
        expect(renderer.render).toHaveBeenCalledWith(scene, camera);
    });
});
