<script setup>
    import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Button from 'primevue/button';
import ScrollPanel from 'primevue/scrollpanel';
import PanelActionBar from '../components/shared/PanelActionBar.vue';
    import { useGoogleAuth } from '../composables/shared/useGoogleAuth.js';
    import { fetchVideo, uploadVideoThumbnail } from '../services/videoService.js';
    import { createVideoThumbnailFromUrl } from '../modules/viewer/videoThumbnail.js';

    const emit = defineEmits(['video-title-change']);

    const { isAuthenticated, isAdmin } = useGoogleAuth();
    const route = useRoute();
    const router = useRouter();
    const video = ref(null);
    const isLoading = ref(true);
    const error = ref('');
    const playerContainer = ref(null);
    const videoElement = ref(null);
    const isFullscreen = ref(false);
    const copied = ref(false);
    const isRegeneratingThumbnail = ref(false);
    const thumbnailStatus = ref('');
    const thumbnailError = ref('');
    const canRegenerateThumbnail = computed(() => isAuthenticated.value && isAdmin.value);
    const mediaVersion = computed(() => video.value?.updated_at || 'cors-v1');

    function versionMediaUrl(url) {
        if (!url) return url;
        const separator = url.includes('?') ? '&' : '?';
        return `${url}${separator}gallery_media=${encodeURIComponent(String(mediaVersion.value))}`;
    }

    const playbackUrl = computed(() => versionMediaUrl(video.value?.playback_url));
    const thumbnailUrl = computed(() => versionMediaUrl(video.value?.thumbnail_url));

    function formatFileSize(bytes) {
        const value = Number(bytes) || 0;
        return value >= 1024 * 1024
            ? `${(value / 1024 / 1024).toFixed(1)} MB`
            : `${Math.max(1, Math.round(value / 1024))} KB`;
    }

    async function loadVideo() {
        isLoading.value = true;
        error.value = '';
        thumbnailStatus.value = '';
        thumbnailError.value = '';
        emit('video-title-change', '');
        try {
            const response = await fetchVideo(route.params.videoId);
            video.value = response.video;
            emit('video-title-change', video.value?.name || '');
        } catch (loadError) {
            error.value = loadError?.message || 'Unable to load this video.';
        } finally {
            isLoading.value = false;
        }
    }

    async function toggleFullscreen() {
        if (document.fullscreenElement) {
            await document.exitFullscreen();
            return;
        }
        if (playerContainer.value?.requestFullscreen) {
            await playerContainer.value.requestFullscreen();
            return;
        }
        videoElement.value?.webkitEnterFullscreen?.();
    }

    function handleFullscreenChange() {
        isFullscreen.value = document.fullscreenElement === playerContainer.value;
    }

    async function copyLink() {
        try {
            await navigator.clipboard.writeText(window.location.href);
            copied.value = true;
            window.setTimeout(() => { copied.value = false; }, 1800);
        } catch {
            error.value = 'Unable to copy the video link.';
        }
    }

    async function regenerateThumbnail() {
        if (!canRegenerateThumbnail.value || !video.value || isRegeneratingThumbnail.value) return;

        isRegeneratingThumbnail.value = true;
        thumbnailStatus.value = 'Generating thumbnail…';
        thumbnailError.value = '';
        try {
            const thumbnailBlob = await createVideoThumbnailFromUrl(playbackUrl.value);
            const result = await uploadVideoThumbnail(video.value.id, thumbnailBlob);
            video.value = { ...video.value, thumbnail_url: result.thumbnailUrl };
            thumbnailStatus.value = 'Thumbnail regenerated.';
        } catch (thumbnailFailure) {
            thumbnailStatus.value = '';
            thumbnailError.value = thumbnailFailure?.message || 'Unable to regenerate the thumbnail.';
        } finally {
            isRegeneratingThumbnail.value = false;
        }
    }

    watch(() => route.params.videoId, loadVideo);
    onMounted(() => document.addEventListener('fullscreenchange', handleFullscreenChange));
    onBeforeUnmount(() => {
        emit('video-title-change', '');
        document.removeEventListener('fullscreenchange', handleFullscreenChange);
    });
    loadVideo();
</script>

