<script setup>
    import { ref, onMounted, watch } from 'vue';
    import { useAppStore } from '../stores/appStore';
    import { fetchTextures } from '../services/textureService';

    const props = defineProps({
        visible: {
            type: Boolean,
            default: false
        }
    });

    const emit = defineEmits(['close', 'select']);

    const app = useAppStore();

    // State
    const textures = ref([]);
    const isLoading = ref(false);
    const error = ref(null);
    const hasLoaded = ref(false);

    // Load textures when modal opens
    watch(() => props.visible, async (isVisible) => {
        if (isVisible && !hasLoaded.value && !isLoading.value) {
            await loadTextures();
        }
    });

    async function loadTextures() {
        isLoading.value = true;
        error.value = null;

        try {
            const result = await fetchTextures({ limit: 100 });
            textures.value = result.textures || [];
            hasLoaded.value = true;
        } catch (err) {
            console.error('[TextureBrowser] Failed to load textures:', err);
            error.value = err.message;
        } finally {
            isLoading.value = false;
        }
    }

    function selectTexture(texture) {
        console.log('[TextureBrowser] Selected texture:', texture.id, texture.name);
        emit('select', texture);
        close();
    }

    function close() {
        emit('close');
        app.hideTextureBrowser();
    }

    function handleOverlayClick(event) {
        if (event.target === event.currentTarget) {
            close();
        }
    }

    function handleKeydown(event) {
        if (event.key === 'Escape') {
            close();
        }
    }

    function formatSize(bytes) {
        if (!bytes) return null;
        return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    }

    function getStorageInfo(texture) {
        const provider = texture.storage_provider || 'r2';
        if (provider === 'google-drive') {
            return {
                icon: '/google-drive.svg',
                label: 'Google Drive',
                requiresAuth: true
            };
        }
        return {
            icon: '/cloudflare.svg',
            label: 'CDN',
            requiresAuth: false
        };
    }

    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
</script>

<template>
    <Teleport to="body">
        <div
            v-if="visible"
            class="texture-browser-overlay"
            @click="handleOverlayClick"
            @keydown="handleKeydown"
            tabindex="-1"
        >
            <div class="texture-browser-modal">
                <div class="texture-browser-header">
                    <h2>Texture Library</h2>
                    <button
                        class="texture-browser-close"
                        title="Close"
                        @click="close"
                    >
                        &times;
                    </button>
                </div>

                <div class="texture-browser-content">
                    <!-- Loading state -->
                    <div
                        v-if="isLoading"
                        class="texture-browser-loading"
                    >
                        Loading textures...
                    </div>

                    <!-- Error state -->
                    <div
                        v-else-if="error"
                        class="texture-browser-error"
                    >
                        Failed to load textures: {{ error }}
                    </div>

                    <!-- Empty state -->
                    <div
                        v-else-if="textures.length === 0"
                        class="texture-browser-empty"
                    >
                        No textures available yet.
                    </div>

                    <!-- Texture grid -->
                    <div
                        v-else
                        class="texture-browser-list"
                    >
                        <div
                            v-for="texture in textures"
                            :key="texture.id"
                            class="texture-card"
                            role="button"
                            tabindex="0"
                            @click="selectTexture(texture)"
                            @keydown.enter="selectTexture(texture)"
                            @keydown.space.prevent="selectTexture(texture)"
                        >
                            <!-- Thumbnail -->
                            <div class="texture-card-thumbnail">
                                <img
                                    v-if="texture.thumbnail_url"
                                    :src="texture.thumbnail_url"
                                    :alt="texture.name"
                                />
                                <div
                                    v-else
                                    class="texture-card-placeholder"
                                >
                                    <span>{{ texture.tile_count }} tiles</span>
                                </div>
                                <!-- Storage indicator badge -->
                                <div
                                    class="storage-badge"
                                    :class="{ 'requires-auth': getStorageInfo(texture).requiresAuth }"
                                    :title="getStorageInfo(texture).label"
                                >
                                    <img
                                        :src="getStorageInfo(texture).icon"
                                        :alt="getStorageInfo(texture).label"
                                        class="storage-icon"
                                    />
                                </div>
                            </div>

                            <!-- Info -->
                            <div class="texture-card-info">
                                <h3 class="texture-card-name">{{ texture.name }}</h3>

                                <!-- Owner -->
                                <div
                                    v-if="texture.owner_name"
                                    class="texture-card-owner"
                                >
                                    <img
                                        v-if="texture.owner_picture"
                                        :src="texture.owner_picture"
                                        :alt="texture.owner_name"
                                        class="owner-avatar"
                                    />
                                    <span
                                        v-else
                                        class="owner-avatar-placeholder"
                                    ></span>
                                    <span class="owner-name">{{ texture.owner_name }}</span>
                                </div>

                                <!-- Meta info -->
                                <div class="texture-card-meta">
                                    <span>{{ texture.tile_count }} tiles</span>
                                    <span>{{ texture.tile_resolution }}px</span>
                                    <span>{{ texture.cross_section_type || 'waves' }}</span>
                                    <span>{{ texture.layer_count }} layers</span>
                                    <span v-if="formatSize(texture.total_size_bytes)">
                                        {{ formatSize(texture.total_size_bytes) }}
                                    </span>
                                </div>

                                <!-- Frame info -->
                                <p
                                    v-if="texture.sampled_frame_count && texture.source_frame_count"
                                    class="texture-card-frames"
                                >
                                    Sampled from {{ texture.sampled_frame_count }} of {{ texture.source_frame_count }}
                                    source frames
                                </p>
                                <p
                                    v-else-if="texture.source_frame_count"
                                    class="texture-card-frames"
                                >
                                    Sampled from {{ texture.source_frame_count }} source frames
                                </p>

                                <!-- Description -->
                                <p
                                    v-if="texture.description"
                                    class="texture-card-desc"
                                >
                                    {{ texture.description }}
                                </p>
                            </div>
                        </div>
                    </div>

                    <!-- Create CTA -->
                    <div class="texture-browser-create">
                        <p class="create-invite">Created with</p>
                        <a
                            href="https://slyce.rivvon.ca"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="slyce-link"
                        >slyce</a>
                        <p class="create-invite">texture builder.</p>
                    </div>
                </div>
            </div>
        </div>
    </Teleport>
