<script setup>
    import { ref, watch, computed } from 'vue';
    import Tabs from 'primevue/tabs';
    import TabList from 'primevue/tablist';
    import Tab from 'primevue/tab';
    import TabPanels from 'primevue/tabpanels';
    import TabPanel from 'primevue/tabpanel';
    import { useEmojiPicker } from '../../composables/viewer/useEmojiPicker';

    const props = defineProps({
        visible: {
            type: Boolean,
            default: false
        }
    });

    const emit = defineEmits(['update:visible', 'generate']);

    const {
        filteredGroups,
        emojiGroups,
        isDataLoaded,
        isLoading,
        isSpriteLoading,
        error,
        searchQuery,
        matchCount,
        loadEmojiData,
        ensureGroupLoaded,
        selectEmoji,
    } = useEmojiPicker();

    const searchInputRef = ref(null);
    const spriteContainerRef = ref(null);
    const activeTab = ref(0);

    /** Short tab labels to keep the tab bar compact */
    const TAB_ICONS = {
        'smileys-emotion': '😀',
        'people-body': '🧑',
        'animals-nature': '🐾',
        'food-drink': '🍔',
        'travel-places': '✈️',
        'activities': '⚽',
        'objects': '💡',
        'symbols': '💕',
        'flags': '🏁',
        'extras-openmoji': '⊕',
        'extras-unicode': '∞',
    };

    /** True when search query is active → show flat results instead of tabs */
    const isSearching = computed(() => searchQuery.value.trim().length > 0);

    // Load emoji data lazily when panel first becomes visible,
    // then load the first group's sprite
    watch(() => props.visible, async (visible) => {
        if (visible && !isDataLoaded.value) {
            await loadEmojiData();
            // Load the first tab's sprite
            loadActiveSprite();
        }
        if (visible) {
            setTimeout(() => searchInputRef.value?.focus(), 100);
        }
    }, { immediate: true });

    // Load sprite when tab changes
    watch(activeTab, () => loadActiveSprite());

    /** Load the sprite for the currently active tab */
    function loadActiveSprite() {
        if (!emojiGroups.value || !spriteContainerRef.value) return;
        const group = emojiGroups.value[activeTab.value];
        if (group) {
            ensureGroupLoaded(group.slug, spriteContainerRef.value);
        }
    }

    /** When searching, load sprites for all visible groups */
    watch(isSearching, (searching) => {
        if (searching && emojiGroups.value && spriteContainerRef.value) {
            for (const group of emojiGroups.value) {
                ensureGroupLoaded(group.slug, spriteContainerRef.value);
            }
        }
    });

    function close() {
        emit('update:visible', false);
    }

    async function handleEmojiClick(entry) {
        const points = await selectEmoji(entry.h);
        if (points && points.length > 0) {
            emit('generate', points);
            close();
        }
    }
</script>

<template>
    <div
        class="emoji-picker-panel"
        :class="{ active: visible }"
    >
        <!-- Hidden container for injected sprite SVGs -->
        <div
            ref="spriteContainerRef"
            style="position:absolute;width:0;height:0;overflow:hidden"
        ></div>

        <div class="emoji-picker-container">
            <!-- Search bar — always visible -->
            <div class="search-bar">
                <input
                    ref="searchInputRef"
                    v-model="searchQuery"
                    type="text"
                    placeholder="Search emoji..."
                    class="search-field"
                />
                <span
                    v-if="searchQuery"
                    class="search-count"
                >{{ matchCount }} result{{ matchCount !== 1 ? 's' : '' }}</span>
            </div>

            <!-- Loading spinner for initial data load -->
            <div
                v-if="!isDataLoaded"
                class="loading-state"
            >
                <span class="material-symbols-outlined spin">progress_activity</span>
                <span>Loading emoji...</span>
            </div>

            <!-- Loading overlay for SVG fetch/parse -->
            <div
                v-if="isLoading"
                class="loading-overlay"
            >
                <span class="material-symbols-outlined spin">progress_activity</span>
                <span>Processing emoji...</span>
            </div>

            <!-- Error message -->
            <p
                v-if="error"
                class="error-message"
            >{{ error }}</p>

            <!-- Tabbed view (no search active) -->
            <Tabs
                v-if="isDataLoaded && !isSearching"
                v-model:value="activeTab"
                class="emoji-tabs"
            >
                <TabList class="emoji-tablist">
                    <Tab
                        v-for="(group, idx) in emojiGroups"
                        :key="group.slug"
                        :value="idx"
                        class="emoji-tab"
                        v-tooltip.bottom="group.name"
                    >
                        {{ TAB_ICONS[group.slug] || '•' }}
                    </Tab>
                </TabList>
                <TabPanels class="emoji-tabpanels">
                    <TabPanel
                        v-for="(group, idx) in emojiGroups"
                        :key="group.slug"
                        :value="idx"
                    >
                        <div
                            v-if="isSpriteLoading"
                            class="sprite-loading"
                        >
                            <span class="material-symbols-outlined spin">progress_activity</span>
                        </div>
                        <div
                            v-else
                            class="emoji-grid"
                        >
                            <button
                                v-for="entry in group.emojis"
                                :key="entry.h"
                                class="emoji-btn"
                                :title="entry.n"
                                :disabled="isLoading"
                                @click="handleEmojiClick(entry)"
                            >
                                <svg
                                    class="emoji-img"
                                    viewBox="0 0 72 72"
                                >
                                    <use :href="'#' + entry.h" />
                                </svg>
                            </button>
                        </div>
                    </TabPanel>
                </TabPanels>
            </Tabs>

            <!-- Flat search results (search active) -->
            <div
                v-if="isDataLoaded && isSearching"
                class="emoji-search-results"
            >
                <template
                    v-for="group in filteredGroups"
                    :key="group.slug"
                >
                    <h3 class="group-header">{{ group.name }}</h3>
                    <div class="emoji-grid">
                        <button
                            v-for="entry in group.emojis"
                            :key="entry.h"
                            class="emoji-btn"
                            :title="entry.n"
                            :disabled="isLoading"
                            @click="handleEmojiClick(entry)"
                        >
                            <svg
                                class="emoji-img"
                                viewBox="0 0 72 72"
                            >
                                <use :href="'#' + entry.h" />
                            </svg>
                        </button>
                    </div>
                </template>

                <p
                    v-if="matchCount === 0"
                    class="no-results"
                >No emoji found for "{{ searchQuery }}"</p>
            </div>
        </div>
    </div>
