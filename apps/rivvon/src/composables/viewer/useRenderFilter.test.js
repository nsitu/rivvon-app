import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { useRenderFilter } from './useRenderFilter.js';

describe('useRenderFilter', () => {
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
