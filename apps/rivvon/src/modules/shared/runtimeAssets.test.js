import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
});

async function resolveFfmpeg({ base = '/', cdn = '', mode = '' } = {}) {
    vi.stubEnv('BASE_URL', base);
    vi.stubEnv('VITE_ASSET_BASE_URL', cdn);
    vi.stubEnv('VITE_ASSET_MODE', mode);
    vi.resetModules();
    const { getRuntimeAssetUrl } = await import('./runtimeAssets.js');
    return getRuntimeAssetUrl('ffmpegCoreWasm');
}

describe('FFmpeg WASM delivery', () => {
    it('uses the versioned CDN object when external hosting is configured', async () => {
        expect(await resolveFfmpeg({ cdn: 'https://cdn.rivvon.ca' }))
            .toBe('https://cdn.rivvon.ca/runtime-assets/ffmpeg/0.12.10/ffmpeg-core.wasm');
    });

    it('uses the matching local loader directory without a CDN', async () => {
        expect(await resolveFfmpeg()).toBe('/vendor/ffmpeg/0.12.10/ffmpeg-core.wasm');
    });

    it('honours forced local mode and the application base path', async () => {
        expect(await resolveFfmpeg({ base: '/preview/', cdn: 'https://cdn.rivvon.ca/', mode: 'local' }))
            .toBe('/preview/vendor/ffmpeg/0.12.10/ffmpeg-core.wasm');
    });
});
