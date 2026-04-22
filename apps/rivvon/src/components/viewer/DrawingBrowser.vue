<script setup>
    import { computed, ref, watch } from 'vue';
    import Button from 'primevue/button';
    import { createDrawingThumbnailDataUrl } from '../../modules/shared/drawingLibrary.js';
    import { useDrawingStorage } from '../../services/drawingStorage.js';

    const props = defineProps({
        visible: {
            type: Boolean,
            default: false,
        }
    });

    const emit = defineEmits(['close', 'select']);

    const { getAllDrawings, updateDrawing, deleteDrawing } = useDrawingStorage();

    const drawings = ref([]);
    const isLoading = ref(false);
    const error = ref('');

    const hasDrawings = computed(() => drawings.value.length > 0);

    function getKindLabel(kind) {
        switch (kind) {
            case 'gesture':
                return 'Gesture';
            case 'walk':
                return 'Walk';
            case 'text':
                return 'Text';
            case 'emoji':
                return 'Emoji';
            case 'svg':
                return 'SVG';
            default:
                return 'Drawing';
        }
    }

    function formatTimestamp(value) {
        if (!value) {
            return 'Unknown';
        }

        return new Intl.DateTimeFormat(undefined, {
            dateStyle: 'medium',
            timeStyle: 'short',
        }).format(new Date(value));
    }

    function getDrawingSummary(drawing) {
        if (drawing.description) {
            return drawing.description;
        }

        if (drawing.kind === 'text' && typeof drawing.source?.text === 'string') {
            return drawing.source.text.trim();
        }

        if (drawing.kind === 'emoji' && typeof drawing.source?.label === 'string') {
            return drawing.source.label.trim();
        }

        if (drawing.kind === 'svg' && typeof drawing.source?.fileName === 'string') {
            return drawing.source.fileName.trim();
        }

        if (drawing.kind === 'walk' && Number.isFinite(drawing.point_count)) {
            return `${drawing.point_count} points captured`;
        }

        if (drawing.kind === 'gesture' && Number.isFinite(drawing.path_count)) {
            return `${drawing.path_count} path${drawing.path_count === 1 ? '' : 's'}`;
        }

        return 'Saved locally';
    }

    function getDrawingThumbnailUrl(drawing) {
        const regeneratedThumbnail = createDrawingThumbnailDataUrl(drawing?.paths, {
            size: 256,
        });

        return regeneratedThumbnail || drawing?.thumbnail_data_url || null;
    }

    async function loadDrawings() {
        isLoading.value = true;
        error.value = '';

        try {
            drawings.value = await getAllDrawings();
        } catch (loadError) {
            console.error('[DrawingBrowser] Failed to load drawings:', loadError);
            error.value = 'Failed to load saved drawings.';
        } finally {
            isLoading.value = false;
        }
    }

    async function handleRename(drawing) {
        const nextName = prompt('Rename saved drawing', drawing.name || '');
        if (typeof nextName !== 'string') {
            return;
        }

        const trimmedName = nextName.trim();
        if (!trimmedName || trimmedName === drawing.name) {
            return;
        }

        try {
            const updatedDrawing = await updateDrawing(drawing.id, { name: trimmedName });
            drawings.value = drawings.value.map((entry) => (entry.id === drawing.id ? updatedDrawing : entry));
        } catch (renameError) {
            console.error('[DrawingBrowser] Failed to rename drawing:', renameError);
            error.value = 'Failed to rename drawing.';
        }
    }

    async function handleDelete(drawing) {
        const confirmed = confirm(`Delete "${drawing.name}"?`);
        if (!confirmed) {
            return;
        }

        try {
            await deleteDrawing(drawing.id);
            drawings.value = drawings.value.filter((entry) => entry.id !== drawing.id);
        } catch (deleteError) {
            console.error('[DrawingBrowser] Failed to delete drawing:', deleteError);
            error.value = 'Failed to delete drawing.';
        }
    }

    function handleOpen(drawing) {
        emit('select', drawing);
        emit('close');
    }

    watch(() => props.visible, (visible) => {
        if (visible) {
            loadDrawings();
        }
    }, { immediate: true });
</script>

