import { afterEach, describe, expect, it } from 'vitest';
import { createRenderer, createSSRApp, h, nextTick, ref, ssrContextKey } from 'vue';
import { renderToString } from 'vue/server-renderer';
import PrimeVue from 'primevue/config';
import { createPinia } from 'pinia';
import ExportVideoDialog from './ExportVideoDialog.vue';

// Exercise the actual setup/watchers without requiring browser encoder or DOM APIs.
const renderer = createRenderer({
    createComment: () => ({}),
    insert() {},
    remove() {},
    parentNode: () => null,
    nextSibling: () => null,
});

let app;
afterEach(() => app?.unmount());

async function mountWorkflow(initialSettings = null) {
    let form;
    let rememberedSettings;
    const visible = ref(true);
    const component = { ...ExportVideoDialog, render() { form = this.$.setupState; return null; } };
    app = renderer.createApp({
        setup: () => () => visible.value ? h(component, {
            visible: true,
            initialSettings: { ...rememberedSettings, ...initialSettings },
            exportInfo: { hasWebCodecs: true, modes: { ribbons: { seamlessLoopDuration: 5 } } },
            onSettingsChange: settings => { rememberedSettings = settings; },
            'onUpdate:visible': value => { visible.value = value; },
            onRequestCancel: () => { visible.value = false; },
        }) : null,
    });
    app.use(createPinia());
    app.provide(ssrContextKey, {});
    app.mount({});
    await nextTick();
    return {
        get form() { return form; },
        async reopen() { visible.value = true; await nextTick(); },
    };
}

describe('video export settings', () => {
    it('offers Publish after encoding without inline publication fields', async () => {
        const instance = createSSRApp(ExportVideoDialog, {
            visible: true, encodedFilename: 'loop.mp4', canPublish: true,
            exportInfo: { hasWebCodecs: true, modes: { ribbons: { seamlessLoopDuration: 5 } } },
        });
        instance.use(createPinia()).use(PrimeVue);
        const html = await renderToString(instance);
        expect(html).toContain('Publish');
        expect(html).not.toContain('publish-video-card');
        expect(html).not.toContain('publish-video-name');
        expect(html).not.toContain('publish-video-description');
        expect(html).not.toContain('Publish video publicly');
    });

    it('defaults to MP4 AV1 with hardware, QP and limited colour range', async () => {
        const workflow = await mountWorkflow();
        expect(workflow.form.formatSelection).toBe('mp4-av1');
        expect(workflow.form.formatOptions.find(option => option.value === 'mp4-av1').label).toBe('MP4 (AV1)');
        expect(workflow.form.getExportSettings()).toMatchObject({
            format: 'mp4', videoCodec: 'av1', encodingMethod: 'webcodecs',
            hardwareAcceleration: 'prefer-hardware', bitrateMode: 'quantizer', videoRange: 'limited',
        });
    });

    it.each(['handleCancel', 'handleClose'])('restores encoder choices after %s and reopening', async action => {
        const workflow = await mountWorkflow();
        Object.assign(workflow.form, {
            hardwareAcceleration: 'prefer-software', videoRange: 'full', yuvConversion: 'cpu',
            bitrateMode: 'quantizer', quantizer: 140, fps: 60,
            durationMode: 'custom', customDuration: 12, backgroundInterpolation: 'rife',
        });
        await nextTick();
        const settings = workflow.form.getExportSettings();
        workflow.form[action]();
        await nextTick();
        await workflow.reopen();
        expect(workflow.form.getExportSettings()).toEqual(settings);
    });

    it('restores an H.264 FFmpeg bitrate configuration instead of replacing it with defaults', async () => {
        const workflow = await mountWorkflow();
        Object.assign(workflow.form, {
            formatSelection: 'mp4', selectedEncodingMethod: 'ffmpeg',
            bitrateMode: 'variable', bitrateMbps: 24, encoderPreset: 'slow', cycleCount: 3,
        });
        await nextTick();
        const settings = workflow.form.getExportSettings();
        workflow.form.handleCancel();
        await nextTick();
        await workflow.reopen();
        expect(workflow.form.getExportSettings()).toEqual(settings);
        expect(workflow.form.getExportSettings()).toMatchObject({
            videoCodec: 'avc', encodingMethod: 'ffmpeg', bitrateMode: 'variable', bitrate: 24_000_000, encoderPreset: 'slow',
        });
    });
});
