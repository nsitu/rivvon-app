<template>
    <div class="local-textures-page slyce-page">


        <div class="max-w-6xl mx-auto px-4 py-8">
            <div class="flex justify-between items-center mb-6">
                <h1 class="text-2xl font-bold">Local Textures</h1>
                <div class="storage-info text-sm text-gray-400">
                    <span v-if="storageUsage">
                        {{ formatSize(storageUsage.used) }} used of {{ formatSize(storageUsage.quota) }}
                    </span>
                </div>
            </div>

            <!-- Loading State -->
            <div
                v-if="isLoading"
                class="flex items-center justify-center py-12"
            >
                <svg
                    class="animate-spin h-8 w-8 text-purple-600"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                >
                    <circle
                        class="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        stroke-width="4"
                    ></circle>
                    <path
                        class="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8v8H4z"
                    ></path>
                </svg>
                <span class="ml-3 loading-text">Loading local textures...</span>
            </div>

            <!-- Empty State -->
            <div
                v-else-if="textures.length === 0"
                class="text-center py-12 empty-state-container"
            >
                <div class="text-6xl mb-4">💾</div>
                <p class="empty-state-text mb-4">No textures saved locally yet.</p>
                <p class="text-sm text-gray-400 mb-6">
                    Create textures in Slyce and save them to your browser for offline access.
                </p>
                <router-link
                    to="/slyce"
                    class="inline-block action-button px-6 py-2"
                >
                    Create Your First Texture
                </router-link>
            </div>

            <!-- Textures Grid -->
            <div
                v-else
                class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6"
            >
                <div
                    v-for="texture in textures"
                    :key="texture.id"
                    class="texture-card overflow-hidden shadow-sm hover:shadow-md transition-shadow"
                >
                    <!-- Thumbnail -->
                    <div class="aspect-square thumbnail-placeholder relative">
                        <img
                            v-if="texture.thumbnail_data_url"
                            :src="texture.thumbnail_data_url"
                            :alt="texture.name"
                            class="w-full h-full object-cover"
                        />
                        <div
                            v-else
                            class="w-full h-full flex items-center justify-center placeholder-icon"
                        >
                            <span class="text-4xl">🖼️</span>
                        </div>

                        <!-- Local Badge -->
                        <span class="absolute top-2 right-2 px-2 py-0.5 text-xs bg-blue-500 text-white rounded">
                            Local
                        </span>
                    </div>

                    <!-- Info -->
                    <div class="p-4">
                        <h3 class="font-medium card-title truncate mb-1">{{ texture.name }}</h3>
                        <p class="text-xs card-details mb-2">
                            {{ texture.tile_count }} tile{{ texture.tile_count !== 1 ? 's' : '' }} •
                            {{ texture.tile_resolution }}px •
                            {{ texture.layer_count }} layers
                        </p>
                        <p class="text-xs card-date mb-3">
                            {{ formatDate(texture.created_at) }}
                        </p>

                        <!-- Actions -->
                        <div class="flex gap-2">
                            <router-link
                                :to="`/?local=${texture.id}`"
                                class="flex-1 text-center px-3 py-1.5 text-sm action-button"
                            >
                                View
                            </router-link>
                            <button
                                @click="exportTexture(texture)"
                                :disabled="exporting === texture.id"
                                class="px-3 py-1.5 text-sm action-button"
                                title="Export as .zip"
                            >
                                📦
                            </button>
                            <button
                                @click="confirmDelete(texture)"
                                :disabled="deletingId === texture.id"
                                class="px-3 py-1.5 text-sm action-button disabled:opacity-50"
                            >
                                <span v-if="deletingId === texture.id">...</span>
                                <span v-else>🗑️</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Delete Confirmation Modal -->
        <div
            v-if="textureToDelete"
            class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
            @click.self="textureToDelete = null"
        >
            <div class="modal-content p-6 max-w-md w-full mx-4 shadow-xl bg-gray-800 rounded-lg">
                <h3 class="text-lg font-semibold modal-title mb-2">Delete Local Texture</h3>
                <p class="modal-text mb-4 text-gray-300">
                    Are you sure you want to delete "<strong>{{ textureToDelete.name }}</strong>"?
                    This will remove it from your browser storage.
                </p>
                <div class="flex gap-3 justify-end">
                    <button
                        @click="textureToDelete = null"
                        class="px-4 py-2 cancel-button rounded"
                    >
                        Cancel
                    </button>
                    <button
                        @click="performDelete"
                        :disabled="deletingId"
                        class="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
                    >
                        <span v-if="deletingId">Deleting...</span>
                        <span v-else>Delete</span>
                    </button>
                </div>
            </div>
        </div>

    </div>
