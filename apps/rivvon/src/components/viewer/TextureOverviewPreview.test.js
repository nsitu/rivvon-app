import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRenderer, h, nextTick, reactive, ssrContextKey } from 'vue';
import * as THREE from 'three';
import TextureOverviewPreview from './TextureOverviewPreview.vue';
import { useViewerStore } from '../../stores/viewerStore';

const { background, filter } = vi.hoisted(() => ({
    background: {
        setBackgroundFromTileManager: vi.fn().mockResolvedValue(),
        updateBackground: vi.fn(), disposeBackground: vi.fn(), pauseMedia: vi.fn(),
    },
    filter: { renderScene: vi.fn(), disposeRenderFilter: vi.fn() },
}));

vi.mock('../../stores/viewerStore', () => ({ useViewerStore: vi.fn() }));
vi.mock('../../services/localStorage.js', () => ({ useLocalStorage: () => ({}) }));
vi.mock('../../composables/viewer/useSceneBackground.js', () => ({ useSceneBackground: () => background }));
vi.mock('../../composables/viewer/useRenderFilter.js', () => ({ useRenderFilter: () => filter }));
vi.mock('../../services/textureCacheCoordinator.js', () => ({
    resolveTextureLoadTarget: vi.fn().mockResolvedValue({ kind: 'local', textureSet: {}, localTiles: [] }),
    cacheCloudTextureInBackground: vi.fn(), getCachedTextureTiles: vi.fn(),
}));
vi.mock('../../modules/viewer/tileManager', () => ({
    TileManager: class {
        loadFromTileRecords = async () => true;
        getOrCreateMaterialForSegment = () => new THREE.MeshBasicMaterial();
        dispose() {}
    },
}));

// Run the component's setup and watchers without creating a browser GPU context.
const host = createRenderer({
    createComment: () => ({}), insert() {}, remove() {},
    parentNode: () => null, nextSibling: () => null,
});
let mounted;
afterEach(() => { mounted?.unmount(); vi.clearAllMocks(); });

async function mountOverview(mode = 'normal', transparency = false) {
    const app = reactive({ artworkBlendMode: mode, artworkBlendStrength: 1, contrast: 1, saturation: 1 });
    useViewerStore.mockReturnValue(app);
    const props = reactive({
        texture: { id: 'test', tile_count: 1 }, getLocalTiles: async () => [],
        showBlurredBackground: transparency,
    });
    let state;
    const component = { ...TextureOverviewPreview, render(_ctx, _cache, _props, setup) { state = setup; return null; } };
    mounted = host.createApp({
        render: () => h(component, props),
    });
    mounted.provide(ssrContextKey, {});
    mounted.mount({});
    await nextTick();
    const renderer = { render: vi.fn(), dispose: vi.fn() };
    state.renderer = renderer;
    state.scene = new THREE.Scene();
    state.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    await state.loadTexture();
    expect(state.error).toBe('');
    return { app, props, state, renderer };
}

describe('texture overview artwork blending', () => {
    it('loads a backdrop for an initially selected blend with transparency off', async () => {
        await mountOverview('multiply');
        expect(background.setBackgroundFromTileManager).toHaveBeenCalledWith({ opacity: 1 });
    });

    it('creates and removes the backdrop when switching between Normal and a blend', async () => {
        const { app } = await mountOverview();
        expect(background.setBackgroundFromTileManager).not.toHaveBeenCalled();
        app.artworkBlendMode = 'multiply';
        await nextTick();
        expect(background.setBackgroundFromTileManager).toHaveBeenCalledTimes(1);
        filter.renderScene.mockClear();
        app.artworkBlendStrength = 0.4;
        await nextTick();
        expect(filter.renderScene).toHaveBeenCalled();
        expect(background.setBackgroundFromTileManager).toHaveBeenCalledTimes(1);
        app.artworkBlendMode = 'normal';
        await nextTick();
        expect(background.disposeBackground).toHaveBeenCalledTimes(1);
    });

    it('keeps the backdrop when Normal still needs transparency', async () => {
        const { app } = await mountOverview('multiply', true);
        app.artworkBlendMode = 'normal';
        await nextTick();
        expect(background.disposeBackground).not.toHaveBeenCalled();
    });

    it('keeps setting and layout redraws on the shared compositing path', async () => {
        const { app, props, state, renderer } = await mountOverview('multiply');
        for (const change of [
            () => { app.textureFlipVertical = true; },
            () => { app.flowState = 'off'; },
            () => { app.textureOverviewLayoutStrategy = 'fillFrame'; },
            () => { props.targetWidth = 1280; },
        ]) {
            filter.renderScene.mockClear();
            change();
            await nextTick();
            await nextTick();
            expect(filter.renderScene).toHaveBeenCalled();
        }
        expect(renderer.render).not.toHaveBeenCalled();
        expect(state.isReady).toBe(true);
    });
});
