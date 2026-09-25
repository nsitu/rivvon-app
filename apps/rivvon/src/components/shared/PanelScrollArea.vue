<script setup>
    import ScrollPanel from 'primevue/scrollpanel';
</script>

<template>
    <ScrollPanel class="panel-scroll-area">
        <slot />
    </ScrollPanel>
</template>

<style scoped>
    .panel-scroll-area {
        --p-scrollpanel-bar-size: 0.55rem;
        --p-scrollpanel-bar-background: rgba(255, 255, 255, 0.34);
        flex: 1;
        height: 100%;
        min-height: 0;
        width: 100%;
        margin: 0 auto;
    }

    :deep(.panel-scroll-area .p-scrollpanel-content-container) {
        height: 100%;
        min-height: 0;
    }

    :deep(.panel-scroll-area .p-scrollpanel-content) {
        height: 100%;
        min-height: 100%;
        overflow-x: hidden;
        padding-bottom: 0;
    }

    :deep(.panel-scroll-area .p-scrollpanel-bar) {
        opacity: 0.55;
    }

    :deep(.panel-scroll-area:hover .p-scrollpanel-bar),
    :deep(.panel-scroll-area:active .p-scrollpanel-bar),
    :deep(.panel-scroll-area .p-scrollpanel-bar:focus-visible) {
        opacity: 0.9;
    }
</style>
