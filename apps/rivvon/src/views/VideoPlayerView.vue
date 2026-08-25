<script setup>
    import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
    import { RouterLink, useRoute } from 'vue-router';
    import { fetchVideo } from '../services/videoService.js';

    const route = useRoute();
    const video = ref(null);
    const isLoading = ref(true);
    const error = ref('');
    const playerContainer = ref(null);
    const videoElement = ref(null);
    const isFullscreen = ref(false);
    const copied = ref(false);

    function formatFileSize(bytes) {
        const value = Number(bytes) || 0;
        return value >= 1024 * 1024
            ? `${(value / 1024 / 1024).toFixed(1)} MB`
            : `${Math.max(1, Math.round(value / 1024))} KB`;
    }

    async function loadVideo() {
        isLoading.value = true;
        error.value = '';
        try {
            const response = await fetchVideo(route.params.videoId);
            video.value = response.video;
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

    watch(() => route.params.videoId, loadVideo);
    onMounted(() => document.addEventListener('fullscreenchange', handleFullscreenChange));
    onBeforeUnmount(() => document.removeEventListener('fullscreenchange', handleFullscreenChange));
    loadVideo();
</script>

<template>
    <main class="video-player-page">
        <header class="video-player-header">
            <RouterLink :to="{ name: 'video-gallery' }" class="back-link">
                <span class="material-symbols-outlined">arrow_back</span>
                Video Gallery
            </RouterLink>
        </header>

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
                    :src="video.playback_url"
                    :poster="video.thumbnail_url || undefined"
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
                    <div class="video-title-line">
                        <h1>{{ video.name }}</h1>
                        <span v-if="!video.is_public" class="private-badge">Private</span>
                    </div>
                    <p v-if="video.description" class="video-description">{{ video.description }}</p>
                    <p class="video-meta">
                        {{ video.owner_name || 'Rivvon artist' }} · {{ video.width }}×{{ video.height }} ·
                        {{ video.format.toUpperCase() }} · {{ formatFileSize(video.file_size) }}
                    </p>
                </div>
                <div class="video-actions">
                    <button @click="copyLink">
                        <span class="material-symbols-outlined">link</span>
                        {{ copied ? 'Copied' : 'Copy Link' }}
                    </button>
                    <a :href="video.playback_url" :download="`${video.name}.${video.format}`">
                        <span class="material-symbols-outlined">download</span>
                        Download
                    </a>
                </div>
            </div>
        </article>
    </main>
</template>

<style scoped>
    .video-player-page { min-height: 100vh; padding: clamp(1rem, 3vw, 2.5rem); color: #f8fafc; background: radial-gradient(circle at 50% -10%, #292756, #11121e 38rem, #080910 80%); }
    .video-player-header, .video-player-content { max-width: 84rem; margin-inline: auto; }
    .back-link { display: inline-flex; align-items: center; gap: .4rem; color: #c7d2fe; text-decoration: none; }
    .video-player-content { margin-top: 1.5rem; }
    .video-player-frame { position: relative; display: grid; overflow: hidden; width: 100%; max-height: 76vh; border: 1px solid #303346; border-radius: 1rem; background: #000; box-shadow: 0 1.5rem 4rem rgba(0,0,0,.35); place-items: center; }
    .video-player-frame:fullscreen { border: 0; border-radius: 0; }
    video { display: block; width: 100%; max-height: 76vh; background: #000; }
    .video-player-frame:fullscreen video { max-height: 100vh; }
    .fullscreen-button { position: absolute; top: .75rem; right: .75rem; display: grid; width: 2.75rem; height: 2.75rem; border: 1px solid rgba(255,255,255,.22); border-radius: 50%; color: white; background: rgba(0,0,0,.55); cursor: pointer; place-items: center; backdrop-filter: blur(8px); }
    .video-detail-row { display: flex; justify-content: space-between; gap: 1.5rem; padding: 1.4rem .25rem; }
    .video-title-line { display: flex; align-items: center; gap: .7rem; }
    h1 { margin: 0; font-size: clamp(1.35rem, 3vw, 2.1rem); }
    .private-badge { padding: .2rem .5rem; border-radius: 999px; color: #c4b5fd; background: #312e55; font-size: .72rem; }
    .video-description { max-width: 60rem; color: #c1c5d0; line-height: 1.55; }
    .video-meta { color: #858b9b; font-size: .82rem; }
    .video-actions { display: flex; align-items: flex-start; gap: .55rem; flex-shrink: 0; }
    .video-actions button, .video-actions a { display: inline-flex; align-items: center; gap: .4rem; padding: .65rem .8rem; border: 1px solid #383c50; border-radius: .55rem; color: #eef2ff; background: #202233; font: inherit; font-size: .82rem; text-decoration: none; cursor: pointer; }
    .video-actions .material-symbols-outlined { font-size: 1.1rem; }
    .player-message { display: flex; min-height: 70vh; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
    .player-message > .material-symbols-outlined { font-size: 3rem; color: #818cf8; }
    .player-message p { color: #9ca3af; }
    .player-message .error-icon { color: #f87171; }
    .player-spinner { animation: player-spin .9s linear infinite; }
    @keyframes player-spin { to { transform: rotate(360deg); } }
    @media (max-width: 700px) { .video-detail-row { flex-direction: column; } .video-actions { width: 100%; } .video-actions > * { flex: 1; justify-content: center; } }
</style>
