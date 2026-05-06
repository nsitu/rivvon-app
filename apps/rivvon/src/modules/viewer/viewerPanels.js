export const VIEWER_PANEL_KEYS = Object.freeze({
    text: 'textPanelVisible',
    textureBrowser: 'textureBrowserVisible',
    texturePreview: 'texturePreviewVisible',
    drawings: 'drawingBrowserVisible',
    textureCreator: 'textureCreatorVisible',
    realtimeSampler: 'realtimeSamplerVisible',
    tools: 'toolsPanelVisible',
    emoji: 'emojiPickerVisible',
    contour: 'contourPanelVisible',
    about: 'aboutPanelVisible',
});

export function createViewerPanelVisibilityState() {
    return Object.fromEntries(
        Object.values(VIEWER_PANEL_KEYS).map((stateKey) => [stateKey, false])
    );
}

export function isViewerPanelVisible(app, panelId) {
    const stateKey = VIEWER_PANEL_KEYS[panelId];
    return stateKey ? Boolean(app[stateKey]) : false;
}