</template>

<script setup>
    import { ref, onMounted } from 'vue'
    import { useLocalStorage } from '../services/localStorage.js'

    const {
        getAllTextureSets,
        deleteTextureSet,
        downloadTextureSetAsZip,
        getStorageUsage
    } = useLocalStorage()

    const textures = ref([])
    const isLoading = ref(true)
    const storageUsage = ref(null)
    const textureToDelete = ref(null)
    const deletingId = ref(null)
    const exporting = ref(null)

    onMounted(async () => {
        await loadTextures()
        await checkStorageUsage()
    })

    async function loadTextures() {
        isLoading.value = true
        try {
            textures.value = await getAllTextureSets()
        } catch (err) {
            console.error('Failed to load local textures:', err)
        } finally {
            isLoading.value = false
        }
    }

    async function checkStorageUsage() {
        try {
            storageUsage.value = await getStorageUsage()
        } catch (err) {
            console.error('Failed to get storage usage:', err)
        }
    }

    function confirmDelete(texture) {
        textureToDelete.value = texture
    }

    async function performDelete() {
        if (!textureToDelete.value) return

        deletingId.value = textureToDelete.value.id
        try {
            await deleteTextureSet(textureToDelete.value.id)
            textures.value = textures.value.filter(t => t.id !== textureToDelete.value.id)
            textureToDelete.value = null
            // Refresh storage usage after delete
            await checkStorageUsage()
        } catch (err) {
            console.error('Failed to delete texture:', err)
        } finally {
            deletingId.value = null
        }
    }

    async function exportTexture(texture) {
        exporting.value = texture.id
        try {
            await downloadTextureSetAsZip(texture.id)
        } catch (err) {
            console.error('Failed to export texture:', err)
            alert('Failed to export texture: ' + err.message)
        } finally {
            exporting.value = null
        }
    }

    function formatDate(timestamp) {
        if (!timestamp) return 'Unknown'
        return new Date(timestamp).toLocaleDateString()
    }

    function formatSize(bytes) {
        if (!bytes) return '0 B'
        const units = ['B', 'KB', 'MB', 'GB']
        let i = 0
        while (bytes >= 1024 && i < units.length - 1) {
            bytes /= 1024
            i++
        }
        return `${bytes.toFixed(1)} ${units[i]}`
    }
</script>

<style scoped>
    .slyce-page {
        min-height: 100vh;
        background: #1a1a2e;
        color: white;
    }

    .texture-card {
        background: #2a2a3e;
        border-radius: 0.5rem;
    }

    .thumbnail-placeholder {
        background: #3a3a4e;
    }

    .action-button {
        background: #4a4a5e;
        border-radius: 0.25rem;
        transition: background 0.2s;
    }

    .action-button:hover {
        background: #5a5a6e;
    }

    .cancel-button {
        background: #4a4a5e;
    }

    .cancel-button:hover {
        background: #5a5a6e;
    }

    .empty-state-text {
        color: #a0a0b0;
    }

    .card-title {
        color: #fff;
    }

    .card-details {
        color: #a0a0b0;
    }

    .card-date {
        color: #808090;
    }

    .loading-text {
        color: #a0a0b0;
    }
</style>
