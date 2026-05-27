const SLYCE_EXIT_CONFIRMATION_MESSAGE = 'Video processing is in progress. Leaving will cancel the current process and discard any results. Continue?';

import { isViewerPanelVisible } from './viewerPanels.js';

const DEFAULT_VIEWER_CONTEXT_ORDER = [
    'walk',
    'draw',
    'drawings',
    'realtimeSampler',
    'textureCreator',
    'texturePreview',
    'textureBrowser',
    'emoji',
    'text',
    'contour',
    'sineWave',
    'clock',
    'tools',
    'about',
];

function confirmSlyceExit(message) {
    if (typeof window === 'undefined' || typeof window.confirm !== 'function') {
        return true;
    }

    return window.confirm(message);
}

const VIEWER_CONTEXT_DEFINITIONS = {
    walk: {
        title: 'Walk',
        isActive: (app) => app.isWalkMode,
        close: (app) => {
            app.setWalkMode(false);
            return true;
        },
    },
    draw: {
        title: 'Draw',
        isActive: (app) => app.isDrawingMode,
        close: (app) => {
            app.setDrawingMode(false);
            return true;
        },
    },
    drawings: {
        title: 'Drawings',
        isActive: (app) => isViewerPanelVisible(app, 'drawings'),
        close: (app) => {
            app.hideDrawingBrowser();
            return true;
        },
    },
    realtimeSampler: {
        title: 'Create Texture',
        isActive: (app) => isViewerPanelVisible(app, 'realtimeSampler'),
        close: (_app, options) => {
            options.onCloseRealtimeMode();
            return true;
        },
    },
    textureCreator: {
        title: 'Create Texture',
        isActive: (app) => isViewerPanelVisible(app, 'textureCreator'),
        close: (app, options) => {
            if (options.isSlyceProcessing) {
                const confirmed = options.confirmSlyceExit(SLYCE_EXIT_CONFIRMATION_MESSAGE);
                if (!confirmed) {
                    return false;
                }

                options.onResetSlyceProcessing();
            }

            app.hideSlyce();
            return true;
        },
    },
    texturePreview: {
        title: 'Texture Preview',
        isActive: (app) => isViewerPanelVisible(app, 'texturePreview'),
        close: (app) => {
            app.hideTexturePreview();
            return true;
        },
    },
    textureBrowser: {
        title: 'Textures',
        isActive: (app) => isViewerPanelVisible(app, 'textureBrowser'),
        close: (app) => {
            app.hideTextureBrowser();
            return true;
        },
    },
    emoji: {
        title: 'Emoji',
        isActive: (app) => isViewerPanelVisible(app, 'emoji'),
        close: (app) => {
            app.hideEmojiPicker();
            return true;
        },
    },
    text: {
        title: 'Text',
        isActive: (app) => isViewerPanelVisible(app, 'text'),
        close: (app) => {
            app.hideTextPanel();
            return true;
        },
    },
    contour: {
        title: 'Contour',
        isActive: (app) => isViewerPanelVisible(app, 'contour'),
        close: (app) => {
            app.hideContourPanel();
            return true;
        },
    },
    sineWave: {
        title: 'Sine Wave',
        isActive: (app) => isViewerPanelVisible(app, 'sineWave'),
        close: (app) => {
            app.hideSineWavePanel();
            return true;
        },
    },
    clock: {
        title: 'Clock',
        isActive: (app) => isViewerPanelVisible(app, 'clock'),
        close: (app) => {
            app.hideClockPanel();
            return true;
        },
    },
    tools: {
        title: 'Tools',
        isActive: (app) => isViewerPanelVisible(app, 'tools'),
        close: (app) => {
            app.hideToolsPanel();
            return true;
        },
    },
    about: {
        title: 'About',
        isActive: (app) => isViewerPanelVisible(app, 'about'),
        close: (app) => {
            app.hideAboutPanel();
            return true;
        },
    },
};

export function createViewerContexts(app, options = {}) {
    const {
        order = DEFAULT_VIEWER_CONTEXT_ORDER,
        onCloseRealtimeMode = () => {},
        onResetSlyceProcessing = () => {},
        isSlyceProcessing = false,
        confirmSlyceExit: confirmExit = confirmSlyceExit,
    } = options;

    return order
        .map((id) => {
            const context = VIEWER_CONTEXT_DEFINITIONS[id];
            if (!context) {
                return null;
            }

            return {
                id,
                title: context.title,
                isActive: () => context.isActive(app),
                close: () => context.close(app, {
                    onCloseRealtimeMode,
                    onResetSlyceProcessing,
                    isSlyceProcessing,
                    confirmSlyceExit: confirmExit,
                }),
            };
        })
        .filter(Boolean);
}

export function resolveOrderedContext(contexts = []) {
    for (const context of contexts) {
        if (context.isActive()) {
            return {
                title: context.title,
                close: () => context.close(),
            };
        }
    }

    return null;
}

export function resolveViewerHeaderContext(app, options = {}) {
    const {
        panelTitle = null,
        toolbarOverlayTitle = null,
        onClosePanel = () => {},
        onCloseToolbarOverlay = () => {},
        ...contextOptions
    } = options;

    if (panelTitle) {
        return {
            title: panelTitle,
            close: () => onClosePanel(),
        };
    }

    if (toolbarOverlayTitle) {
        return {
            title: toolbarOverlayTitle,
            close: () => onCloseToolbarOverlay(),
        };
    }

    return resolveOrderedContext(createViewerContexts(app, contextOptions));
}