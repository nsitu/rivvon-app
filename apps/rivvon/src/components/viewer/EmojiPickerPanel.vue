<script setup>
    import { ref, watch } from 'vue';
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
        emojiGroups,
        isDataLoaded,
        isLoading,
        isSpriteLoading,
        error,
        loadEmojiData,
        ensureGroupLoaded,
        selectEmoji,
    } = useEmojiPicker();

    const spriteContainerRef = ref(null);
    const activeTab = ref(0);

    // Load emoji data lazily when panel first becomes visible,
    // then preload all group sprites so tab icons render immediately
    watch(() => props.visible, async (visible) => {
        if (visible && !isDataLoaded.value) {
            await loadEmojiData();
            loadAllSprites();
        }
    }, { immediate: true });

    /** Load sprites for every group (needed for tab icons + grid) */
    function loadAllSprites() {
        if (!emojiGroups.value || !spriteContainerRef.value) return;
        for (const group of emojiGroups.value) {
            ensureGroupLoaded(group.slug, spriteContainerRef.value);
        }
    }

    function close() {
        emit('update:visible', false);
    }

    async function handleEmojiClick(entry) {
        const points = await selectEmoji(entry.h);
        if (points && points.length > 0) {
            emit('generate', {
                points,
                source: {
                    hexcode: entry.h,
                    label: entry.n,
                }
            });
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
            <div class="emoji-picker-content">
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

                <!-- Tabbed view -->
                <Tabs
                    v-if="isDataLoaded"
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
                            <svg
                                class="tab-icon"
                                viewBox="0 0 72 72"
                            >
                                <use :href="'#' + group.emojis[0].h" />
                            </svg>
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

                <!-- Attribution -->
                <div class="attribution">
                    Designed by <a
                        href="https://openmoji.org/"
                        target="_blank"
                        rel="noopener"
                    >OpenMoji</a>.
                    License: <a
                        href="https://creativecommons.org/licenses/by-sa/4.0/#"
                        target="_blank"
                        rel="noopener"
                    >CC BY-SA 4.0</a>
                </div>
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
        background: #1a1a1a;
        padding-top: 5.5rem;
        padding-bottom: 5.5rem;
    }

    .emoji-picker-content {
        flex: 1;
        overflow-y: auto;
        padding: 20px;
        width: 100%;
    }

    /* Tabs */
    .emoji-tabs {
        display: flex;
        flex-direction: column;
    }

    .emoji-tablist {
        flex-shrink: 0;
        padding: 0;
    }

    .emoji-tab {
        padding: 0.4rem 0.5rem;
        min-width: 0;
    }

    .tab-icon {
        width: 2.75rem;
        height: 2.75rem;
        color: #e0e0e0;
        overflow: visible;
        stroke-width: 3;
    }

    .emoji-tabpanels {
        padding: 0.5rem 0 1rem;
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
        from {
            transform: rotate(0deg);
        }

        to {
            transform: rotate(360deg);
        }
    }

    /* Error */
    .error-message {
        color: #f87171;
        font-size: 0.875rem;
        margin: 0.5rem 0;
        text-align: center;
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

    /* Attribution */
    .attribution {
        flex-shrink: 0;
        padding: 0.5rem 1rem;
        text-align: center;
        color: #6b7280;
        font-size: 0.7rem;
    }

    .attribution a {
        color: #9ca3af;
        text-decoration: underline;
        text-underline-offset: 2px;
    }

    .attribution a:hover {
        color: #d1d5db;
    }
</style>
