<template>
    <footer class="panel-action-bar">
        <div
            v-if="$slots.leading"
            class="panel-action-bar-leading"
        >
            <slot name="leading" />
        </div>

        <div class="panel-action-bar-actions">
            <slot />
        </div>
    </footer>
</template>

<style scoped>
    .panel-action-bar {
        --panel-action-bar-gap: 0.75rem;
        --panel-action-bar-padding: 0.85rem 0 0;
        --panel-action-bar-border-color: var(--p-content-border-color, rgba(255, 255, 255, 0.1));
        --panel-action-bar-background: transparent;
        --panel-action-bar-button-min-width: 8rem;
        --panel-action-bar-mobile-basis: 12rem;
        display: flex;
        flex-direction: column;
        gap: var(--panel-action-bar-gap);
        padding: var(--panel-action-bar-padding);
        border-top: 1px solid var(--panel-action-bar-border-color);
        background: var(--panel-action-bar-background);
    }

    .panel-action-bar-leading {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    .panel-action-bar-actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: flex-end;
        gap: var(--panel-action-bar-gap);
    }

    .panel-action-bar-actions :deep(.p-button) {
        min-height: 2.75rem;
        min-width: var(--panel-action-bar-button-min-width);
    }

    .panel-action-bar-actions :deep(.material-symbols-outlined) {
        font-size: 1.1rem;
        line-height: 1;
    }

    @media (max-width: 767px) {
        .panel-action-bar-actions :deep(.p-button) {
            flex: 1 1 var(--panel-action-bar-mobile-basis);
        }
    }
</style>