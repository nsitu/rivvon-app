<script setup>
    import { computed, onMounted, ref, watch } from 'vue';
    import { RouterLink } from 'vue-router';
    import Button from 'primevue/button';
    import { useGoogleAuth } from '../composables/shared/useGoogleAuth.js';
    import { deleteVideoPublication, fetchMyVideos, fetchVideos } from '../services/videoService.js';

    const { isAuthenticated, login } = useGoogleAuth();
    const activeTab = ref('public');
    const videos = ref([]);
    const isLoading = ref(false);
    const error = ref('');
    const deletingIds = ref(new Set());

    const isMyVideos = computed(() => activeTab.value === 'mine');

    function formatDuration(seconds) {
        const total = Math.max(0, Math.round(Number(seconds) || 0));
        const minutes = Math.floor(total / 60);
        return `${minutes}:${String(total % 60).padStart(2, '0')}`;
    }

    function formatFileSize(bytes) {
        const value = Number(bytes) || 0;
        if (value >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
        if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
        return `${Math.max(1, Math.round(value / 1024))} KB`;
    }

    function formatDate(timestamp) {
        return new Date(Number(timestamp) * 1000).toLocaleDateString(undefined, {
            year: 'numeric', month: 'short', day: 'numeric',
        });
    }

    async function loadVideos() {
        if (isMyVideos.value && !isAuthenticated.value) {
            videos.value = [];
            return;
        }

        isLoading.value = true;
        error.value = '';
        try {
            const response = isMyVideos.value ? await fetchMyVideos() : await fetchVideos();
            videos.value = response.videos || [];
        } catch (loadError) {
            error.value = loadError?.message || 'Unable to load the video gallery.';
        } finally {
            isLoading.value = false;
        }
    }

    async function deleteVideo(video) {
        if (!window.confirm(`Delete “${video.name}” from Rivvon and R2?`)) return;
        deletingIds.value = new Set([...deletingIds.value, video.id]);
        try {
            await deleteVideoPublication(video.id);
            videos.value = videos.value.filter((entry) => entry.id !== video.id);
        } catch (deleteError) {
            error.value = deleteError?.message || 'Unable to delete the video.';
        } finally {
            const next = new Set(deletingIds.value);
            next.delete(video.id);
            deletingIds.value = next;
        }
    }

    watch([activeTab, isAuthenticated], loadVideos);
    onMounted(loadVideos);
</script>

<template>
    <main class="video-gallery-page">
        <header class="video-gallery-header">
            <RouterLink to="/" class="gallery-brand" aria-label="Return to Rivvon viewer">
                <span class="material-symbols-outlined">airwave</span>
                <span>Rivvon</span>
            </RouterLink>
            <div class="gallery-heading">
                <span class="material-symbols-outlined">video_library</span>
                <div>
                    <h1>Video Gallery</h1>
                    <p>Rendered Rivvon loops ready to watch, share, and download.</p>
                </div>
            </div>
        </header>

        <nav class="gallery-tabs" aria-label="Video collections">
            <button :class="{ active: activeTab === 'public' }" @click="activeTab = 'public'">Public</button>
            <button :class="{ active: activeTab === 'mine' }" @click="activeTab = 'mine'">My Videos</button>
        </nav>

        <section v-if="isMyVideos && !isAuthenticated" class="gallery-empty">
            <span class="material-symbols-outlined">login</span>
            <h2>Sign in to see your videos</h2>
            <p>Private and public videos you publish will appear here.</p>
            <Button @click="login">Sign in</Button>
        </section>
        <section v-else-if="isLoading" class="gallery-empty" aria-live="polite">
            <span class="material-symbols-outlined gallery-spinner">progress_activity</span>
            <h2>Loading videos…</h2>
        </section>
        <section v-else-if="error" class="gallery-empty gallery-error" role="alert">
            <span class="material-symbols-outlined">warning</span>
            <h2>Gallery unavailable</h2>
            <p>{{ error }}</p>
            <Button severity="secondary" @click="loadVideos">Try again</Button>
        </section>
        <section v-else-if="videos.length === 0" class="gallery-empty">
            <span class="material-symbols-outlined">video_library</span>
            <h2>{{ isMyVideos ? 'No published videos yet' : 'The gallery is waiting for its first video' }}</h2>
            <p>Render a video from the viewer, then choose Publish to Gallery.</p>
            <RouterLink to="/" class="gallery-primary-link">Open the viewer</RouterLink>
        </section>
        <section v-else class="video-card-grid" aria-live="polite">
            <article v-for="video in videos" :key="video.id" class="video-card">
                <RouterLink :to="{ name: 'video-player', params: { videoId: video.id } }" class="video-card-poster">
                    <img v-if="video.thumbnail_url" :src="video.thumbnail_url" :alt="`Poster for ${video.name}`">
                    <span v-else class="video-card-placeholder material-symbols-outlined">movie</span>
                    <span class="video-card-play material-symbols-outlined">play_circle</span>
                    <span class="video-card-duration">{{ formatDuration(video.duration) }}</span>
                </RouterLink>
                <div class="video-card-content">
                    <div class="video-card-title-row">
                        <div>
                            <h2>{{ video.name }}</h2>
                            <p v-if="video.description">{{ video.description }}</p>
                        </div>
                        <span v-if="!video.is_public" class="private-badge">Private</span>
                    </div>
                    <div class="video-card-meta">
                        <span>{{ video.width }}×{{ video.height }}</span>
                        <span>{{ video.format.toUpperCase() }}</span>
                        <span>{{ formatFileSize(video.file_size) }}</span>
                    </div>
                    <div class="video-card-footer">
                        <span>{{ video.owner_name || 'Rivvon artist' }} · {{ formatDate(video.created_at) }}</span>
                        <button
                            v-if="isMyVideos"
                            class="delete-video-button"
                            :disabled="deletingIds.has(video.id)"
                            :aria-label="`Delete ${video.name}`"
                            @click="deleteVideo(video)"
                        >
                            <span class="material-symbols-outlined">delete</span>
                        </button>
                    </div>
                </div>
            </article>
        </section>
    </main>
</template>

<style scoped>
    .video-gallery-page {
        min-height: 100vh;
        padding: clamp(1rem, 3vw, 2.5rem);
        color: #f8fafc;
        background: radial-gradient(circle at 15% 0%, #292756 0, #141526 36rem, #0b0c14 75%);
    }
    .video-gallery-header { max-width: 88rem; margin: 0 auto 1.5rem; }
    .gallery-brand { display: inline-flex; align-items: center; gap: .45rem; color: #c7d2fe; text-decoration: none; font-weight: 700; }
    .gallery-heading { display: flex; align-items: center; gap: 1rem; margin-top: 2rem; }
    .gallery-heading > .material-symbols-outlined { font-size: 2.5rem; color: #a5b4fc; }
    h1 { margin: 0; font-size: clamp(1.8rem, 4vw, 3.2rem); }
    .gallery-heading p { margin: .35rem 0 0; color: #a5adbd; }
    .gallery-tabs { display: flex; gap: .4rem; max-width: 88rem; margin: 0 auto 1.5rem; border-bottom: 1px solid #303346; }
    .gallery-tabs button { border: 0; border-bottom: 2px solid transparent; padding: .7rem 1rem; color: #9ca3af; background: transparent; cursor: pointer; }
    .gallery-tabs button.active { color: #eef2ff; border-color: #818cf8; }
    .video-card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 19rem), 1fr)); gap: 1.25rem; max-width: 88rem; margin: auto; }
    .video-card { overflow: hidden; border: 1px solid #2c3040; border-radius: 1rem; background: rgba(22, 24, 36, .88); box-shadow: 0 1rem 2.5rem rgba(0,0,0,.18); }
    .video-card-poster { position: relative; display: grid; aspect-ratio: 16 / 9; overflow: hidden; background: #080910; place-items: center; }
    .video-card-poster img { width: 100%; height: 100%; object-fit: cover; transition: transform .25s ease; }
    .video-card:hover img { transform: scale(1.025); }
    .video-card-placeholder { font-size: 4rem; color: #5b6075; }
    .video-card-play { position: absolute; font-size: 3rem; color: rgba(255,255,255,.9); filter: drop-shadow(0 .25rem .5rem #000); }
    .video-card-duration { position: absolute; right: .6rem; bottom: .55rem; padding: .2rem .4rem; border-radius: .3rem; color: white; background: rgba(0,0,0,.72); font-size: .75rem; }
    .video-card-content { display: flex; flex-direction: column; gap: .8rem; padding: 1rem; }
    .video-card-title-row { display: flex; justify-content: space-between; gap: .8rem; }
    .video-card h2 { margin: 0; font-size: 1rem; }
    .video-card p { display: -webkit-box; overflow: hidden; margin: .35rem 0 0; color: #9ca3af; font-size: .82rem; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .private-badge { height: fit-content; padding: .2rem .45rem; border-radius: 999px; color: #c4b5fd; background: #312e554f; font-size: .7rem; }
    .video-card-meta, .video-card-footer { display: flex; align-items: center; gap: .7rem; color: #818898; font-size: .73rem; }
    .video-card-meta span + span::before { content: '·'; margin-right: .7rem; }
    .video-card-footer { justify-content: space-between; padding-top: .7rem; border-top: 1px solid #292c3a; }
    .delete-video-button { display: grid; width: 2rem; height: 2rem; border: 0; border-radius: 50%; color: #fca5a5; background: transparent; cursor: pointer; place-items: center; }
    .delete-video-button:hover { background: rgba(239,68,68,.12); }
    .delete-video-button .material-symbols-outlined { font-size: 1.1rem; }
    .gallery-empty { display: flex; min-height: 45vh; max-width: 42rem; margin: auto; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
    .gallery-empty > .material-symbols-outlined { font-size: 3rem; color: #818cf8; }
    .gallery-empty h2 { margin: 1rem 0 .35rem; }
    .gallery-empty p { color: #9ca3af; }
    .gallery-primary-link { margin-top: .8rem; padding: .7rem 1rem; border-radius: .55rem; color: white; background: #6366f1; text-decoration: none; }
    .gallery-error > .material-symbols-outlined { color: #f87171; }
    .gallery-spinner { animation: gallery-spin .9s linear infinite; }
    @keyframes gallery-spin { to { transform: rotate(360deg); } }
</style>
