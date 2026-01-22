<script setup>
    import { computed } from 'vue';
    import { useAppStore } from '../stores/appStore';
    const app = useAppStore()  // Pinia store

    // Compute sorted status entries for consistent ordering
    const statusEntries = computed(() => {
        return Object.entries(app.status).sort((a, b) => {
            // Priority ordering: System, Processing, Decoding, KTX2 Encoding, Tiles, then errors at bottom
            const priority = (key) => {
                if (key === 'System') return 0;
                if (key === 'Processing') return 1;
                if (key === 'Frame Limit') return 2;
                if (key === 'Decoding') return 3;
                if (key === 'KTX2 Encoding') return 4;
                if (key.startsWith('Tile')) {
                    // Extract tile number for numeric sorting
                    const match = key.match(/Tile (\d+)/);
                    return match ? 5 + parseInt(match[1], 10) : 100;
                }
                if (key.includes('Error')) return 1000;
                return 500;
            };
            return priority(a[0]) - priority(b[0]);
        });
    });

    // Check if a status key represents an error
    const isError = (key) => key.includes('Error');
</script>
<template>
    <div
        v-if="statusEntries.length > 0"
        class="status-container"
    >
        <div
            v-for="[key, value] in statusEntries"
            :key="key"
            class="status-box"
            :class="{ 'status-error': isError(key) }"
        >
            <h4 class="status-title">{{ key }}</h4>
            <div
                class="status-value"
                v-html="value"
            ></div>
        </div>
    </div>
</template>
<style scoped>
    .status-container {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    .status-box {
        padding: 0.75rem 1rem;
        border: 1px solid #e2e8f0;
        border-radius: 0.5rem;
        background: #f8fafc;
        text-align: left;
    }

    .status-box.status-error {
        border-color: #fca5a5;
        background: #fef2f2;
    }

    .status-title {
        margin: 0 0 0.25rem 0;
        font-size: 0.875rem;
        font-weight: 600;
        color: #475569;
    }

    .status-error .status-title {
        color: #dc2626;
    }

    .status-value {
        font-size: 0.875rem;
        color: #64748b;
    }

    .status-error .status-value {
        color: #991b1b;
    }
</style>