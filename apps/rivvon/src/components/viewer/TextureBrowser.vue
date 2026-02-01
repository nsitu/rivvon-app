<script setup>
    import { ref, computed, onMounted, watch } from 'vue';
    import { useViewerStore } from '../../stores/viewerStore';
    import { fetchTextures } from '../../services/textureService';
    import { useRivvonAPI } from '../../services/api.js';
    import { useGoogleAuth } from '../../composables/shared/useGoogleAuth';

    const props = defineProps({
        visible: {
            type: Boolean,
            default: false
        },
        initialTab: {
            type: String,
            default: 'all' // 'all' or 'mine'
        }
    });

    const emit = defineEmits(['close', 'select']);

    const app = useViewerStore();
    const { deleteTextureSet } = useRivvonAPI();
    const { isAuthenticated, user } = useGoogleAuth();

    // State
    const textures = ref([]);
    const isLoading = ref(false);
    const error = ref(null);
    const hasLoaded = ref(false);
    const activeTab = ref(props.initialTab);

    // Delete state
    const textureToDelete = ref(null);
    const deletingId = ref(null);

    // Filtered textures based on active tab
    const filteredTextures = computed(() => {
        if (activeTab.value === 'mine' && user.value) {
            // Use google_id for reliable cross-environment ownership check
            return textures.value.filter(t => t.owner_google_id === user.value.googleId);
        }
        return textures.value;
    });

    // Check if current user owns a texture (using google_id for cross-environment reliability)
    function isOwner(texture) {
        return user.value && texture.owner_google_id === user.value.googleId;
    }

    // Load textures when component mounts or visibility changes
    watch(() => props.visible, async (isVisible) => {
        if (isVisible && !hasLoaded.value && !isLoading.value) {
            await loadTextures();
        }
        if (isVisible) {
            activeTab.value = props.initialTab;
        }
    }, { immediate: true });

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

    function handleKeydown(event) {
        if (event.key === 'Escape') {
            if (textureToDelete.value) {
                textureToDelete.value = null;
            } else {
                close();
            }
        }
    }

    // Delete functionality
    function confirmDelete(texture, event) {
        event.stopPropagation(); // Prevent card click
        textureToDelete.value = texture;
    }

    async function performDelete() {
        if (!textureToDelete.value) return;

        deletingId.value = textureToDelete.value.id;
        try {
            await deleteTextureSet(textureToDelete.value.id);
            // Remove from local list
            textures.value = textures.value.filter(t => t.id !== textureToDelete.value.id);
            textureToDelete.value = null;
        } catch (err) {
            console.error('[TextureBrowser] Failed to delete texture:', err);
            error.value = 'Failed to delete: ' + err.message;
        } finally {
            deletingId.value = null;
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
    <div
        class="texture-browser"
        :class="{ active: visible }"
        @keydown="handleKeydown"
        tabindex="-1"
    >
        <div class="texture-browser-container">
            <div class="texture-browser-content">
                <!-- Header -->
                <div class="texture-browser-header">


                    <!-- Tabs -->
                    <div class="texture-browser-tabs">
                        <button
                            :class="['tab-button', { active: activeTab === 'all' }]"
                            @click="activeTab = 'all'"
                        >
                            All Textures
                        </button>
                        <button
                            v-if="isAuthenticated"
                            :class="['tab-button', { active: activeTab === 'mine' }]"
                            @click="activeTab = 'mine'"
                        >
                            My Textures
                        </button>
                    </div>
                </div>

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
                    {{ error }}
                    <button
                        class="retry-button"
                        @click="loadTextures"
                    >Retry</button>
                </div>

                <!-- Empty state -->
                <div
                    v-else-if="filteredTextures.length === 0"
                    class="texture-browser-empty"
                >
                    <template v-if="activeTab === 'mine'">
                        You haven't created any textures yet.
                        <a
                            href="/slyce"
                            class="slyce-link"
                        >Create one with slyce</a>
                    </template>
                    <template v-else>
                        No textures available yet.
                    </template>
                </div>

                <!-- Texture grid -->
                <div
                    v-else
                    class="texture-browser-list"
                >
                    <div
                        v-for="texture in filteredTextures"
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
                            <!-- Delete button for owned textures -->
                            <button
                                v-if="isOwner(texture)"
                                class="delete-button"
                                title="Delete texture"
                                @click="confirmDelete(texture, $event)"
                            >
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    width="16"
                                    height="16"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="2"
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                >
                                    <polyline points="3 6 5 6 21 6"></polyline>
                                    <path
                                        d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
                                    ></path>
                                </svg>
                            </button>
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
                                    crossorigin="anonymous"
                                    referrerpolicy="no-referrer"
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
                        href="/slyce"
                        class="slyce-link"
                    >slyce</a>
                    <p class="create-invite">texture builder.</p>
                </div>
            </div>
        </div>

        <!-- Delete confirmation modal -->
        <Teleport to="body">
            <div
                v-if="textureToDelete"
                class="delete-modal-overlay"
                @click.self="textureToDelete = null"
            >
                <div class="delete-modal">
                    <h3>Delete Texture</h3>
                    <p>Are you sure you want to delete "<strong>{{ textureToDelete.name }}</strong>"?</p>
                    <p class="delete-warning">This action cannot be undone.</p>
                    <div class="delete-modal-actions">
                        <button
                            class="cancel-button"
                            @click="textureToDelete = null"
                            :disabled="deletingId"
                        >
                            Cancel
                        </button>
                        <button
                            class="confirm-delete-button"
                            @click="performDelete"
                            :disabled="deletingId"
                        >
                            {{ deletingId ? 'Deleting...' : 'Delete' }}
                        </button>
                    </div>
                </div>
            </div>
        </Teleport>
    </div>
</template>

<style scoped>
    .texture-browser {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 5;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.3s ease;
        display: flex;
        flex-direction: column;
    }

    .texture-browser.active {
        pointer-events: auto;
        opacity: 1;
    }

    .texture-browser-container {
        display: flex;
        flex-direction: column;
        height: 100%;
        width: 100%;
        background: #1a1a1a;
        padding-top: 5.5rem;
        /* Space for AppHeader */
        padding-bottom: 5.5rem;
        /* Space for BottomToolbar */
    }

    .texture-browser-content {
        flex: 1;
        overflow-y: auto;
        padding: 20px;
        width: 100%;
    }

    .texture-browser-header {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        margin-bottom: 1.5rem;
    }

    @media (min-width: 640px) {
        .texture-browser-header {
            flex-direction: row;
            justify-content: space-between;
            align-items: center;
        }
    }

    .texture-browser-header h2 {
        margin: 0;
        color: #fff;
        font-size: 1.5rem;
        font-weight: 600;
    }

    .texture-browser-tabs {
        display: flex;
        gap: 0.5rem;
    }

    .tab-button {
        background: transparent;
        border: 1px solid #555;
        color: #888;
        font-size: 14px;
        padding: 8px 16px;
        cursor: pointer;
        transition: all 0.2s;
    }

    .tab-button:hover {
        color: #fff;
        background: rgba(255, 255, 255, 0.05);
        border-color: #888;
    }

    .tab-button.active {
        color: #4caf50;
        border-color: #4caf50;
        background: rgba(76, 175, 80, 0.1);
    }

    .texture-browser-loading,
    .texture-browser-error,
    .texture-browser-empty {
        text-align: center;
        padding: 60px 20px;
        color: #888;
    }

    .texture-browser-error {
        color: #ff6b6b;
    }

    .texture-browser-list {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: 20px;
    }

    @media (min-width: 1024px) {
        .texture-browser-list {
            grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
        }
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

    /* Delete button */
    .delete-button {
        position: absolute;
        top: 8px;
        left: 8px;
        background: rgba(220, 38, 38, 0.9);
        border: none;
        color: white;
        width: 28px;
        height: 28px;
        border-radius: 4px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transition: opacity 0.2s, background 0.2s;
        padding: 0;
        min-width: 28px;
        min-height: 28px;
    }

    .texture-card:hover .delete-button {
        opacity: 1;
    }

    .delete-button:hover {
        background: rgba(185, 28, 28, 1);
    }

    /* Retry button */
    .retry-button {
        margin-top: 12px;
        background: #4caf50;
        border: none;
        color: white;
        padding: 8px 16px;
        cursor: pointer;
        font-size: 14px;
    }

    .retry-button:hover {
        background: #45a049;
    }

    /* Delete modal */
    .delete-modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.7);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 3000;
    }

    .delete-modal {
        background: #2a2a2a;
        padding: 24px;
        max-width: 400px;
        width: 90%;
        border: 1px solid rgba(255, 255, 255, 0.1);
    }

    .delete-modal h3 {
        margin: 0 0 16px 0;
        color: #fff;
        font-size: 18px;
    }

    .delete-modal p {
        color: #ccc;
        margin: 0 0 12px 0;
        font-size: 14px;
    }

    .delete-modal .delete-warning {
        color: #ff6b6b;
        font-size: 13px;
    }

    .delete-modal-actions {
        display: flex;
        gap: 12px;
        justify-content: flex-end;
        margin-top: 20px;
    }

    .cancel-button {
        background: #444;
        border: none;
        color: #fff;
        padding: 10px 20px;
        cursor: pointer;
        font-size: 14px;
    }

    .cancel-button:hover:not(:disabled) {
        background: #555;
    }

    .confirm-delete-button {
        background: #dc2626;
        border: none;
        color: #fff;
        padding: 10px 20px;
        cursor: pointer;
        font-size: 14px;
    }

    .confirm-delete-button:hover:not(:disabled) {
        background: #b91c1c;
    }

    .cancel-button:disabled,
    .confirm-delete-button:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }
</style>