<template>
    <main class="video-player-panel">
        <div class="video-player-container viewer-chrome-panel-container">
            <PanelActionBar
                placement="top"
                aria-label="Video player navigation"
                class="video-player-header-actions"
            >
                <Button type="button" severity="secondary" variant="outlined" @click="router.push({ name: 'video-gallery' })">
                    <span class="material-symbols-outlined">arrow_back</span>
                    Back to Video Gallery
                </Button>
                <template v-if="video">
                    <Button type="button" @click="copyLink">
                        <span class="material-symbols-outlined">link</span>
                        {{ copied ? 'Copied' : 'Copy Link' }}
                    </Button>
                    <a
                        class="video-player-download"
                        :href="video.playback_url"
                        :download="`${video.name}.${video.format}`"
                    >
                        <span class="material-symbols-outlined">download</span>
                        Download
                    </a>
                    <Button
                        v-if="canRegenerateThumbnail"
                        type="button"
                        :disabled="isRegeneratingThumbnail"
                        @click="regenerateThumbnail"
                    >
                        <span class="material-symbols-outlined">{{ isRegeneratingThumbnail ? 'progress_activity' : 'refresh' }}</span>
                        {{ isRegeneratingThumbnail ? 'Regenerating…' : 'Regenerate Thumbnail' }}
                    </Button>
                </template>
            </PanelActionBar>
            <ScrollPanel class="rivvon-scroll-panel video-player-scroll">
            <section v-if="isLoading" class="player-message">
                <span class="material-symbols-outlined player-spinner">progress_activity</span>
                <h1>Loading video…</h1>
            </section>
            <section v-else-if="error || !video" class="player-message">
                <span class="material-symbols-outlined error-icon">warning</span>
                <h1>Video unavailable</h1>
                <p>{{ error }}</p>
            </section>
            <article v-else class="video-player-content">
                <div ref="playerContainer" class="video-player-frame">
                    <video
                        ref="videoElement"
                        crossorigin="anonymous"
                        :src="playbackUrl"
                        :poster="thumbnailUrl || undefined"
                        controls
                        playsinline
                        preload="metadata"
                    ></video>
                    <button class="fullscreen-button" :aria-label="isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'" @click="toggleFullscreen">
                        <span class="material-symbols-outlined">{{ isFullscreen ? 'fullscreen_exit' : 'fullscreen' }}</span>
                    </button>
                </div>

                <div class="video-detail-row">
                    <div>
                        <span v-if="!video.is_public" class="private-badge">Private</span>
                        <p v-if="video.description" class="video-description">{{ video.description }}</p>
                        <p class="video-meta">
                            {{ video.owner_name || 'Rivvon artist' }} · {{ video.width }}×{{ video.height }} ·
                            {{ video.format.toUpperCase() }} · {{ formatFileSize(video.file_size) }}
                        </p>
                    </div>
                </div>
                <p v-if="thumbnailStatus" class="thumbnail-status" role="status">{{ thumbnailStatus }}</p>
                <p v-if="thumbnailError" class="thumbnail-status thumbnail-error" role="alert">{{ thumbnailError }}</p>
            </article>
            </ScrollPanel>
        </div>
    </main>
</template>

<style scoped>
    .video-player-panel { position: absolute; inset: 0; z-index: 6; display: flex; flex-direction: column; overflow: hidden; color: #f8fafc; background: #1a1a1a; }
    .video-player-container { display: flex; width: 100%; height: 100%; min-height: 0; flex-direction: column; box-sizing: border-box; }
    .video-player-header-actions { padding-inline: 1rem; }
    .video-player-scroll { flex: 1; min-height: 0; width: 100%; box-sizing: border-box; }
    .video-player-content { box-sizing: border-box; width: min(100%, 84rem); margin-inline: auto; padding: 1.5rem 1.25rem; }
    .video-player-frame { position: relative; display: grid; overflow: hidden; width: 100%; max-height: 76vh; border: 1px solid #345379; border-radius: 0; background: #080910; box-shadow: none; place-items: center; }
    .video-player-frame:fullscreen { border: 0; border-radius: 0; }
    video { display: block; width: 100%; max-height: 76vh; background: #000; }
    .video-player-frame:fullscreen video { max-height: 100vh; }
    .fullscreen-button { position: absolute; top: .75rem; right: .75rem; display: grid; width: 2.75rem; height: 2.75rem; border: 1px solid rgba(255,255,255,.22); border-radius: .2rem; color: white; background: rgba(0,0,0,.55); cursor: pointer; place-items: center; backdrop-filter: blur(8px); }
    .video-detail-row { display: flex; justify-content: space-between; gap: 1.5rem; padding: 1.4rem .25rem; border-bottom: 1px solid #3a3a3a; }
    .private-badge { padding: .2rem .5rem; border: 1px solid #5b4c2d; border-radius: .2rem; color: #e0b96b; background: #342b1b; font-size: .72rem; }
    .video-description { max-width: 60rem; color: #c1c5d0; line-height: 1.55; }
    .video-meta { color: #858b9b; font-size: .82rem; }
    .video-player-header-actions :deep(.panel-action-bar-actions) { justify-content: flex-start; }
    .video-player-download { display: inline-flex; min-height: 2.75rem; align-items: center; gap: .4rem; box-sizing: border-box; padding: .65rem .8rem; border: 1px solid var(--p-button-secondary-border-color, #64748b); border-radius: var(--p-button-border-radius, .2rem); color: var(--p-button-secondary-color, #eef2ff); background: var(--p-button-secondary-background, transparent); font: inherit; font-size: .82rem; text-decoration: none; cursor: pointer; }
    .video-player-download:hover { background: var(--p-button-secondary-hover-background, rgba(255, 255, 255, .08)); }
    .video-player-download .material-symbols-outlined { font-size: 1.1rem; }
    .thumbnail-status { margin: 1rem .25rem 0; color: #65c878; font-size: .82rem; }
    .thumbnail-error { color: #fca5a5; }
    .player-message { display: flex; min-height: 55vh; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
    .player-message > .material-symbols-outlined { font-size: 3rem; color: #60a5fa; }
    .player-message p { color: #9ca3af; }
    .player-message .error-icon { color: #f87171; }
    .player-spinner { animation: player-spin .9s linear infinite; }
    @keyframes player-spin { to { transform: rotate(360deg); } }
    @media (max-width: 700px) { .video-detail-row { flex-direction: column; } .video-player-header-actions :deep(.panel-action-bar-actions) { align-items: stretch; flex-direction: column; } .video-player-header-actions :deep(.p-button), .video-player-download { width: 100%; justify-content: center; } }
</style>
