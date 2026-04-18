<script setup>
    import { computed } from 'vue';

    const props = defineProps({
        visible: {
            type: Boolean,
            default: false,
        },
        title: {
            type: String,
            default: '',
        },
        description: {
            type: String,
            default: '',
        },
    });

    const normalizedTitle = computed(() => props.title?.trim() || '');
    const normalizedDescription = computed(() => props.description?.trim() || '');
    const hasContent = computed(() => Boolean(normalizedTitle.value || normalizedDescription.value));
</script>

<template>
    <aside
        v-if="visible && hasContent"
        class="texture-metadata-overlay"
    >
        <p
            v-if="normalizedTitle"
            class="texture-metadata-title"
        >{{ normalizedTitle }}</p>
        <p
            v-if="normalizedDescription"
            class="texture-metadata-description"
        >{{ normalizedDescription }}</p>
    </aside>
</template>

<style scoped>
    .texture-metadata-overlay {
        position: absolute;
        top: 6.25rem;
        left: 1rem;
        z-index: 2;
        width: min(32rem, calc(100vw - 2rem));
        padding: 0.95rem 1rem;
        border: 1px solid rgba(148, 163, 184, 0.22);
        border-radius: 1rem;
        background:
            linear-gradient(135deg, rgba(15, 23, 42, 0.82), rgba(30, 41, 59, 0.58));
        box-shadow: 0 18px 48px rgba(2, 6, 23, 0.28);
        backdrop-filter: blur(16px);
        color: rgba(241, 245, 249, 0.96);
        pointer-events: none;
    }

    .texture-metadata-overlay::before {
        content: '';
        position: absolute;
        top: 0.85rem;
        bottom: 0.85rem;
        left: 0;
        width: 3px;
        border-radius: 999px;
        background: linear-gradient(180deg, rgba(96, 165, 250, 0.95), rgba(56, 189, 248, 0.45));
    }

    .texture-metadata-title,
    .texture-metadata-description {
        margin: 0;
    }

    .texture-metadata-title {
        font-size: 1.05rem;
        font-weight: 650;
        line-height: 1.3;
        letter-spacing: 0.01em;
    }

    .texture-metadata-description {
        margin-top: 0.45rem;
        color: rgba(226, 232, 240, 0.86);
        font-size: 0.94rem;
        line-height: 1.55;
        white-space: pre-wrap;
    }

    @media (max-width: 720px) {
        .texture-metadata-overlay {
            top: 5.5rem;
            left: 0.75rem;
            width: calc(100vw - 1.5rem);
            padding: 0.9rem 0.95rem;
        }

        .texture-metadata-title {
            font-size: 1rem;
        }

        .texture-metadata-description {
            font-size: 0.9rem;
        }
    }
</style>