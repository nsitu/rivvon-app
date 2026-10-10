<script setup>
import { computed } from 'vue';
import Button from 'primevue/button';
import Message from 'primevue/message';
import { describeColour, describeColourEntries, exportEnvironmentLabel } from '../../modules/viewer/exportColourReport.js';

const props = defineProps({ report: { type: Object, required: true }, filename: { type: String, default: 'rivvon-export.mp4' } });
const matching = computed(() => props.report.verification?.matchesSdrTarget);
const rows = computed(() => [
    ['Encoding method', props.report.encodingMethod === 'ffmpeg' ? 'FFmpeg WASM / x264' : 'WebCodecs / browser encoder'],
    ...(props.report.format === 'mp4' ? [
        ['MP4 container', describeColourEntries(props.report.container)],
        ['H.264 bitstream', describeColourEntries(props.report.sps)],
        ['Container / bitstream', props.report.verification?.containerAndBitstream ?? 'incomplete'],
        ...(props.report.spsRepair ? [['SPS repair', props.report.spsRepair.status === 'added'
            ? 'Missing declarations added; encoded pixels unchanged'
            : props.report.spsRepair.status === 'not-needed' ? 'Already declared; no repair needed' : `Skipped: ${props.report.spsRepair.reason}`]] : []),
    ] : [['Encoder output', describeColour(props.report.decoderConfig?.colorSpace)]]),
    ['Environment', exportEnvironmentLabel(props.report.environment)],
]);
function downloadReport() {
    const blob = new Blob([JSON.stringify(props.report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url;
    link.download = props.filename.replace(/\.[^.]+$/, '') + '-colour-report.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
}
</script>

<template>
    <section class="colour-report" aria-label="Export colour report">
        <h3>Colour report</h3>
        <Message :severity="matching ? 'success' : 'warn'" :closable="false">
            {{ matching ? 'BT.709 limited-range colour declarations verified.' : 'Colour declarations differ from the SDR target or are incomplete.' }}
        </Message>
        <dl>
            <template v-for="[label, value] in rows" :key="label">
                <dt>{{ label }}</dt><dd>{{ value }}</dd>
            </template>
        </dl>
        <p class="field-description">
            {{ report.encodingMethod === 'ffmpeg'
                ? 'Pixels were explicitly converted to BT.709 limited-range 8-bit 4:2:0 before encoding.'
                : 'Pixel conversion is managed by the browser. Matching colour tags alone cannot verify the conversion.' }}
        </p>
        <ul v-if="report.verification?.warnings?.length" class="field-description">
            <li v-for="warning in report.verification.warnings" :key="warning">{{ warning }}</li>
        </ul>
        <Button label="Download colour report" variant="outlined" @click="downloadReport" />
    </section>
</template>

<style scoped>
.colour-report { display: grid; gap: 0.75rem; color: var(--p-text-color); }
.colour-report h3, .colour-report p, .colour-report dl { margin: 0; }
.colour-report dl { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); gap: 0.5rem 1rem; }
.colour-report dt { font-weight: 600; }
.colour-report dd { margin: 0; overflow-wrap: anywhere; }
.field-description { font-size: 0.85rem; color: var(--p-text-muted-color); }
@media (max-width: 480px) { .colour-report dl { grid-template-columns: minmax(0, 1fr); } }
</style>
