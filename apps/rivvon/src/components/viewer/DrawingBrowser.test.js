import { afterEach, describe, expect, it, vi } from 'vitest';
import { compile, createRenderer, h, nextTick, ref, ssrContextKey } from 'vue';
import { compileScript, parse } from 'vue/compiler-sfc';
import DrawingBrowser from './DrawingBrowser.vue';
import drawingBrowserSource from './DrawingBrowser.vue?raw';
import { createDrawingThumbnailDataUrl } from '../../modules/shared/drawingLibrary.js';

const { getAllDrawings } = vi.hoisted(() => ({ getAllDrawings: vi.fn() }));

// Node tests receive the SFC's SSR setup. Compile its client template for scroll updates.
const { descriptor } = parse(drawingBrowserSource);
const browserComponent = { ...DrawingBrowser, render: compile(descriptor.template.content, {
    prefixIdentifiers: true,
    bindingMetadata: compileScript(descriptor, { id: 'drawing-browser-test' }).bindings,
}) };

vi.mock('../../composables/shared/useGoogleAuth', async () => {
    const { ref } = await import('vue');
    return { useGoogleAuth: () => ({ user: ref(null), isAdmin: ref(false), isAuthenticated: ref(false) }) };
});
vi.mock('../../services/drawingStorage.js', () => ({ useDrawingStorage: () => ({ getAllDrawings }) }));
vi.mock('../../services/api.js', () => ({ useRivvonAPI: () => ({}) }));
vi.mock('../../modules/shared/drawingLibrary.js', { spy: true });
vi.mock('primevue/button', async () => {
    const { h } = await import('vue');
    return { default: { setup: (_, { slots }) => () => h('button', slots.default?.()) } };
});
vi.mock('primevue/scrollpanel', async () => {
    const { h, ref, renderSlot } = await import('vue');
    return { default: {
        setup(_, { slots }) {
            // Match ScrollPanel's reactive scroll state and slot rendering without a DOM.
            const scrollTop = ref(0);
            return () => h('section', {
                'data-scroll-top': scrollTop.value,
                onScroll: (event) => { scrollTop.value = event.target.scrollTop; },
            }, [renderSlot(slots, 'default')]);
        },
    } };
});

const node = (type, text = '') => ({ type, text, props: {}, children: [], parent: null });
const renderer = createRenderer({
    createElement: node,
    createText: (text) => node('text', text),
    createComment: (text) => node('comment', text),
    setText: (target, text) => { target.text = text; },
    setElementText: (target, text) => { target.text = text; target.children = []; },
    patchProp: (target, key, previous, value) => { target.props[key] = value; },
    insert(target, parent, anchor) {
        if (target.parent) target.parent.children.splice(target.parent.children.indexOf(target), 1);
        target.parent = parent;
        const index = anchor ? parent.children.indexOf(anchor) : -1;
        if (index < 0) parent.children.push(target);
        else parent.children.splice(index, 0, target);
    },
    remove(target) { target.parent?.children.splice(target.parent.children.indexOf(target), 1); },
    parentNode: (target) => target.parent,
    nextSibling: (target) => target.parent?.children[target.parent.children.indexOf(target) + 1] || null,
});

function findAll(root, type) {
    return [...(root.type === type ? [root] : []), ...root.children.flatMap((child) => findAll(child, type))];
}

let app;
let visible;
afterEach(() => { app?.unmount(); vi.clearAllMocks(); });

async function mountBrowser(drawings) {
    getAllDrawings.mockResolvedValue(drawings);
    const root = node('root');
    visible = ref(true);
    app = renderer.createApp({ setup: () => () => h(browserComponent, { visible: visible.value }) });
    app.provide(ssrContextKey, {});
    app.mount(root);
    await new Promise((resolve) => setImmediate(resolve));
    await nextTick();
    return root;
}

async function scroll(root) {
    const panel = findAll(root, 'section')[0];
    for (const scrollTop of [100, 200, 300]) {
        panel.props.onScroll({ target: { scrollTop } });
        await nextTick();
    }
}

function drawing(overrides = {}) {
    return {
        id: 'drawing', name: 'Example', kind: 'gesture', updated_at: 1,
        paths: [[{ x: 0, y: 0 }, { x: 1, y: 1 }]],
        ...overrides,
    };
}

describe('drawing browser thumbnail reuse', () => {
    it('uses saved inline and cloud thumbnails without rebuilding geometry during scroll', async () => {
        const root = await mountBrowser([
            drawing({ id: 'inline', thumbnail_data_url: 'data:image/svg+xml,saved', thumbnail_url: 'https://example.com/unused.svg' }),
            drawing({ id: 'remote', thumbnail_url: 'https://example.com/saved.svg' }),
        ]);
        await scroll(root);
        expect(findAll(root, 'img').map((image) => image.props.src)).toEqual([
            'data:image/svg+xml,saved', 'https://example.com/saved.svg',
        ]);
        expect(createDrawingThumbnailDataUrl).not.toHaveBeenCalled();
    });

    it('generates a missing preview once across scroll updates and tab switches', async () => {
        const root = await mountBrowser([drawing()]);
        const thumbnail = findAll(root, 'img')[0].props.src;
        expect(thumbnail).toMatch(/^data:image\/svg\+xml/);
        await scroll(root);
        const tabs = findAll(root, 'button').filter((button) => button.props.class?.includes('drawing-browser-tab'));
        tabs[1].props.onClick();
        await nextTick();
        tabs[0].props.onClick();
        await nextTick();
        await scroll(root);
        expect(findAll(root, 'img')[0].props.src).toBe(thumbnail);
        expect(createDrawingThumbnailDataUrl).toHaveBeenCalledOnce();
    });

    it('caches missing previews and generates a new SVG when geometry is replaced on reload', async () => {
        const root = await mountBrowser([drawing(), drawing({ id: 'empty', paths: [] }), drawing({ id: 'cloud-only', paths: null })]);
        const previousThumbnail = findAll(root, 'img')[0].props.src;
        await scroll(root);
        expect(createDrawingThumbnailDataUrl).toHaveBeenCalledTimes(2);
        getAllDrawings.mockResolvedValue([drawing({ paths: [[{ x: 0, y: 0 }, { x: 1, y: 0 }]] })]);
        visible.value = false;
        await nextTick();
        visible.value = true;
        await new Promise((resolve) => setImmediate(resolve));
        await nextTick();
        await scroll(root);
        expect(createDrawingThumbnailDataUrl).toHaveBeenCalledTimes(3);
        expect(findAll(root, 'img')[0].props.src).not.toBe(previousThumbnail);
    });
});
