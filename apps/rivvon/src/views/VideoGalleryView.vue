<script setup>
    import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
    import { RouterLink } from 'vue-router';
    import Button from 'primevue/button';
    import InputText from 'primevue/inputtext';
    import Textarea from 'primevue/textarea';
    import ToggleSwitch from 'primevue/toggleswitch';
    import { useGoogleAuth } from '../composables/shared/useGoogleAuth.js';
    import { deleteVideoPublication, fetchMyVideos, fetchVideos, publishVideoBlob } from '../services/videoService.js';

    const { isAuthenticated, isAdmin, login, user } = useGoogleAuth();
    const activeTab = ref('public');
    const videos = ref([]);
    const isLoading = ref(false);
    const error = ref('');
    const deletingIds = ref(new Set());

    const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024;
    const uploadDialogVisible = ref(false);
    const uploadFileInput = ref(null);
    const uploadFile = ref(null);
    const uploadMetadata = ref(null);
    const uploadThumbnail = ref(null);
    const uploadName = ref('');
    const uploadDescription = ref('');
    const uploadIsPublic = ref(true);
    const uploadProgress = ref(0);
    const uploadStatus = ref('');
    const uploadError = ref('');
    const isUploading = ref(false);
    let uploadAbortController = null;

    const canUpload = computed(() => isAuthenticated.value && isAdmin.value);

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

    function getFilenameTitle(file) {
        return file.name.replace(/\.[^.]+$/, '').trim().slice(0, 120);
    }

    function createCanvasThumbnail(video) {
        const maxWidth = 1600;
        const scale = Math.min(1, maxWidth / video.videoWidth);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        const context = canvas.getContext('2d');
        if (!context) return Promise.resolve(null);
        context.drawImage(video, 0, 0, canvas.width, canvas.height);

        return new Promise((resolve) => {
            canvas.toBlob((blob) => resolve(blob), 'image/webp', 0.82);
        });
    }

    async function inspectVideoFile(file) {
        const objectUrl = URL.createObjectURL(file);
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.muted = true;
        video.playsInline = true;
        video.src = objectUrl;

        try {
            await new Promise((resolve, reject) => {
                video.addEventListener('loadedmetadata', resolve, { once: true });
                video.addEventListener('error', () => reject(new Error('The selected file could not be read as a video.')), { once: true });
                video.load();
            });

            const duration = Number(video.duration);
            const width = Number(video.videoWidth);
            const height = Number(video.videoHeight);
            if (!Number.isFinite(duration) || duration <= 0 || !width || !height) {
                throw new Error('The selected video has invalid dimensions or duration.');
            }

            let thumbnail = null;
            try {
                const seekTime = Math.min(0.5, duration / 2);
                if (seekTime > 0) {
                    await new Promise((resolve, reject) => {
                        video.addEventListener('seeked', resolve, { once: true });
                        video.addEventListener('error', () => reject(new Error('Unable to seek video thumbnail.')), { once: true });
                        video.currentTime = seekTime;
                    });
                }
                thumbnail = await createCanvasThumbnail(video);
            } catch {
                // A thumbnail is helpful but should not prevent an admin upload.
            }

            return { duration, width, height, thumbnail };
        } finally {
            video.removeAttribute('src');
            video.load();
            URL.revokeObjectURL(objectUrl);
        }
    }

    function resetUploadForm() {
        uploadFile.value = null;
        uploadMetadata.value = null;
        uploadThumbnail.value = null;
        uploadName.value = '';
        uploadDescription.value = '';
        uploadIsPublic.value = true;
        uploadProgress.value = 0;
        uploadStatus.value = '';
        uploadError.value = '';
        if (uploadFileInput.value) uploadFileInput.value.value = '';
    }

    function openUploadDialog() {
        if (!canUpload.value) return;
        resetUploadForm();
        uploadDialogVisible.value = true;
    }

    function closeUploadDialog() {
        if (isUploading.value) return;
        uploadDialogVisible.value = false;
        resetUploadForm();
    }

    async function handleUploadFileSelected(event) {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;

        uploadFile.value = null;
        uploadMetadata.value = null;
        uploadThumbnail.value = null;
        uploadError.value = '';
        uploadStatus.value = 'Reading video metadata…';

        if (!['video/mp4', 'video/webm'].includes(file.type)) {
            uploadStatus.value = '';
            uploadError.value = 'Choose an MP4 or WebM video.';
            return;
        }
        if (file.size <= 0 || file.size > MAX_VIDEO_BYTES) {
            uploadStatus.value = '';
            uploadError.value = 'The video must be smaller than 2 GB.';
            return;
        }

        try {
            const metadata = await inspectVideoFile(file);
            uploadFile.value = file;
            uploadMetadata.value = metadata;
            uploadThumbnail.value = metadata.thumbnail;
            uploadName.value = getFilenameTitle(file);
            uploadStatus.value = 'Ready to upload.';
        } catch (fileError) {
            uploadStatus.value = '';
            uploadError.value = fileError?.message || 'Unable to inspect the selected video.';
        }
    }

    async function handleUpload() {
        if (isUploading.value) return;
        if (!canUpload.value) {
            uploadError.value = 'Only signed-in administrators can upload gallery videos.';
            return;
        }
        if (!uploadFile.value || !uploadMetadata.value) {
            uploadError.value = 'Choose a valid video before uploading.';
            return;
        }

        isUploading.value = true;
        uploadError.value = '';
        uploadProgress.value = 0;
        uploadAbortController = new AbortController();

        try {
            await publishVideoBlob({
                metadata: {
                    name: uploadName.value.trim() || getFilenameTitle(uploadFile.value),
                    description: uploadDescription.value,
                    isPublic: uploadIsPublic.value,
                    mimeType: uploadFile.value.type,
                    width: uploadMetadata.value.width,
                    height: uploadMetadata.value.height,
                    duration: uploadMetadata.value.duration,
                    userProfile: user.value ? {
                        name: user.value.name,
                        email: user.value.email,
                        picture: user.value.picture,
                    } : null,
                },
                blob: uploadFile.value,
                thumbnailBlob: uploadThumbnail.value,
                signal: uploadAbortController.signal,
                onProgress: (progress) => {
                    uploadProgress.value = progress;
                    uploadStatus.value = `Uploading video… ${Math.round(progress * 100)}%`;
                },
                onStatus: (status) => {
                    uploadStatus.value = status;
                },
            });

            uploadStatus.value = 'Published to the video gallery.';
            await loadVideos();
            uploadDialogVisible.value = false;
            resetUploadForm();
        } catch (uploadFailure) {
            const cancelled = uploadFailure?.name === 'AbortError';
            uploadStatus.value = cancelled ? 'Upload cancelled.' : '';
            uploadError.value = cancelled ? '' : (uploadFailure?.message || 'Gallery upload failed.');
        } finally {
            isUploading.value = false;
            uploadAbortController = null;
        }
    }

    function cancelUpload() {
        if (isUploading.value) {
            uploadAbortController?.abort();
            return;
        }
        closeUploadDialog();
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
    onBeforeUnmount(() => uploadAbortController?.abort());
</script>

<template>
    <main class="video-gallery-panel">
        <div class="video-gallery-content viewer-chrome-panel-container">
            <div class="video-gallery-scroll">
                <div class="gallery-controls">
                    <nav class="gallery-tabs" aria-label="Video collections">
                        <button :class="{ active: activeTab === 'public' }" @click="activeTab = 'public'">Public</button>
                        <button :class="{ active: activeTab === 'mine' }" @click="activeTab = 'mine'">My Videos</button>
                    </nav>
                    <div v-if="canUpload || !isAuthenticated" class="gallery-upload-action">
                        <span
                            v-if="!isAuthenticated"
                            id="gallery-upload-login-notice"
                            class="gallery-upload-login-notice"
                            role="status"
                        >
                            Login required to upload videos.
                        </span>
                        <Button
                            type="button"
                            class="gallery-upload-button"
                            :disabled="!canUpload"
                            :title="!canUpload ? 'Login required to upload videos' : undefined"
                            :aria-describedby="!canUpload ? 'gallery-upload-login-notice' : undefined"
                            @click="openUploadDialog"
                        >
                            <span class="material-symbols-outlined">upload_file</span>
                            Upload video
                        </Button>
                    </div>
                </div>

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
            </div>
        </div>

        <Teleport to="body">
            <div
                v-if="uploadDialogVisible"
                class="gallery-modal-backdrop"
                @click.self="closeUploadDialog"
            >
                <section
                    class="gallery-upload-dialog"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="gallery-upload-title"
                >
                    <div class="gallery-upload-dialog-header">
                        <div>
                            <h2 id="gallery-upload-title">Upload video</h2>
                            <p>Add a rendered loop directly to the video gallery.</p>
                        </div>
                        <button
                            type="button"
                            class="gallery-dialog-close"
                            aria-label="Close upload dialog"
                            :disabled="isUploading"
                            @click="closeUploadDialog"
                        >
                            <span class="material-symbols-outlined">close</span>
                        </button>
                    </div>

                    <form class="gallery-upload-form" @submit.prevent="handleUpload">
                        <label class="gallery-file-picker">
                            <span class="gallery-file-picker-label">Video file</span>
                            <input
                                ref="uploadFileInput"
                                type="file"
                                accept="video/mp4,video/webm"
                                :disabled="isUploading"
                                @change="handleUploadFileSelected"
                            >
                            <span class="gallery-file-picker-hint">Choose an MP4 or WebM file, up to 2 GB.</span>
                        </label>

                        <div v-if="uploadFile" class="gallery-selected-file">
                            <span class="material-symbols-outlined">movie</span>
                            <span>{{ uploadFile.name }}</span>
                            <span v-if="uploadMetadata" class="gallery-selected-file-meta">
                                {{ uploadMetadata.width }}×{{ uploadMetadata.height }} · {{ formatDuration(uploadMetadata.duration) }}
                            </span>
                        </div>

                        <div class="gallery-upload-field">
                            <label for="gallery-upload-name">Title</label>
                            <InputText
                                id="gallery-upload-name"
                                v-model="uploadName"
                                maxlength="120"
                                :disabled="isUploading"
                                required
                            />
                        </div>

                        <div class="gallery-upload-field">
                            <label for="gallery-upload-description">Description</label>
                            <Textarea
                                id="gallery-upload-description"
                                v-model="uploadDescription"
                                rows="3"
                                maxlength="2000"
                                auto-resize
                                :disabled="isUploading"
                            />
                        </div>

                        <div class="gallery-upload-visibility">
                            <div>
                                <label for="gallery-upload-public">Public Gallery</label>
                                <span>{{ uploadIsPublic ? 'Anyone can view this video.' : 'Only you can view this video in My Videos.' }}</span>
                            </div>
                            <ToggleSwitch
                                input-id="gallery-upload-public"
                                v-model="uploadIsPublic"
                                :disabled="isUploading"
                            />
                        </div>

                        <div
                            v-if="uploadStatus"
                            class="gallery-upload-status"
                            :class="{ error: uploadError }"
                            role="status"
                        >
                            <span class="material-symbols-outlined">{{ uploadError ? 'warning' : 'cloud_upload' }}</span>
                            <span>{{ uploadError || uploadStatus }}</span>
                        </div>
                        <progress
                            v-if="isUploading"
                            class="gallery-upload-progress"
                            :value="uploadProgress"
                            max="1"
                            aria-label="Video upload progress"
                        />
                        <div v-if="uploadError && !uploadStatus" class="gallery-upload-error" role="alert">
                            <span class="material-symbols-outlined">warning</span>
                            <span>{{ uploadError }}</span>
                        </div>

                        <div class="gallery-upload-actions">
                            <Button
                                type="button"
                                severity="secondary"
                                variant="outlined"
                                @click="cancelUpload"
                            >
                                {{ isUploading ? 'Cancel upload' : 'Cancel' }}
                            </Button>
                            <Button
                                type="submit"
                                :disabled="isUploading || !uploadFile || !uploadMetadata"
                            >
                                <span class="material-symbols-outlined">cloud_upload</span>
                                {{ isUploading ? 'Uploading…' : 'Upload to Gallery' }}
                            </Button>
                        </div>
                    </form>
                </section>
            </div>
        </Teleport>
    </main>
</template>

<style scoped>
    .video-gallery-panel {
        position: absolute;
        inset: 0;
        z-index: 5;
        display: flex;
        flex-direction: column;
        color: #f8fafc;
        background: #1a1a1a;
    }
    .video-gallery-content { display: flex; flex: 1; min-height: 0; flex-direction: column; width: 100%; }
    .video-gallery-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 20px; width: 100%; }
    .gallery-controls { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; margin-bottom: 1.5rem; }
    .gallery-upload-action { display: flex; align-items: center; justify-content: flex-end; gap: .7rem; flex-wrap: wrap; }
    .gallery-upload-login-notice { color: #929292; font-size: .8rem; }
    .gallery-upload-button { flex-shrink: 0; white-space: nowrap; }
    .gallery-upload-button .material-symbols-outlined { font-size: 1.1rem; }
    .gallery-tabs { display: flex; flex-wrap: wrap; gap: .55rem; }
    .gallery-tabs button { min-height: 2.8rem; padding: .55rem 1.1rem; border: 1px solid #555; border-radius: 8px; color: #888; background: transparent; cursor: pointer; font: inherit; transition: border-color .2s ease, color .2s ease, background .2s ease; }
    .gallery-tabs button:hover { border-color: #5a5a5a; color: #e6e6e6; }
    .gallery-tabs button.active { border-color: #4caf50; color: #4caf50; background: rgba(76, 175, 80, .1); }
    .video-card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr)); gap: 20px; }
    .video-card { overflow: hidden; border: 2px solid transparent; border-radius: 0; background: #252525; box-shadow: none; transition: all .2s ease; }
    .video-card:hover { border-color: #4caf50; transform: translateY(-2px); box-shadow: 0 8px 20px rgba(0, 0, 0, .3); }
    .video-card-poster { position: relative; display: grid; aspect-ratio: 16 / 9; overflow: hidden; background: #080910; place-items: center; }
    .video-card-poster img { width: 100%; height: 100%; object-fit: cover; transition: transform .25s ease; }
    .video-card:hover img { transform: scale(1.025); }
    .video-card-placeholder { font-size: 4rem; color: #5b6670; }
    .video-card-play { position: absolute; font-size: 3rem; color: rgba(255,255,255,.9); filter: drop-shadow(0 .25rem .5rem #000); }
    .video-card-duration { position: absolute; right: .6rem; bottom: .55rem; padding: .2rem .4rem; border-radius: .2rem; color: white; background: rgba(0,0,0,.78); font-size: .75rem; }
    .video-card-content { display: flex; flex-direction: column; gap: .8rem; padding: .95rem; }
    .video-card-title-row { display: flex; justify-content: space-between; gap: .8rem; }
    .video-card h2 { margin: 0; color: #f2f2f2; font-size: .98rem; }
    .video-card p { display: -webkit-box; overflow: hidden; margin: .35rem 0 0; color: #969696; font-size: .8rem; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .private-badge { height: fit-content; padding: .2rem .45rem; border: 1px solid #5b4c2d; border-radius: .2rem; color: #e0b96b; background: #342b1b; font-size: .7rem; }
    .video-card-meta, .video-card-footer { display: flex; align-items: center; gap: .7rem; color: #929292; font-size: .72rem; }
    .video-card-meta span + span::before { content: '·'; margin-right: .7rem; }
    .video-card-footer { justify-content: space-between; padding-top: .7rem; border-top: 1px solid #3a3a3a; }
    .delete-video-button { display: grid; width: 2rem; height: 2rem; border: 0; border-radius: .2rem; color: #fca5a5; background: transparent; cursor: pointer; place-items: center; }
    .delete-video-button:hover { background: rgba(239,68,68,.12); }
    .delete-video-button .material-symbols-outlined { font-size: 1.1rem; }
    .gallery-empty { display: flex; min-height: 45vh; max-width: 42rem; margin: auto; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
    .gallery-empty > .material-symbols-outlined { font-size: 3rem; color: #60a5fa; }
    .gallery-empty h2 { margin: 1rem 0 .35rem; }
    .gallery-empty p { color: #929292; }
    .gallery-primary-link { margin-top: .8rem; padding: .7rem 1rem; border-radius: .35rem; color: white; background: #3987da; text-decoration: none; }
    .gallery-error > .material-symbols-outlined { color: #f87171; }
    .gallery-spinner { animation: gallery-spin .9s linear infinite; }
    @keyframes gallery-spin { to { transform: rotate(360deg); } }

    .gallery-modal-backdrop {
        position: fixed;
        inset: 0;
        z-index: 1000;
        display: grid;
        padding: 1rem;
        background: rgba(4, 5, 12, .78);
        place-items: center;
    }
    .gallery-upload-dialog {
        width: min(100%, 34rem);
        max-height: min(90vh, 46rem);
        overflow: auto;
        padding: 1.25rem;
        border: 1px solid #373b52;
        border-radius: 1rem;
        color: #f8fafc;
        background: #171827;
        box-shadow: 0 1.5rem 4rem rgba(0, 0, 0, .45);
    }
    .gallery-upload-dialog-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }
    .gallery-upload-dialog h2 { margin: 0; font-size: 1.25rem; }
    .gallery-upload-dialog-header p { margin: .35rem 0 0; color: #9ca3af; font-size: .85rem; }
    .gallery-dialog-close { display: grid; width: 2rem; height: 2rem; border: 0; border-radius: 50%; color: #cbd5e1; background: transparent; cursor: pointer; place-items: center; }
    .gallery-dialog-close:hover { background: rgba(255, 255, 255, .08); }
    .gallery-dialog-close:disabled { cursor: not-allowed; opacity: .45; }
    .gallery-upload-form { display: flex; flex-direction: column; gap: 1rem; margin-top: 1.25rem; }
    .gallery-file-picker, .gallery-upload-field { display: flex; flex-direction: column; gap: .4rem; }
    .gallery-file-picker-label, .gallery-upload-field label, .gallery-upload-visibility label { color: #e5e7eb; font-size: .85rem; font-weight: 600; }
    .gallery-file-picker input[type='file'] { width: 100%; padding: .65rem; border: 1px dashed #59617d; border-radius: .55rem; color: #cbd5e1; background: #10111e; }
    .gallery-file-picker-hint { color: #818898; font-size: .75rem; }
    .gallery-selected-file { display: flex; align-items: center; gap: .5rem; min-width: 0; padding: .65rem .75rem; border-radius: .55rem; color: #dbeafe; background: rgba(99, 102, 241, .12); font-size: .82rem; }
    .gallery-selected-file > span:nth-child(2) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .gallery-selected-file-meta { margin-left: auto; color: #9ca3af; white-space: nowrap; }
    .gallery-upload-field :deep(.p-inputtext), .gallery-upload-field :deep(.p-textarea) { width: 100%; }
    .gallery-upload-visibility { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: .8rem; border-radius: .6rem; background: rgba(255, 255, 255, .04); }
    .gallery-upload-visibility > div { display: flex; flex-direction: column; gap: .25rem; }
    .gallery-upload-visibility span { color: #818898; font-size: .75rem; }
    .gallery-upload-status, .gallery-upload-error { display: flex; align-items: center; gap: .5rem; color: #a5b4fc; font-size: .82rem; }
    .gallery-upload-status.error, .gallery-upload-error { color: #fca5a5; }
    .gallery-upload-status .material-symbols-outlined, .gallery-upload-error .material-symbols-outlined { font-size: 1.1rem; }
    .gallery-upload-progress { width: 100%; height: .45rem; accent-color: #818cf8; }
    .gallery-upload-actions { display: flex; justify-content: flex-end; gap: .65rem; }

    @media (max-width: 600px) {
        .gallery-controls { align-items: stretch; flex-direction: column; }
        .gallery-upload-action { align-items: stretch; flex-direction: column; }
        .gallery-upload-button { width: 100%; }
        .gallery-selected-file { flex-wrap: wrap; }
        .gallery-selected-file-meta { width: 100%; margin-left: 1.6rem; }
    }
</style>