</template>

<style scoped>
    .emoji-picker-panel {
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

    .emoji-picker-panel.active {
        pointer-events: auto;
        opacity: 1;
    }

    .emoji-picker-container {
        display: flex;
        flex-direction: column;
        height: 100%;
        width: 100%;
        max-width: 600px;
        margin: 0 auto;
        background: #1a1a1a;
        padding-top: 5.5rem;
        padding-bottom: 5.5rem;
        overflow: hidden;
    }

    /* Search */
    .search-bar {
        flex-shrink: 0;
        padding: 0.75rem 1rem;
        display: flex;
        align-items: center;
        gap: 0.75rem;
    }

    .search-field {
        flex: 1;
        padding: 0.75rem 1rem;
        border-radius: 6px;
        background: #252525;
        color: white;
        border: 1px solid #374151;
        font-size: 1rem;
    }

    .search-field:focus {
        outline: none;
        border-color: #4caf50;
    }

    .search-count {
        color: #9ca3af;
        font-size: 0.75rem;
        white-space: nowrap;
    }

    /* Tabs */
    .emoji-tabs {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
    }

    .emoji-tablist {
        flex-shrink: 0;
        padding: 0 0.5rem;
    }

    .emoji-tab {
        font-size: 1.25rem;
        padding: 0.4rem 0.5rem;
        min-width: 0;
    }

    .emoji-tabpanels {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        padding: 0.5rem 1rem 1rem;
    }

    /* Flat search results scroll area */
    .emoji-search-results {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        padding: 0 1rem 1rem;
    }

    /* Loading states */
    .loading-state {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.75rem;
        padding: 3rem 0;
        color: #9ca3af;
        font-size: 0.875rem;
    }

    .loading-overlay {
        position: absolute;
        inset: 0;
        z-index: 10;
        background: rgba(26, 26, 26, 0.85);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 0.75rem;
        color: #9ca3af;
        font-size: 0.875rem;
    }

    .spin {
        animation: spin 1s linear infinite;
    }

    @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }

    /* Error */
    .error-message {
        color: #f87171;
        font-size: 0.875rem;
        margin: 0.5rem 0;
        text-align: center;
    }

    /* Group header (search results only) */
    .group-header {
        color: #9ca3af;
        font-size: 0.75rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin: 1rem 0 0.5rem;
        padding-bottom: 0.25rem;
        border-bottom: 1px solid #2a2a2a;
    }

    .group-header:first-child {
        margin-top: 0;
    }

    /* Emoji grid */
    .emoji-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(2.75rem, 1fr));
        gap: 2px;
    }

    .emoji-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        aspect-ratio: 1;
        background: transparent;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        transition: background 0.15s ease;
        padding: 4px;
        color: #e0e0e0;
    }

    .emoji-btn:hover:not(:disabled) {
        background: #333;
    }

    .emoji-btn:active:not(:disabled) {
        background: #444;
    }

    .emoji-btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }

    .emoji-img {
        width: 100%;
        height: 100%;
        pointer-events: none;
        overflow: visible;
    }

    /* Sprite loading indicator within a tab panel */
    .sprite-loading {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 2rem 0;
        color: #9ca3af;
    }

    /* No results */
    .no-results {
        color: #6b7280;
        font-size: 0.875rem;
        text-align: center;
        padding: 2rem 0;
    }
</style>
