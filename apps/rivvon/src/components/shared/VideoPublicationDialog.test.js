import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRenderer, createSSRApp, h, nextTick, reactive, ssrContextKey } from 'vue';
import { renderToString } from 'vue/server-renderer';
import PrimeVue from 'primevue/config';
import VideoPublicationDialog from './VideoPublicationDialog.vue';

// Render the teleported dialog inline so its form is inspectable in Node.
vi.mock('primevue/dialog', async () => {
    const { h } = await import('vue');
    return { default: {
        props: ['visible', 'header'],
        setup: (props, { slots }) => () => props.visible
            ? h('section', [h('h2', props.header), slots.default?.(), slots.footer?.()]) : null,
    } };
});

const renderer = createRenderer({
    createComment: () => ({}), insert() {}, remove() {}, parentNode: () => null, nextSibling: () => null,
});
let app;
afterEach(() => app?.unmount());

const videoProps = () => ({
    visible: true, draft: true, file: new Blob(['video'], { type: 'video/mp4' }), filename: 'loop.mp4',
    metadata: { width: 1920, height: 1080, duration: 12 }, initialName: 'loop',
});

async function mountForm() {
    let form;
    const submit = vi.fn();
    const close = vi.fn();
    const props = reactive(videoProps());
    const component = { ...VideoPublicationDialog, render() { form = this.$.setupState; return null; } };
    app = renderer.createApp({ setup: () => () => h(component, { ...props, onSubmit: submit, 'onUpdate:visible': close }) });
    app.provide(ssrContextKey, {});
    app.mount({});
    await nextTick();
    return { form, props, submit, close };
}

describe('shared video publication dialog', () => {
    it.each([true, false])('renders the publication form with draft=%s', async draft => {
        const instance = createSSRApp(VideoPublicationDialog, { ...videoProps(), draft });
        instance.use(PrimeVue);
        const html = await renderToString(instance);
        expect(html).toContain(draft ? 'Publish draft' : 'Upload video');
        expect(html).toContain('Title</label>');
        expect(html).toContain('Description</label>');
        expect(html).toContain('Public Gallery');
        expect(html).toContain('loop.mp4');
        expect(html).toContain('1920×1080 · 0:12');
        expect(html.includes('type="file"')).toBe(!draft);
    });

    it('submits title, description and visibility only after confirmation', async () => {
        const { form, submit } = await mountForm();
        Object.assign(form, { name: '  My loop  ', description: 'A rendered loop', isPublic: false });
        expect(submit).not.toHaveBeenCalled();
        form.submit();
        expect(submit).toHaveBeenCalledExactlyOnceWith({ name: 'My loop', description: 'A rendered loop', isPublic: false });
    });

    it('blocks duplicate submissions and dismissal while uploading, then preserves details for retry', async () => {
        const { form, props, submit, close } = await mountForm();
        Object.assign(form, { name: 'Custom title', description: 'Keep this description', isPublic: false });
        props.isUploading = true;
        await nextTick();
        form.submit();
        form.close();
        expect(submit).not.toHaveBeenCalled();
        expect(close).not.toHaveBeenCalled();
        props.isUploading = false;
        props.error = 'Upload failed';
        await nextTick();
        form.submit();
        expect(submit).toHaveBeenCalledWith({ name: 'Custom title', description: 'Keep this description', isPublic: false });
        form.close();
        expect(close).toHaveBeenCalledWith(false);
    });

    it('starts a fresh form when reopened and updates the title when a file is selected', async () => {
        const { form, props } = await mountForm();
        Object.assign(form, { name: 'Old title', description: 'Old description', isPublic: false });
        props.visible = false;
        await nextTick();
        props.initialName = 'next-loop';
        props.visible = true;
        await nextTick();
        expect(form.name).toBe('next-loop');
        expect(form.description).toBe('');
        expect(form.isPublic).toBe(true);
        props.initialName = 'selected-file';
        await nextTick();
        expect(form.name).toBe('selected-file');
    });

    it('requires a title, video and metadata before publishing', async () => {
        const { form, props, submit } = await mountForm();
        form.name = '   ';
        form.submit();
        form.name = 'Loop';
        props.file = null;
        await nextTick();
        form.submit();
        props.file = videoProps().file;
        props.metadata = null;
        await nextTick();
        form.submit();
        expect(submit).not.toHaveBeenCalled();
    });
});
