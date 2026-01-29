<script setup>

    import { useAppStore } from '../stores/appStore';
    const app = useAppStore()  // Pinia store

    const { plan } = defineProps({
        plan: Object
    })


    import Accordion from 'primevue/accordion';
    import AccordionPanel from 'primevue/accordionpanel';
    import AccordionHeader from 'primevue/accordionheader';
    import AccordionContent from 'primevue/accordioncontent';


</script>
<template>

    <div
        v-if="app.cropMode || plan.rotate !== 0 || plan.skipping || plan.isScaled || plan.notices || plan.length > 0 || (app.framesToSample > 0 && app.framesToSample < app.frameCount)"
        class="explanatory-messages w-full"
    >



        <Accordion
            class="w-full"
            multiple
        >
            <AccordionPanel
                value="-1"
                v-if="app.cropMode"
            >
                <AccordionHeader>
                    <div class="flex items-center gap-1 cursor-default">
                        <span class="material-symbols-outlined">crop</span>
                        <span>Cropping to {{ app.cropWidth }}×{{ app.cropHeight }}px</span>
                    </div>
                </AccordionHeader>
                <AccordionContent>
                    <p class="m-0 text-left">
                        Sampling a {{ app.cropWidth }}×{{ app.cropHeight }}px region
                        <span v-if="app.cropX > 0 || app.cropY > 0">
                            offset by {{ app.cropX }}px horizontally and {{ app.cropY }}px vertically
                        </span>
                        <span v-else>
                            from the top-left corner
                        </span>
                        of each frame.
                    </p>
                </AccordionContent>
            </AccordionPanel>
            <AccordionPanel
                value="0"
                v-if="plan.rotate !== 0"
            >
                <AccordionHeader>
                    <div class="flex items-center gap-1 cursor-default">
                        <span class="material-symbols-outlined">rotate_90_degrees_cw</span>
                        <span> Rotating samples by</span>
                        <span> {{ plan.rotate }}°</span>
                    </div>
                </AccordionHeader>
                <AccordionContent>
                    <p class="m-0 text-left	">
                        Sampled {{ app.samplingMode }} will be joined as {{ app.outputMode }}.
                    </p>
                </AccordionContent>
            </AccordionPanel>
            <AccordionPanel
                value="0.5"
                v-if="app.framesToSample > 0 && app.framesToSample < app.frameCount"
            >
                <AccordionHeader>
                    <div class="flex items-center gap-1 cursor-default">
                        <span class="material-symbols-outlined">filter_alt</span>
                        <span>Limiting to</span>
                        <span>{{ app.framesToSample.toLocaleString() }} of {{ app.frameCount.toLocaleString() }}
                            frames</span>
                    </div>
                </AccordionHeader>
                <AccordionContent>
                    <p class="m-0 text-left">
                        Sampling is limited to the first {{ app.framesToSample.toLocaleString() }} frames.
                        The remaining {{ (app.frameCount - app.framesToSample).toLocaleString() }} frames
                        ({{ Math.round((app.frameCount - app.framesToSample) / app.frameCount * 100) }}% of the video)
                        will not
                        be processed.
                    </p>
                </AccordionContent>
            </AccordionPanel>
            <AccordionPanel
                value="1"
                v-if="plan.skipping"
            >
                <AccordionHeader>
                    <div class="flex items-center gap-1 cursor-default">
                        <span class="material-symbols-outlined">step_over</span>
                        <span>Skipping</span>
                        <span> {{ plan.skipping }} frames</span>
                    </div>
                </AccordionHeader>
                <AccordionContent>
                    <p class="m-0 text-left">
                        {{ plan.length }} {{ app.tileProportion }} {{ plan.length == 1 ? 'tile' : 'tiles' }} at full
                        resolution
                        ({{ plan.width }}x{{ plan.height }}) {{ plan.length == 1 ? 'takes' : 'take' }} up {{
                            app.frameCount -
                            plan.skipping }} of {{
                            app.frameCount }}
                        possible sample {{ app.samplingMode }}. {{ plan.skipping }} {{ app.samplingMode }} from frames
                        {{ app.frameCount - plan.skipping + 1 }}-{{ app.frameCount }} do not form a full tile and will
                        be
                        skipped.
                    </p>
                </AccordionContent>
            </AccordionPanel>
            <AccordionPanel
                value="2"
                v-if="plan.isScaled"
            >
                <AccordionHeader>
                    <div
                        v-if="(plan.scaleTo !== plan.scaleFrom)"
                        class="flex items-center gap-1 cursor-default"
                    >
                        <span
                            v-if="(plan.scaleTo < plan.scaleFrom)"
                            class="material-symbols-outlined"
                        >close_fullscreen</span>
                        <span v-if="(plan.scaleTo < plan.scaleFrom)">Scaling down</span>
                        <span
                            v-if="(plan.scaleTo > plan.scaleFrom)"
                            class="material-symbols-outlined"
                        >open_in_full</span>
                        <span v-if="(plan.scaleTo > plan.scaleFrom)">Scaling up</span>

                        <span>to</span>
                        <span> {{ plan.scaleTo }}<span style="font-variant: small-caps;">px</span></span>



                    </div>
                </AccordionHeader>
                <AccordionContent>
                    <p class="m-0 text-left">
                        Scaling from {{ plan.scaleFrom }}px to {{ plan.scaleTo }}px
                        <span v-if="app.downsampleStrategy === 'upfront'">
                            via upfront frame downsampling for smoother results
                        </span>
                        <span v-if="app.downsampleStrategy === 'perSample'">
                            via fast per-sample downsampling
                        </span>.
                    </p>
                </AccordionContent>
            </AccordionPanel>

            <AccordionPanel
                value="2.5"
                v-if="plan.length > 0"
            >
                <AccordionHeader>
                    <div class="flex items-center gap-1 cursor-default">
                        <span class="material-symbols-outlined">grid_view</span>
                        <span>{{ plan.length }} {{ plan.length == 1 ? 'tile' : 'tiles' }}</span>
                        <span>of {{ plan.width }}×{{ plan.height }}px</span>
                    </div>
                </AccordionHeader>
                <AccordionContent>
                    <p class="m-0 text-left">
                        This video has sufficient data for {{ plan.length }} {{ plan.length == 1 ? 'tile' : 'tiles' }}.
                        <br /> {{ app.framesToSample.toLocaleString() }} frames ÷ {{ app.outputMode === 'rows' ?
                            plan.height : plan.width }}px per tile = {{ plan.length }}
                    </p>
                </AccordionContent>
            </AccordionPanel>

            <AccordionPanel
                value="3"
                v-if="plan.length == 0"
            >
                <AccordionHeader>
                    <div class="flex items-center gap-1 cursor-default">
                        <span class="material-symbols-outlined">warning</span>
                        <span>Insufficient frames</span>
                    </div>
                </AccordionHeader>
                <AccordionContent>
                    <p class="m-0 text-left">
                        {{ app.frameCount }} sampled {{ app.samplingMode }} is not adequate to fill a tile.
                    </p>
                </AccordionContent>
            </AccordionPanel>

            <AccordionPanel
                value="4"
                v-if="plan.notices?.length > 0"
            >
                <AccordionHeader>
                    <div class="flex items-center gap-1 cursor-default">
                        <span class="material-symbols-outlined">warning</span>
                        <span>Notices</span>
                    </div>
                </AccordionHeader>
                <AccordionContent>
                    <p
                        class="m-0 text-left"
                        v-for="notice in plan.notices"
                    >
                        {{ notice }}
                    </p>
                </AccordionContent>
            </AccordionPanel>

            <!-- if (plan.length == 0) {
                // if the calculated number of tiles is zero
                // we lack sufficient frames to fill the last tile
                plan.notices.push('Not enough frames to fill a tile')
            } -->


        </Accordion>
    </div>
</template>

<style scoped>
    .small-icon {
        font-size: 1.125rem;
    }

</style>