<script setup>
    import Button from 'primevue/button';

    defineOptions({ inheritAttrs: false });

    const props = defineProps({
        active: {
            type: Boolean,
            default: false,
        },
    });
</script>

<template>
    <!-- Shell actions have their own shared surface, independent of theme severity.
         PrimeVue still supplies button semantics and disabled/loading behavior. -->
    <Button
        v-bind="$attrs"
        unstyled
        class="rivvon-chrome-button"
        :class="{ active: props.active }"
    >
        <slot />
    </Button>
</template>
