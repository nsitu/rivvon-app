<template>
    <div class="my-textures-page">
        <Header />

        <div class="max-w-6xl mx-auto px-4 py-8">
            <h1 class="text-2xl font-bold mb-6">My Textures</h1>

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
                <span class="ml-3 text-gray-600">Loading your textures...</span>
            </div>

            <!-- Not Authenticated -->
            <div
                v-else-if="!isAuthenticated"
                class="text-center py-12 bg-gray-50"
            >
                <p class="text-gray-600 mb-4">Please log in to view your textures.</p>
            </div>

            <!-- Error State -->
            <div
                v-else-if="error"
                class="bg-red-50 border border-red-200 p-4 mb-6"
            >
                <p class="text-red-700">{{ error }}</p>
                <button
                    @click="loadTextures"
                    class="mt-2 text-red-600 hover:text-red-800 underline text-sm"
                >
                    Try again
                </button>
            </div>

            <!-- Empty State -->
            <div
                v-else-if="textures.length === 0"
                class="text-center py-12 bg-gray-50"
            >
                <p class="text-gray-600 mb-4">You haven't uploaded any textures yet.</p>
                <router-link
                    to="/"
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
                    class="texture-card bg-white border border-gray-200 overflow-hidden shadow-sm hover:shadow-md transition-shadow"
                >
                    <!-- Thumbnail -->
                    <div class="aspect-square bg-gray-100 relative">
                        <img
                            v-if="texture.thumbnail_url"
                            :src="texture.thumbnail_url"
                            :alt="texture.name"
                            class="w-full h-full object-cover"
                        />
                        <div
                            v-else
                            class="w-full h-full flex items-center justify-center text-gray-400"
                        >
                            <svg
                                class="w-12 h-12"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                            >
                                <path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    stroke-width="2"
                                    d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                                />
                            </svg>
                        </div>

                        <!-- Public/Private Badge -->
                        <span
                            :class="texture.is_public ? 'bg-green-500' : 'bg-gray-500'"
                            class="absolute top-2 right-2 px-2 py-0.5 text-xs text-white"
                        >
                            {{ texture.is_public ? 'Public' : 'Private' }}
                        </span>
                    </div>

                    <!-- Info -->
                    <div class="p-4">
                        <h3 class="font-medium text-gray-900 truncate mb-1">{{ texture.name }}</h3>
                        <p class="text-xs text-gray-500 mb-2">
                            {{ texture.tile_count }} tile{{ texture.tile_count !== 1 ? 's' : '' }} •
                            {{ texture.tile_resolution }}px •
                            {{ texture.layer_count }} layers
                        </p>
                        <p class="text-xs text-gray-400 mb-3">
                            {{ formatDate(texture.created_at) }}
                        </p>

                        <!-- Actions -->
                        <div class="flex gap-2">
                            <a
                                :href="`https://rivvon.ca/#${texture.id}`"
                                target="_blank"
                                class="flex-1 text-center px-3 py-1.5 text-sm action-button"
                            >
                                View
                            </a>
                            <button
                                @click="confirmDelete(texture)"
                                :disabled="deletingId === texture.id"
                                class="px-3 py-1.5 text-sm action-button disabled:opacity-50"
                            >
                                <span v-if="deletingId === texture.id">...</span>
                                <span v-else>Delete</span>
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
            <div class="bg-white p-6 max-w-md w-full mx-4 shadow-xl">
                <h3 class="text-lg font-semibold text-gray-900 mb-2">Delete Texture</h3>
                <p class="text-gray-600 mb-4">
                    Are you sure you want to delete "<strong>{{ textureToDelete.name }}</strong>"?
                    This will permanently remove all tiles and cannot be undone.
                </p>
                <div class="flex gap-3 justify-end">
                    <button
                        @click="textureToDelete = null"
                        class="px-4 py-2 text-gray-600 hover:text-gray-800"
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

        <Footer />
    </div>
</template>

<script setup>
    import { ref, onMounted, watch } from 'vue'
    import { useAuth0 } from '@auth0/auth0-vue'
    import { useRivvonAPI } from '../services/api.js'
    import Header from '../components/Header.vue'
    import Footer from '../components/Footer.vue'

    const { isAuthenticated, isLoading: authLoading } = useAuth0()
    const { getMyTextures, deleteTextureSet } = useRivvonAPI()

    const textures = ref([])
    const isLoading = ref(true)
    const error = ref(null)
    const textureToDelete = ref(null)
    const deletingId = ref(null)

    const formatDate = (dateStr) => {
        // Handle Unix timestamps (seconds or milliseconds)
        let date
        if (typeof dateStr === 'number') {
            // If timestamp is in seconds (less than year 3000), convert to milliseconds
            date = new Date(dateStr < 10000000000 ? dateStr * 1000 : dateStr)
        } else {
            date = new Date(dateStr)
        }

        return date.toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
        })
    }

    const loadTextures = async () => {
        if (!isAuthenticated.value) {
            isLoading.value = false
            return
        }

        isLoading.value = true
        error.value = null

        try {
            const result = await getMyTextures()
            textures.value = result.textures || result
        } catch (err) {
            console.error('Failed to load textures:', err)
            error.value = err.message || 'Failed to load textures'
        } finally {
            isLoading.value = false
        }
    }

    const confirmDelete = (texture) => {
        textureToDelete.value = texture
    }

    const performDelete = async () => {
        if (!textureToDelete.value) return

        const id = textureToDelete.value.id
        deletingId.value = id

        try {
            await deleteTextureSet(id)
            textures.value = textures.value.filter((t) => t.id !== id)
            textureToDelete.value = null
        } catch (err) {
            console.error('Failed to delete texture:', err)
            error.value = err.message || 'Failed to delete texture'
        } finally {
            deletingId.value = null
        }
    }

    // Load textures when authenticated
    watch(
        () => authLoading.value,
        (loading) => {
            if (!loading && isAuthenticated.value) {
                loadTextures()
            } else if (!loading) {
                isLoading.value = false
            }
        },
        { immediate: true }
    )

    onMounted(() => {
        if (!authLoading.value && isAuthenticated.value) {
            loadTextures()
        } else if (!authLoading.value) {
            isLoading.value = false
        }
    })
</script>

<style scoped>
    .my-textures-page {
        min-height: 100vh;
        display: flex;
        flex-direction: column;
    }

    .action-button {
        background-color: #f0f0f0;
        color: #333;
        border: none;
        border-radius: 0;
        font-weight: 500;
        transition: all 0.2s;
        text-decoration: none;
    }

    .action-button:hover {
        background-color: #4a4a4a;
        color: white;
    }
</style>
