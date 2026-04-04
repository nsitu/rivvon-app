<script setup>
    import { computed, useSlots } from 'vue';
    import Button from 'primevue/button';

    const props = defineProps({
        isSavingLocally: {
            type: Boolean,
            default: false,
        },
        saveLocalProgress: {
            type: String,
            default: '',
        },
        saveLocalError: {
            type: String,
            default: null,
        },
        savedLocalTextureId: {
            type: [String, Number],
            default: null,
        },
        showPending: {
            type: Boolean,
            default: false,
        },
        savingFallbackTitle: {
            type: String,
            default: 'Saving locally...',
        },
        savingDetail: {
            type: String,
            default: 'The finished texture set is being persisted to browser storage.',
        },
        errorDetail: {
            type: String,
            default: 'Retry saving before leaving if you want this texture to remain available later.',
        },
        successTitle: {
            type: String,
            default: 'Saved locally.',
        },
        successDetail: {
            type: String,
            default: 'Manage uploads and exports later from the Texture Browser.',
        },
        pendingTitle: {
            type: String,
            default: 'Finalizing local save...',
        },
        pendingDetail: {
            type: String,
            default: 'The results are ready; persistence is about to start.',
        },
        retryLabel: {
            type: String,
            default: 'Retry Save',
        },
    });

    const emit = defineEmits(['retry']);
    const slots = useSlots();

    const state = computed(() => {
        if (props.isSavingLocally) return 'saving';
        if (props.saveLocalError) return 'error';
        if (props.savedLocalTextureId) return 'success';
        if (props.showPending) return 'pending';
        return null;
    });

    const title = computed(() => {
        switch (state.value) {
            case 'saving':
                return props.saveLocalProgress || props.savingFallbackTitle;
            case 'error':
                return `Local save failed: ${props.saveLocalError}`;
            case 'success':
                return props.successTitle;
            case 'pending':
                return props.pendingTitle;
            default:
                return '';
        }
    });

    const detail = computed(() => {
        switch (state.value) {
            case 'saving':
                return props.savingDetail;
            case 'error':
                return props.errorDetail;
            case 'success':
                return props.successDetail;
            case 'pending':
                return props.pendingDetail;
            default:
                return '';
        }
    });

    const hasSuccessActions = computed(() => state.value === 'success' && !!slots['success-actions']);
</script>

<template>
    <div
        v-if="state"
        class="local-save-status"
        :class="`is-${state}`"
    >
        <div class="local-save-icon-wrap">
            <svg
                v-if="state === 'saving'"
                class="local-save-spinner"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
            >
                <circle
                    class="spinner-track"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    stroke-width="4"
                ></circle>
                <path
                    class="spinner-head"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v8H4z"
                ></path>
            </svg>

            <span
                v-else-if="state === 'error'"
                class="material-symbols-outlined local-save-icon error"
            >error</span>

            <span
                v-else-if="state === 'success'"
                class="material-symbols-outlined local-save-icon success"
            >check_circle</span>

            <span
                v-else
                class="material-symbols-outlined local-save-icon pending"
            >schedule</span>
        </div>

        <div class="local-save-copy">
            <p class="local-save-title">{{ title }}</p>
            <p class="local-save-detail">{{ detail }}</p>
        </div>

        <div
            v-if="state === 'error' || hasSuccessActions"
            class="local-save-actions"
        >
            <Button
                v-if="state === 'error'"
                type="button"
                class="local-save-retry-btn"
                @click="emit('retry')"
            >
                <span class="material-symbols-outlined">refresh</span>
                {{ retryLabel }}
            </Button>

            <slot
                v-else-if="state === 'success'"
                name="success-actions"
            />
        </div>
    </div>
</template>

<style scoped>
    .local-save-status {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        column-gap: 0.9rem;
        row-gap: 0.75rem;
        align-items: start;
        width: 100%;
        padding: 0.9rem 1rem;
        border-radius: 0.85rem;
        border: 1px solid rgba(59, 130, 246, 0.4);
        background: rgba(59, 130, 246, 0.1);
        color: var(--text-primary, rgba(255, 255, 255, 0.94));
        text-align: left;
    }

    .local-save-icon-wrap {
        grid-column: 1;
        grid-row: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        margin-top: 0.1rem;
        color: #60a5fa;
    }

    .local-save-spinner {
        width: 1.25rem;
        height: 1.25rem;
        animation: local-save-spin 0.9s linear infinite;
    }

    .spinner-track {
        opacity: 0.25;
    }

    .spinner-head {
        opacity: 0.8;
    }

    .local-save-icon {
        font-size: 1.3rem;
    }

    .local-save-icon.success {
        color: #4ade80;
    }

    .local-save-icon.error {
        color: #f87171;
    }

    .local-save-icon.pending {
        color: #60a5fa;
    }

    .local-save-copy {
        grid-column: 2;
        min-width: 0;
    }

    .local-save-title {
        margin: 0;
        font-size: 0.95rem;
        font-weight: 600;
        line-height: 1.35;
        color: inherit;
    }

    .local-save-detail {
        margin: 0.2rem 0 0;
        font-size: 0.8rem;
        line-height: 1.4;
        color: var(--text-secondary, rgba(255, 255, 255, 0.72));
    }

    .local-save-actions {
        grid-column: 2;
        display: flex;
        align-items: center;
        gap: 0.75rem;
        flex-wrap: wrap;
        justify-content: flex-start;
    }

    .local-save-retry-btn {
        min-height: 2.75rem;
    }

    .local-save-retry-btn .material-symbols-outlined {
        font-size: 1.05rem;
    }

    @keyframes local-save-spin {
        from {
            transform: rotate(0deg);
        }

        to {
            transform: rotate(360deg);
        }
    }

</style>