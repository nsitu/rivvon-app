import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSSRApp, ref } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { createPinia, disposePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import PrimeVue from 'primevue/config';
import VideoGalleryView from './VideoGalleryView.vue';
import { useVideoDraftStore } from '../stores/videoDraftStore.js';
import { fetchMyVideos, fetchVideos } from '../services/videoService.js';

vi.mock('../composables/shared/useGoogleAuth.js', () => ({
    useGoogleAuth: () => ({ isAuthenticated: ref(false), isAdmin: ref(false), user: ref(null), login: vi.fn() }),
}));
vi.mock('../services/videoService.js', () => ({
    fetchVideos: vi.fn(), fetchMyVideos: vi.fn(), deleteVideoPublication: vi.fn(), publishVideoBlob: vi.fn(),
}));
let pinia;
beforeEach(() => {
    pinia = createPinia();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:retained-video');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    fetchVideos.mockReset().mockResolvedValue({ videos: [] });
    fetchMyVideos.mockReset().mockResolvedValue({ videos: [] });
});
afterEach(() => { disposePinia(pinia); vi.restoreAllMocks(); });

async function renderGallery(location) {
    const router = createRouter({ history: createMemoryHistory(), routes: [
        { path: '/', component: { render: () => null } },
        { path: '/videos', name: 'video-gallery', component: VideoGalleryView },
        { path: '/video/:videoId', name: 'video-player', component: { render: () => null } },
    ] });
    await router.push(location);
    await router.isReady();
    const app = createSSRApp(VideoGalleryView);
    app.use(pinia).use(router).use(PrimeVue);
    return renderToString(app);
}

describe('video gallery draft collection', () => {
    it('opens empty drafts without signing in or contacting the gallery API', async () => {
        const html = await renderGallery('/videos?tab=drafts');
        expect(html).toContain('Drafts (0)');
        expect(html).toContain('No draft encodings yet');
        expect(html).toContain('until you reload or close it');
        expect(html).not.toContain('Sign in to see your videos');
        expect(fetchVideos).not.toHaveBeenCalled();
        expect(fetchMyVideos).not.toHaveBeenCalled();
    });

    it('offers anonymous review and download of every completed encoding while keeping publishing restricted', async () => {
        const drafts = useVideoDraftStore(pinia);
        for (const filename of ['first.webm', 'second.webm']) drafts.addDraft({
            filename, format: 'webm', blob: new Blob(['video'], { type: 'video/webm' }),
            settings: { width: 1280, height: 720, duration: 3 },
        });
        const html = await renderGallery('/videos?tab=drafts');
        expect(html).toContain('Drafts (2)');
        expect(html).toContain('Review first');
        expect(html).toContain('Review second');
        expect(html).toContain('Download');
        expect(html).toContain('Sign in as an administrator to publish videos.');
        expect(html).toMatch(/<button[^>]*disabled[^>]*title="Sign in as an administrator/i);
        expect(html).toContain('Discard draft first');
        expect(fetchVideos).not.toHaveBeenCalled();
    });

    it('keeps the existing public gallery as the default collection', async () => {
        await renderGallery('/videos');
        expect(fetchVideos).toHaveBeenCalledOnce();
        expect(fetchMyVideos).not.toHaveBeenCalled();
    });

    it('retains the My Videos sign-in state independently from drafts', async () => {
        const html = await renderGallery('/videos?tab=mine');
        expect(html).toContain('Sign in to see your videos');
        expect(html).not.toContain('No draft encodings yet');
        expect(fetchMyVideos).not.toHaveBeenCalled();
    });
});