</template>

<style scoped>
    .texture-browser-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.85);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 2000;
        backdrop-filter: blur(4px);
    }

    .texture-browser-modal {
        background: #1a1a1a;
        border-radius: 0;
        width: 90%;
        max-width: 800px;
        max-height: 80vh;
        display: flex;
        flex-direction: column;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
        border: 1px solid rgba(255, 255, 255, 0.1);
    }

    .texture-browser-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px 20px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }

    .texture-browser-header h2 {
        margin: 0;
        color: #fff;
        font-size: 18px;
        font-weight: 600;
    }

    .texture-browser-close {
        background: transparent;
        border: none;
        color: #888;
        font-size: 28px;
        cursor: pointer;
        padding: 0;
        width: 36px;
        height: 36px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 0;
        transition: all 0.2s;
        min-width: 36px;
        min-height: 36px;
    }

    .texture-browser-close:hover {
        background: rgba(255, 255, 255, 0.1);
        color: #fff;
    }

    .texture-browser-content {
        padding: 20px;
        overflow-y: auto;
        flex: 1;
    }

    .texture-browser-loading,
    .texture-browser-error,
    .texture-browser-empty {
        text-align: center;
        padding: 40px;
        color: #888;
    }

    .texture-browser-error {
        color: #ff6b6b;
    }

    .texture-browser-list {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
        gap: 16px;
    }

    .texture-card {
        background: #252525;
        border-radius: 0;
        overflow: hidden;
        cursor: pointer;
        transition: all 0.2s;
        border: 2px solid transparent;
    }

    .texture-card:hover {
        border-color: #4caf50;
        transform: translateY(-2px);
        box-shadow: 0 8px 20px rgba(0, 0, 0, 0.3);
    }

    .texture-card:focus {
        outline: none;
        border-color: #4caf50;
    }

    .texture-card-thumbnail {
        aspect-ratio: 16 / 9;
        background: #333;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        position: relative;
    }

    .texture-card-thumbnail img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    .texture-card-placeholder {
        color: #666;
        font-size: 14px;
        text-align: center;
    }

    .storage-badge {
        position: absolute;
        top: 8px;
        right: 8px;
        background: rgba(255, 255, 255, 0.8);
        padding: 4px;
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .storage-badge .storage-icon {
        width: 1.5rem;
    }

    .storage-badge.requires-auth .storage-icon {
        opacity: 1;
    }

    .texture-card-info {
        padding: 12px;
    }

    .texture-card-name {
        margin: 0 0 8px 0;
        color: #fff;
        font-size: 14px;
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .texture-card-owner {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
    }

    .texture-card-owner .owner-avatar {
        width: 20px;
        height: 20px;
        border-radius: 0;
        object-fit: cover;
        flex-shrink: 0;
    }

    .texture-card-owner .owner-avatar-placeholder {
        width: 20px;
        height: 20px;
        border-radius: 0;
        background: #444;
        flex-shrink: 0;
    }

    .texture-card-owner .owner-name {
        color: #aaa;
        font-size: 12px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .texture-card-meta {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
    }

    .texture-card-meta span {
        background: #333;
        color: #aaa;
        font-size: 11px;
        padding: 3px 8px;
        border-radius: 0;
    }

    .texture-card-desc {
        margin: 8px 0 0 0;
        color: #888;
        font-size: 12px;
        line-height: 1.4;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }

    .texture-card-frames {
        margin: 6px 0 0 0;
        color: #666;
        font-size: 11px;
        font-style: italic;
    }

    .texture-browser-create {
        margin-top: 32px;
        padding: 32px 20px;
        text-align: center;
        border-top: 1px solid #333;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
    }

    .texture-browser-create .create-invite {
        color: #888;
        font-size: 1rem;
        margin: 0.25rem 0 0 0;
        white-space: pre;
    }

    .texture-browser-create .slyce-link {
        font-family: 'Cascadia Code', sans-serif;
        font-optical-sizing: auto;
        font-weight: 900;
        font-style: italic;
        font-size: 1.5rem;
        letter-spacing: -0.05rem;
        color: #eeeeee;
        text-decoration: none;
        display: inline-block;
        transition: transform 0.2s, color 0.2s;
    }

    .texture-browser-create .slyce-link:hover {
        color: #ffffff;
        transform: scale(1.05);
    }
</style>
