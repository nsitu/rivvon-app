<script setup>

    import { computed } from 'vue';
    import { useAppStore } from '../stores/appStore';
    const app = useAppStore()  // Pinia store

    const { width, height } = defineProps({
        width: Number,
        height: Number,
        start: Number,
        end: Number,
        aspectRatio: {
            type: String,
            default: '1/1'
        },
        skip: {
            type: Boolean,
            default: false
        }
    })


    const tileClasses = computed(() => {
        let classes = ['tile']
        if (app.outputMode == 'rows') classes.push('tile-row')
        if (app.outputMode == 'columns') classes.push('tile-column')
        if (app.tileMode == 'full') {
            classes.push('tile-full')
        }
        else {
            if (app.tileProportion == 'square') classes.push('tile-square')
            if (app.tileProportion == 'landscape') classes.push('tile-landscape')
            if (app.tileProportion == 'portrait') classes.push('tile-portrait')
        }
        return classes
    })



    const tileStyle = computed(() => {
        if (app.tileMode == 'full') {
            if (app.outputMode == 'columns') {
                return `aspect-ratio: ${app.frameCount}/${app.samplePixelCount};`
            }
            if (app.outputMode == 'rows') {
                return `aspect-ratio: ${app.samplePixelCount}/${app.frameCount};`
            }
        }
        return ''
    })

</script>
<template>

    <div
        :class="tileClasses"
        :style="tileStyle"
        class="flex flex-col items-center justify-center"
    >

        <div class="flex items-center">
            <span class="small-icon material-symbols-outlined">arrow_range</span>
            <span>{{ width }}</span>
            <span style="font-variant: small-caps;">px</span>
        </div>
        <div class="flex items-center">
            <span class="small-icon flipped-icon material-symbols-outlined">arrow_range</span>
            <span> {{ height }} </span>
            <span style="font-variant: small-caps;">px</span>
        </div>
        <div class="flex items-center">

            <span style="font-variant: small-caps;">f</span>
            <span> {{ start }} </span>
            <span class="small-icon material-symbols-outlined">double_arrow</span>
            <span style="font-variant: small-caps;">f</span>
            <span> {{ end }} </span>
        </div>
    </div>

</template>
<style scoped>
    .small-icon {
        font-size: 1.125rem;
    }

    .flipped-icon {
        transform: rotate(90deg);
    }


    .tile {
        border: 2px solid white;
        padding: 0.5rem;
        min-height: 120px;
        min-width: 120px;
    }

    .tile-column {
        background: repeating-linear-gradient(90deg,
                #efefef,
                #efefef 0.25rem,
                #ddd 0.25rem,
                #ddd 0.5rem);
    }

    .tile-row {
        background: repeating-linear-gradient(0deg,
                #efefef,
                #efefef 0.25rem,
                #ddd 0.25rem,
                #ddd 0.5rem);
        /* background-size: 100% 50%;
        animation: move-stripes 4s linear infinite; */
    }

    /* While It is possible to make the stripes animate 
    I don't think it helps to communicate the concept per-se. */

    /* @keyframes move-stripes {
        0% {  background-position: 0 0;  } 
        100% { background-position: 0 100%;  }
    } */

    .tile-square {
        aspect-ratio: 1/1;
    }

    .tile-landscape {
        aspect-ratio: 16/9;
    }

    .tile-portrait {
        aspect-ratio: 9/16;
    }

</style>