export const RENDER_SNAPSHOT_VERSION = 1;

function cloneSerializable(value, fallback = null) {
    if (value === undefined) {
        return fallback;
    }

    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        return fallback;
    }
}

/**
 * Create the versioned, render-affecting portion of a video publication.
 * Geometry is deliberately kept in the saved-drawing payload rather than
 * duplicated here; `source` identifies the payload that belongs to it.
 */
export function createRenderSnapshot({
    source = null,
    textures = [],
    viewerSettings = {},
    camera = null,
    exportSettings = {},
    shareState = null,
} = {}) {
    return {
        schemaVersion: RENDER_SNAPSHOT_VERSION,
        source: cloneSerializable(source),
        textures: cloneSerializable(textures, []),
        viewerSettings: cloneSerializable(viewerSettings, {}),
        camera: cloneSerializable(camera),
        export: cloneSerializable(exportSettings, {}),
        share: cloneSerializable(shareState),
    };
}

export function parseRenderSnapshot(value) {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const schemaVersion = Number(value.schemaVersion);
    if (schemaVersion !== RENDER_SNAPSHOT_VERSION) {
        return null;
    }

    return createRenderSnapshot({
        source: value.source,
        textures: value.textures,
        viewerSettings: value.viewerSettings,
        camera: value.camera,
        exportSettings: value.export,
        shareState: value.share,
    });
}
