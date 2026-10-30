import { createFixture } from './background-loop-benchmark-browser.js';
import { useSlyceStore } from '../src/stores/slyceStore.js';
import { useBackgroundLoopStore } from '../src/stores/backgroundLoopStore.js';
import { Input, ALL_FORMATS, BlobSource, VideoSampleSink } from 'mediabunny';

const wait = async (condition, message, timeout = 30000) => {
    const start = performance.now();
    while (!condition()) {
        if (performance.now() - start > timeout) throw new Error(message);
        await new Promise(resolve => setTimeout(resolve, 25));
    }
};
const button = label => [...document.querySelectorAll('.texture-creator-panel button')].find(node => {
    if (!node.getClientRects().length) return false;
    const copy = node.cloneNode(true);
    for (const icon of copy.querySelectorAll('.material-symbols-outlined')) icon.remove();
    return copy.textContent.trim() === label;
});
const assert = (condition, message) => { if (!condition) throw new Error(message); };

export async function setup() {
    await wait(() => button('Background video'), 'Creator output choice did not mount.');
    button('Background video').click();
    const file = await createFixture({ width: 320, height: 180, frames: 320 });
    const input = document.querySelector('.texture-creator-panel #file-input');
    const files = new DataTransfer(); files.items.add(file); input.files = files.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    const loop = useBackgroundLoopStore();
    await wait(() => loop.source && !loop.busy, 'Source inspection did not complete.');
    for (const [id, value] of [['background-size', '256'], ['background-duration', String(31 / 30)]]) {
        const element = document.getElementById(id); element.value = value;
        element.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    }
    await wait(() => loop.plan?.size === 256 && loop.plan?.phaseCount === 31, 'Duration/size inputs did not update the sampling plan.');
    await wait(() => document.querySelector('.background-source-preview video')?.readyState >= 2, 'Source video preview did not load.');
    await wait(() => document.querySelector('.background-source-preview .sampling-overlay')?.dataset.samplingMode === 'rows', 'Long-side sampling preview did not appear.');
    assert(document.querySelector('[aria-label="Seek source video"]'), 'Source playback/seek controls are missing.');
    button('Short side (180 px)').click();
    await wait(() => loop.plan?.samplingMode === 'columns' && loop.size === 180, 'Short-side selection did not update the plan and size limit.');
    await wait(() => document.querySelector('.background-source-preview .sampling-overlay')?.dataset.samplingMode === 'columns', 'Sampling lines did not change to columns.');
    assert(loop.limits.maxPhases === 320, 'Short-side phase ceiling used the wrong dimension.');
    const sizeInput = document.getElementById('background-size'); sizeInput.value = '128';
    sizeInput.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    await wait(() => loop.plan?.size === 128, 'Short-side output size did not update.');
    const sourceVideo = document.querySelector('.background-source-preview video'); sourceVideo.pause();
    const startInput = document.getElementById('background-start'); startInput.value = '5';
    startInput.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    await wait(() => Math.abs(sourceVideo.currentTime - 4 / 30) < .02, 'The source preview did not seek to the chosen starting frame.');
    assert(loop.plan.batchSize === 16 && loop.plan.passes === 2, 'The integrated workflow did not use the new batch size.');
    return { sourceFileSelected: true, durationControl: true, batchSize: loop.plan.batchSize };
}

export async function run() {
    const loop = useBackgroundLoopStore(), slyce = useSlyceStore();
    const source = slyce.file;
    button('Generate Background').click();
    await wait(() => loop.resultReady && !loop.busy, 'Background generation failed: ' + loop.error, 60000);
    assert(Boolean(document.querySelector('.background-loop-preview')), 'The finished clip preview is missing.');
    assert(button('Save to Clips') && !button('Save to Clips').disabled, 'The private clip save action is missing.');
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(loop.blob) });
    let frames = 0;
    try {
        const track = await input.getPrimaryVideoTrack();
        for await (const sample of new VideoSampleSink(track).samples()) {
            try { assert(Math.abs(sample.timestamp - frames / 30) < .0001, 'An output frame timestamp is incorrect.'); frames++; }
            finally { sample.close(); }
        }
    } finally { input.dispose(); }
    assert(frames === 31, 'The partial final batch lost or duplicated frames.');
    assert(loop.job.plan.samplingSide === 'short' && loop.job.plan.samplingMode === 'columns', 'Generation lost the chosen sampling side.');
    button('Save to Clips').click();
    await wait(() => loop.savedClip && !loop.busy, 'Clip upload failed: ' + loop.error);
    assert(button('Open Clips'), 'The saved clip library action is missing.');
    assert(!button('Save to Clips'), 'The upload could be submitted twice.');
    // Return to settings and choose textures without selecting the source again.
    button('Back').click();
    await wait(() => button('Ribbon textures'), 'The output choice did not return.');
    button('Ribbon textures').click();
    await wait(() => slyce.fileInfo?.name && document.querySelector('#process-button-footer'), 'Ribbon configuration failed to mount.');
    assert(slyce.file === source && slyce.fileOutput === 'texture', 'Changing output replaced the selected source.');
    button('Background video').click();
    await wait(() => document.querySelector('#background-duration'), 'Background settings did not return.');
    assert(loop.resultReady, 'Switching between output types discarded the retained background.');
    assert(loop.samplingSide === 'short', 'Switching output types lost the selected sampling side.');
    return { sourceFileSelected: true, durationControl: true, defaultBatchSize: 16, decodedFrames: frames,
        savedClipId: loop.savedClip.id, sourceSharedWithTextures: true, retainedResult: true, samplingSide: loop.job.plan.samplingSide, sourcePreview: true,
        outputBytes: loop.blob.size, jobId: loop.job.id };
}

export async function recover() {
    await wait(() => button('Background video'), 'Creator did not reopen after reload.');
    button('Background video').click();
    await wait(() => button('Preview'), 'Stored video did not appear after reload.');
    button('Preview').click();
    const loop = useBackgroundLoopStore();
    await wait(() => loop.resultReady && !loop.busy, 'Stored video preview could not be recovered.');
    assert(!useSlyceStore().file, 'Recovery unexpectedly required a source file.');
    await wait(() => button('Open Clips'), 'Saved clip publication was not recovered.');
    await wait(() => document.querySelector('.background-loop-preview')?.readyState >= 2, 'Recovered video did not load a playable frame.');
    await wait(() => !document.querySelector('.loading-overlay'), 'Scene loading did not finish after recovery.', 60000);
    return { recoveryWithoutSource: true };
}

window.backgroundLoopWorkflow = { setup, run, recover };
