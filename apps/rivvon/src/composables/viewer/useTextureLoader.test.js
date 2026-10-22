import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTextureLoader } from './useTextureLoader.js';
import { TileManager } from '../../modules/viewer/tileManager';

vi.mock('../../modules/viewer/tileManager', () => ({ TileManager: vi.fn() }));
afterEach(() => vi.resetAllMocks());

describe('preset texture staging progress', () => {
    it('aggregates decoding progress across textures without going back to the download stage', async () => {
        vi.mocked(TileManager).mockImplementation(function () { return {
            loadFromSession: vi.fn(async (texture, entry, report) => {
                report('downloading', 100, 100);
                for (let index = 1; index <= texture.tile_count; index++) report('building', index, texture.tile_count);
                return true;
            }), setFlowSpeed: vi.fn(), setFlowEnabled: vi.fn(), dispose: vi.fn(),
        }; });
        const loader = useTextureLoader({ app: {}, renderer: { value: null } });
        const progress = vi.fn();
        const entries = [1, 2].map(tile_count => ({ textureSet: { tile_count }, tileEntry: {} }));
        await loader.stagePresetTextures(entries, {}, progress);
        expect(progress.mock.calls.map(call => call[0])).toEqual(Array(6).fill('building'));
        expect(progress.mock.calls.map(call => call[1])).toEqual([0, 1, 1, 2, 3, 3]);
        expect(progress.mock.calls.every(call => call[2] === 3)).toBe(true);
    });
});
