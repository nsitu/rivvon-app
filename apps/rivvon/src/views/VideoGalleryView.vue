<script setup>
    import { computed, onBeforeUnmount, ref, watch } from 'vue';
    import { RouterLink, useRoute, useRouter } from 'vue-router';
    import Button from 'primevue/button';
    import Dialog from 'primevue/dialog';
    import ScrollPanel from 'primevue/scrollpanel';
    import PanelActionBar from '../components/shared/PanelActionBar.vue';
    import ChromeButton from '../components/shared/ChromeButton.vue';
    import InputText from 'primevue/inputtext';
    import Textarea from 'primevue/textarea';
    import ToggleSwitch from 'primevue/toggleswitch';
    import { useGoogleAuth } from '../composables/shared/useGoogleAuth.js';
    import { deleteVideoPublication, fetchMyVideos, fetchVideos, publishVideoBlob } from '../services/videoService.js';
    import { useVideoDraftStore } from '../stores/videoDraftStore.js';

    const { isAuthenticated, isAdmin, login, user } = useGoogleAuth();
    const route = useRoute();
    const router = useRouter();
    const videoDrafts = useVideoDraftStore();
    const activeTab = computed({
        get: () => ['mine', 'drafts'].includes(route.query.tab) ? route.query.tab : 'public',
        set: tab => router.replace({ query: { ...route.query, tab: tab === 'public' ? undefined : tab } }),
    });
    const isDrafts = computed(() => activeTab.value === 'drafts');
    const previewDraftId = ref('');
    const previewDraft = computed(() => videoDrafts.getDraft(previewDraftId.value));
    const draftPreviewVisible = computed({
        get: () => !!previewDraft.value,
        set: visible => { if (!visible) previewDraftId.value = ''; },
    });
    const discardDraftId = ref('');
    const discardDraft = computed(() => videoDrafts.getDraft(discardDraftId.value));
    const discardDialogVisible = computed({
        get: () => !!discardDraft.value,
        set: visible => { if (!visible) discardDraftId.value = ''; },
    });
    const videos = ref([]);
    const isLoading = ref(false);
    const error = ref('');
    const deletingIds = ref(new Set());

    const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024;
    const uploadDialogVisible = ref(false);
    const uploadFileInput = ref(null);
    const uploadFile = ref(null);
    const uploadDraftId = ref('');
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
    const publishDisabledReason = computed(() => !isAuthenticated.value
        ? 'Sign in as an administrator to publish videos.' : 'Gallery publishing is currently limited to administrators.');
    let loadRequestId = 0;

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
        const requestId = ++loadRequestId;
        error.value = '';
        if (isDrafts.value || (isMyVideos.value && !isAuthenticated.value)) {
            videos.value = [];
            isLoading.value = false;
            return;
        }

        isLoading.value = true;
        error.value = '';
        try {
            const response = isMyVideos.value ? await fetchMyVideos() : await fetchVideos();
            if (requestId === loadRequestId) videos.value = response.videos || [];
        } catch (loadError) {
            if (requestId === loadRequestId) error.value = loadError?.message || 'Unable to load the video gallery.';
        } finally {
            if (requestId === loadRequestId) isLoading.value = false;
        }
    }

    function getFilenameTitle(file) {
        return (videoDrafts.getDraft(uploadDraftId.value)?.filename || file.name || 'rivvon-video').replace(/\.[^.]+$/, '').trim().slice(0, 120);
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
        uploadDraftId.value = '';
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

    function openDraftPublication(draft) {
        if (!canUpload.value || draft.publication.isPublishing || draft.publication.videoId) return;
        resetUploadForm();
        previewDraftId.value = '';
        uploadDraftId.value = draft.id;
        uploadFile.value = draft.blob;
        uploadMetadata.value = {
            width: draft.settings.width, height: draft.settings.height,
            duration: draft.settings.resolvedDuration || draft.settings.duration,
        };
        uploadThumbnail.value = draft.thumbnailBlob;
        uploadName.value = draft.name.slice(0, 120);
        uploadStatus.value = 'Ready to publish this draft.';
        uploadDialogVisible.value = true;
    }

    function downloadDraft(draft) {
        // The session store owns this URL; downloading must not revoke it.
        const link = document.createElement('a');
        link.href = draft.playbackUrl;
        link.download = draft.filename;
        link.click();
    }

    function confirmDiscardDraft() {
        const draft = discardDraft.value;
        if (!draft || draft.publication.isPublishing) return;
        if (previewDraftId.value === draft.id) previewDraftId.value = '';
        videoDrafts.discardDraft(draft.id);
        discardDraftId.value = '';
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
            const publicationOptions = {
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
            };
            if (uploadDraftId.value) {
                const { name, description, isPublic, userProfile } = publicationOptions.metadata;
                await videoDrafts.publishDraft(uploadDraftId.value, {
                    name, description, isPublic, userProfile,
                    signal: publicationOptions.signal,
                    onProgress: publicationOptions.onProgress,
                    onStatus: publicationOptions.onStatus,
                });
            } else {
                await publishVideoBlob(publicationOptions);
            }

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

    watch([activeTab, isAuthenticated], loadVideos, { immediate: true });
    onBeforeUnmount(() => { loadRequestId++; uploadAbortController?.abort(); });
</script>

<template>
    <main class="video-gallery-panel viewer-panel">
        <div class="video-gallery-content viewer-chrome-panel-container">
            <PanelActionBar
                placement="top"
                appearance="chrome"
                aria-label="Video gallery controls"
                class="gallery-controls"
            >
                <ChromeButton
                    :active="activeTab === 'public'"
                    :aria-pressed="activeTab === 'public'"
                    @click="activeTab = 'public'"
                >Public</ChromeButton>
                <ChromeButton
                    :active="activeTab === 'mine'"
                    :aria-pressed="activeTab === 'mine'"
                    @click="activeTab = 'mine'"
                >My Videos</ChromeButton>
                <ChromeButton
                    :active="isDrafts"
                    :aria-pressed="isDrafts"
                    @click="activeTab = 'drafts'"
                >Drafts ({{ videoDrafts.drafts.length }})</ChromeButton>
                <ChromeButton
                    v-if="canUpload || !isAuthenticated"
                    :disabled="!canUpload"
                    :title="!canUpload ? 'Login required to upload videos' : undefined"
                    :aria-describedby="!canUpload ? (isDrafts ? 'draft-publish-notice' : 'gallery-upload-login-notice') : undefined"
                    @click="openUploadDialog"
                >
                    <span class="material-symbols-outlined" aria-hidden="true">upload_file</span>
                    <span>Upload video</span>
                </ChromeButton>
            </PanelActionBar>
            <p
                v-if="!isAuthenticated && !isDrafts"
                id="gallery-upload-login-notice"
                class="gallery-upload-login-notice"
                role="status"
            >Login required to upload videos.</p>

            <ScrollPanel class="rivvon-scroll-panel video-gallery-scroll">

                <template v-if="isDrafts">
                    <p class="draft-session-notice" role="status">
                        Completed encodings stay in this browser tab until you reload or close it.
                        Download or publish videos you want to keep.
                        <span v-if="videoDrafts.drafts.length">{{ formatFileSize(videoDrafts.totalBytes) }} held in memory.</span>
                    </p>
                    <section v-if="!videoDrafts.drafts.length" class="gallery-empty">
                        <span class="material-symbols-outlined" aria-hidden="true">movie</span>
                        <h2>No draft encodings yet</h2>
                        <p>Encode a video from the viewer. It will appear here even after you close the export workflow.</p>
                        <RouterLink to="/" class="gallery-primary-link">Open the viewer</RouterLink>
                    </section>
                    <section v-else class="video-card-grid" aria-label="Draft encodings">
                        <article v-for="draft in videoDrafts.drafts" :key="draft.id" class="video-card">
                            <Button type="button" variant="text" class="video-card-poster draft-video-poster"
                                :aria-label="`Review ${draft.name}`" @click="previewDraftId = draft.id">
                                <img v-if="draft.thumbnailUrl" :src="draft.thumbnailUrl" :alt="`Poster for ${draft.name}`">
                                <span v-else class="video-card-placeholder material-symbols-outlined" aria-hidden="true">movie</span>
                                <span class="video-card-play material-symbols-outlined" aria-hidden="true">play_circle</span>
                                <span class="video-card-duration">{{ formatDuration(draft.settings.resolvedDuration || draft.settings.duration) }}</span>
                            </Button>
                            <div class="video-card-content">
                                <div class="video-card-title-row">
                                    <h2>{{ draft.name }}</h2>
                                    <span v-if="draft.publication.videoId" class="private-badge">Published</span>
                                </div>
                                <div class="video-card-meta">
                                    <span>{{ draft.settings.width }}×{{ draft.settings.height }}</span>
                                    <span>{{ draft.format.toUpperCase() }}</span>
                                    <span>{{ formatFileSize(draft.size) }}</span>
                                </div>
                                <p v-if="draft.publication.isPublishing" role="status">{{ draft.publication.status }}</p>
                                <p v-else-if="draft.publication.error" role="alert">{{ draft.publication.error }}</p>
                                <div class="draft-card-actions">
                                    <Button type="button" severity="secondary" variant="outlined" @click="downloadDraft(draft)">Download</Button>
                                    <Button v-if="draft.publication.videoId" type="button"
                                        @click="router.push({ name: 'video-player', params: { videoId: draft.publication.videoId } })">Open published</Button>
                                    <Button v-else type="button" :disabled="!canUpload || draft.publication.isPublishing"
                                        :title="!canUpload ? publishDisabledReason : undefined" @click="openDraftPublication(draft)">
                                        {{ draft.publication.isPublishing ? 'Uploading…' : 'Publish' }}
                                    </Button>
                                </div>
                                <div class="video-card-footer">
                                    <span>{{ formatDate(draft.createdAt / 1000) }}</span>
                                    <Button type="button" severity="secondary" variant="text" class="rivvon-icon-action"
                                        :aria-label="`Discard draft ${draft.name}`" :disabled="draft.publication.isPublishing"
                                        @click="discardDraftId = draft.id">
                                        <span class="material-symbols-outlined" aria-hidden="true">delete</span>
                                    </Button>
                                </div>
                            </div>
                        </article>
                    </section>
                    <p v-if="!canUpload" id="draft-publish-notice" class="draft-session-notice">
                        {{ publishDisabledReason }} Playback and downloads are available without signing in.
                        <Button v-if="!isAuthenticated" type="button" variant="link" @click="login">Sign in</Button>
                    </p>
                </template>
                <section v-else-if="isMyVideos && !isAuthenticated" class="gallery-empty">
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
                                <Button
                                    v-if="isMyVideos"
                                    type="button"
                                    severity="danger"
                                    variant="text"
                                    class="delete-video-button rivvon-icon-action"
                                    :disabled="deletingIds.has(video.id)"
                                    :aria-label="`Delete ${video.name}`"
                                    @click="deleteVideo(video)"
                                >
                                    <span class="material-symbols-outlined">delete</span>
                                </Button>
                            </div>
                        </div>
                    </article>
                </section>
            </ScrollPanel>
        </div>

        <Dialog v-model:visible="draftPreviewVisible" modal maximizable :header="previewDraft?.name || 'Draft encoding'"
            class="draft-preview-dialog" :style="{ width: 'min(64rem, calc(100vw - 2rem))' }">
            <!-- Native video controls supply playback, seeking, volume, and fullscreen. -->
            <video v-if="draftPreviewVisible && previewDraft" class="draft-preview-video"
                :src="previewDraft.playbackUrl" :poster="previewDraft.thumbnailUrl || undefined"
                :aria-label="`Playback of ${previewDraft.name}`" controls playsinline preload="metadata" />
            <template #footer>
                <Button type="button" severity="secondary" variant="outlined" @click="draftPreviewVisible = false">Close</Button>
                <Button v-if="previewDraft" type="button" severity="secondary" variant="outlined" @click="downloadDraft(previewDraft)">Download</Button>
                <Button v-if="previewDraft && !previewDraft.publication.videoId" type="button"
                    :disabled="!canUpload || previewDraft.publication.isPublishing"
                    :title="!canUpload ? publishDisabledReason : undefined" @click="openDraftPublication(previewDraft)">Publish</Button>
            </template>
        </Dialog>

        <Dialog v-model:visible="discardDialogVisible" modal header="Discard draft?"
            :style="{ width: 'min(30rem, calc(100vw - 2rem))' }">
            <p>This removes “{{ discardDraft?.name }}” from this browser tab and frees its memory. Download or publish it first if you want to keep it.</p>
            <template #footer>
                <Button type="button" severity="secondary" variant="outlined" @click="discardDialogVisible = false">Cancel</Button>
                <Button type="button" severity="danger" :disabled="discardDraft?.publication.isPublishing" @click="confirmDiscardDraft">Discard draft</Button>
            </template>
        </Dialog>

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
                    <ScrollPanel class="rivvon-scroll-panel gallery-upload-dialog-scroll">
                    <div class="gallery-upload-dialog-content">
                    <div class="gallery-upload-dialog-header">
                        <div>
                            <h2 id="gallery-upload-title">{{ uploadDraftId ? 'Publish draft' : 'Upload video' }}</h2>
                            <p>{{ uploadDraftId ? 'Upload this completed encoding and its thumbnail to the video gallery.' : 'Add a rendered loop directly to the video gallery.' }}</p>
                        </div>
                        <Button
                            type="button"
                            variant="text"
                            rounded
                            class="gallery-dialog-close rivvon-icon-action"
                            aria-label="Close upload dialog"
                            :disabled="isUploading"
                            @click="closeUploadDialog"
                        >
                            <span class="material-symbols-outlined">close</span>
                        </Button>
                    </div>

                    <form class="gallery-upload-form" @submit.prevent="handleUpload">
                        <label v-if="!uploadDraftId" class="gallery-file-picker">
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
                            <span>{{ videoDrafts.getDraft(uploadDraftId)?.filename || uploadFile.name }}</span>
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
                    </div>
                    </ScrollPanel>
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
    }
    .video-gallery-content { display: flex; flex: 1; min-height: 0; flex-direction: column; width: 100%; }
    .video-gallery-scroll { flex: 1; min-height: 0; width: 100%; }
    .video-gallery-scroll :deep(.p-scrollpanel-content) { padding: 20px 20px var(--viewer-bottom-chrome-height); }
    .gallery-upload-login-notice { flex-shrink: 0; margin: 0; padding: .5rem 1rem; color: var(--rivvon-button-muted-color); font-size: .8rem; }
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
    .draft-session-notice { margin: 0 0 1rem; color: var(--p-text-muted-color); line-height: 1.5; }
    .draft-video-poster { width: 100%; padding: 0; border-radius: 0; }
    .draft-card-actions { display: flex; align-items: center; flex-wrap: wrap; gap: .5rem; }
    .video-card-title-row h2 { overflow-wrap: anywhere; min-width: 0; }
    .draft-preview-video { display: block; width: 100%; max-height: 60dvh; background: #080910; }
    .video-card p { display: -webkit-box; overflow: hidden; margin: .35rem 0 0; color: #969696; font-size: .8rem; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .private-badge { height: fit-content; padding: .2rem .45rem; border: 1px solid #5b4c2d; border-radius: .2rem; color: #e0b96b; background: #342b1b; font-size: .7rem; }
    .video-card-meta, .video-card-footer { display: flex; align-items: center; gap: .7rem; color: #929292; font-size: .72rem; }
    .video-card-meta span + span::before { content: '·'; margin-right: .7rem; }
    .video-card-footer { justify-content: space-between; padding-top: .7rem; border-top: 1px solid #3a3a3a; }
    .delete-video-button { color: #fca5a5; background: transparent; }
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
        display: flex;
        flex-direction: column;
        width: min(100%, 34rem);
        max-height: min(90vh, 46rem);
        overflow: hidden;
        border: 1px solid #373b52;
        border-radius: 1rem;
        color: #f8fafc;
        background: #171827;
        box-shadow: 0 1.5rem 4rem rgba(0, 0, 0, .45);
    }
    .gallery-upload-dialog-scroll { flex: 1; min-height: 0; }
    .gallery-upload-dialog-content { padding: 1.25rem; }
    .gallery-upload-dialog-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }
    .gallery-upload-dialog h2 { margin: 0; font-size: 1.25rem; }
    .gallery-upload-dialog-header p { margin: .35rem 0 0; color: #9ca3af; font-size: .85rem; }
    .gallery-dialog-close { display: grid; width: var(--rivvon-icon-action-size); height: var(--rivvon-icon-action-size); border: 0; border-radius: var(--rivvon-button-inline-radius); color: #cbd5e1; background: transparent; place-items: center; }
    .gallery-dialog-close:hover { background: var(--rivvon-button-surface-hover); }
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
        .gallery-selected-file { flex-wrap: wrap; }
        .gallery-selected-file-meta { width: 100%; margin-left: 1.6rem; }
    }
</style>