<template>
    <div
        class="drawing-browser"
        :class="{ active: visible }"
    >
        <div class="drawing-browser-container">
            <div class="drawing-browser-content">
                <div class="drawing-browser-header">
                    <div>
                        <p class="drawing-browser-kicker">Local saves</p>
                        <h2 class="drawing-browser-title">Saved drawings</h2>
                    </div>
                    <div class="drawing-browser-count">{{ drawings.length }}</div>
                </div>

                <p
                    v-if="error"
                    class="drawing-browser-error"
                >{{ error }}</p>

                <div
                    v-if="isLoading"
                    class="drawing-browser-empty"
                >Loading saved drawings…</div>

                <div
                    v-else-if="!hasDrawings"
                    class="drawing-browser-empty"
                >New gesture, walk, text, emoji, and SVG drawings will appear here after autosave.</div>

                <div
                    v-else
                    class="drawing-grid"
                >
                    <article
                        v-for="drawing in drawings"
                        :key="drawing.id"
                        class="drawing-card"
                    >
                        <button
                            type="button"
                            class="drawing-card-preview"
                            @click="handleOpen(drawing)"
                        >
                            <img
                                v-if="getDrawingThumbnailUrl(drawing)"
                                :src="getDrawingThumbnailUrl(drawing)"
                                :alt="drawing.name"
                                class="drawing-card-image"
                            />
                            <div
                                v-else
                                class="drawing-card-placeholder"
                            >No preview</div>
                        </button>

                        <div class="drawing-card-body">
                            <div class="drawing-card-meta">
                                <span class="drawing-card-kind">{{ getKindLabel(drawing.kind) }}</span>
                                <span class="drawing-card-date">{{ formatTimestamp(drawing.updated_at) }}</span>
                            </div>

                            <h3 class="drawing-card-title">{{ drawing.name }}</h3>
                            <p class="drawing-card-summary">{{ getDrawingSummary(drawing) }}</p>

                            <div class="drawing-card-actions">
                                <Button
                                    type="button"
                                    size="small"
                                    label="Open"
                                    @click="handleOpen(drawing)"
                                />
                                <Button
                                    type="button"
                                    size="small"
                                    severity="secondary"
                                    label="Rename"
                                    @click="handleRename(drawing)"
                                />
                                <Button
                                    type="button"
                                    size="small"
                                    severity="danger"
                                    label="Delete"
                                    @click="handleDelete(drawing)"
                                />
                            </div>
                        </div>
                    </article>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
    .drawing-browser {
        position: absolute;
        inset: 0;
        z-index: 6;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.2s ease;
        display: flex;
        flex-direction: column;
        background:
            radial-gradient(circle at top, rgba(255, 255, 255, 0.08), transparent 28%),
            linear-gradient(180deg, rgba(5, 10, 19, 0.94) 0%, rgba(5, 8, 16, 0.98) 100%);
    }

    .drawing-browser.active {
        opacity: 1;
        pointer-events: auto;
    }

    .drawing-browser-container {
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        padding-top: 5.5rem;
        padding-bottom: 5.5rem;
        min-height: 0;
    }

    .drawing-browser-content {
        flex: 1;
        min-height: 0;
        padding: 20px;
        overflow-y: auto;
        scrollbar-gutter: stable;
    }

    .drawing-browser-header {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 1rem;
        margin-bottom: 1.5rem;
    }

    .drawing-browser-kicker {
        margin: 0 0 0.35rem;
        font-size: 0.7rem;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.52);
    }

    .drawing-browser-title {
        margin: 0;
        font-size: clamp(1.8rem, 3vw, 2.6rem);
        font-weight: 500;
        color: #fff;
    }

    .drawing-browser-count {
        min-width: 2.5rem;
        height: 2.5rem;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.1);
        color: rgba(255, 255, 255, 0.85);
        font-size: 0.95rem;
        font-weight: 600;
    }

    .drawing-browser-error,
    .drawing-browser-empty {
        margin: 0;
        padding: 1rem 1.15rem;
        border-radius: 1rem;
        background: rgba(255, 255, 255, 0.06);
        color: rgba(255, 255, 255, 0.76);
    }

    .drawing-browser-error {
        margin-bottom: 1rem;
    }

    .drawing-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(240px, 280px));
        justify-content: start;
        gap: 20px;
    }

    .drawing-card {
        display: flex;
        flex-direction: column;
        overflow: hidden;
        min-height: 100%;
        border-radius: 0;
        border: 2px solid transparent;
        background: #252525;
        transition: border-color 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
    }

    .drawing-card:hover {
        border-color: rgba(255, 255, 255, 0.22);
        transform: translateY(-2px);
        box-shadow: 0 8px 20px rgba(0, 0, 0, 0.28);
    }

    .drawing-card-preview {
        padding: 0;
        border: none;
        background: transparent;
        cursor: pointer;
    }

    .drawing-card-image,
    .drawing-card-placeholder {
        display: block;
        width: 100%;
        aspect-ratio: 16 / 9;
        object-fit: cover;
        background: #333;
    }

    .drawing-card-placeholder {
        display: grid;
        place-items: center;
        color: #777;
        font-size: 0.85rem;
    }

    .drawing-card-body {
        display: flex;
        flex: 1;
        flex-direction: column;
        gap: 0.65rem;
        padding: 12px;
        min-height: 0;
    }

    .drawing-card-meta {
        display: flex;
        justify-content: space-between;
        gap: 0.75rem;
        font-size: 0.68rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.52);
    }

    .drawing-card-title {
        margin: 0;
        font-size: 0.95rem;
        font-weight: 600;
        color: #fff;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .drawing-card-summary {
        margin: 0;
        color: rgba(255, 255, 255, 0.72);
        line-height: 1.45;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        min-height: calc(1.45em * 2);
    }

    .drawing-card-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        margin-top: auto;
    }

    @media (min-width: 1280px) {
        .drawing-grid {
            grid-template-columns: repeat(auto-fill, minmax(240px, 300px));
        }
    }

    @media (max-width: 768px) {
        .drawing-browser-container {
            padding-top: 5.5rem;
            padding-bottom: 5.5rem;
        }

        .drawing-browser-content {
            padding: 16px;
        }

        .drawing-browser-header {
            align-items: center;
        }

        .drawing-grid {
            grid-template-columns: minmax(0, 1fr);
        }
    }
</style>