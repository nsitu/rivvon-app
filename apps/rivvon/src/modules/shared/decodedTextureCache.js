const MAX_TEXTURE_SET_ENTRIES = 2;

const decodedTextureSets = new Map();
let accessSequence = 0;

function buildEntryKey(textureSetId, rendererType) {
    if (!textureSetId) {
        return null;
    }

    return `${rendererType || 'unknown'}:${String(textureSetId)}`;
}

function disposeTexture(texture) {
    texture?.dispose?.();
}

function disposeEntry(entry) {
    if (!entry?.tiles) {
        return;
    }

    entry.tiles.forEach((texture) => {
        disposeTexture(texture);
    });
    entry.tiles.clear();
}

function cloneTexture(texture) {
    if (!texture?.clone) {
        return null;
    }

    const clone = texture.clone();
    clone.needsUpdate = true;
    return clone;
}

function pruneOldEntries() {
    while (decodedTextureSets.size > MAX_TEXTURE_SET_ENTRIES) {
        let oldestKey = null;
        let oldestAccess = Number.POSITIVE_INFINITY;

        decodedTextureSets.forEach((entry, key) => {
            const accessedAt = Number(entry?.accessedAt || 0);
            if (accessedAt < oldestAccess) {
                oldestAccess = accessedAt;
                oldestKey = key;
            }
        });

        if (!oldestKey) {
            break;
        }

        const oldestEntry = decodedTextureSets.get(oldestKey);
        disposeEntry(oldestEntry);
        decodedTextureSets.delete(oldestKey);
    }
}

export function rememberDecodedTexture(textureSetId, rendererType, tileIndex, texture) {
    const entryKey = buildEntryKey(textureSetId, rendererType);
    if (!entryKey || !texture) {
        return null;
    }

    const templateTexture = cloneTexture(texture);
    if (!templateTexture) {
        return null;
    }

    let entry = decodedTextureSets.get(entryKey);
    if (!entry) {
        entry = {
            accessedAt: 0,
            tiles: new Map(),
        };
        decodedTextureSets.set(entryKey, entry);
    }

    const tileKey = String(tileIndex);
    const previousTexture = entry.tiles.get(tileKey);
    if (previousTexture) {
        disposeTexture(previousTexture);
    }

    entry.tiles.set(tileKey, templateTexture);
    entry.accessedAt = ++accessSequence;
    pruneOldEntries();
    return templateTexture;
}

export function getClonedDecodedTexture(textureSetId, rendererType, tileIndex) {
    const entryKey = buildEntryKey(textureSetId, rendererType);
    if (!entryKey) {
        return null;
    }

    const entry = decodedTextureSets.get(entryKey);
    if (!entry) {
        return null;
    }

    const templateTexture = entry.tiles.get(String(tileIndex));
    if (!templateTexture) {
        return null;
    }

    entry.accessedAt = ++accessSequence;
    return cloneTexture(templateTexture);
}

export function evictDecodedTextureSet(textureSetId, rendererType = null) {
    if (!textureSetId) {
        return;
    }

    const prefixes = rendererType
        ? [`${rendererType}:${String(textureSetId)}`]
        : [`webgl:${String(textureSetId)}`, `webgpu:${String(textureSetId)}`];

    prefixes.forEach((entryKey) => {
        const entry = decodedTextureSets.get(entryKey);
        if (!entry) {
            return;
        }

        disposeEntry(entry);
        decodedTextureSets.delete(entryKey);
    });
}

export function clearDecodedTextureCache() {
    decodedTextureSets.forEach((entry) => {
        disposeEntry(entry);
    });
    decodedTextureSets.clear();
}