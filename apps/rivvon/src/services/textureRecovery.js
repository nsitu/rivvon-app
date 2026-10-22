import { createTextureThumbnail } from '../modules/shared/textureThumbnail.js';

const tileIndex = tile => Number(tile.index ?? tile.tileIndex ?? tile.tile_index);
const shapeKeys = ['tile_resolution', 'tile_count', 'layer_count', 'cross_section_type'];
const API = import.meta.env.VITE_API_URL || 'https://api.rivvon.ca';

export async function getTextureRecoverySession() {
    const response = await fetch(`${API}/api/auth/me`, { credentials: 'include' });
    const session = await response.json().catch(() => ({}));
    if (!response.ok || !session.authenticated || !session.user?.id) {
        throw new Error('Sign in to Rivvon in this browser before restoring the texture. Chrome and the Codex browser have separate sessions.');
    }
    return session;
}

export function matchesRecoverySource(texture, local) {
    return Boolean(texture && local && (local.cached_from === texture.id || local.name === texture.name)
        && shapeKeys.every(key => String(local[key]) === String(texture[key])));
}

/** Restore only empty R2 files, retaining the texture ID used by saved presets. */
export async function restoreEmptyTextureTiles({ texture, localTexture, tiles, fetchTextureWithTiles,
    uploadTile, completeTextureSet, uploadThumbnail, onProgress }) {
    // Verify this browser's session before decoding hundreds of MB or writing files.
    const session = await getTextureRecoverySession();
    const remote = await fetchTextureWithTiles(texture.id);
    if (remote.owner_id && remote.owner_id !== session.user.id) {
        throw new Error('Sign in with the account that owns this texture before restoring its files.');
    }
    if (remote.storage_provider !== 'r2') throw new Error('Recovery currently supports Cloudflare R2 textures.');
    if (!matchesRecoverySource(remote, localTexture)) throw new Error('The local texture does not match the cloud texture’s name and dimensions.');
    const byIndex = new Map(tiles.map(tile => [tileIndex(tile), tile]));
    // Validate the entire source before changing any cloud file.
    for (let index = 0; index < remote.tile_count; index++) {
        const blob = byIndex.get(index)?.blob;
        if (!blob || blob.size < 104) throw new Error(`Local tile ${index + 1} is missing or empty. Choose an intact local copy.`);
        const header = new DataView(await blob.slice(0, 80).arrayBuffer());
        const magic = [0xAB, 0x4B, 0x54, 0x58, 0x20, 0x32, 0x30, 0xBB, 0x0D, 0x0A, 0x1A, 0x0A];
        if (!magic.every((byte, offset) => header.getUint8(offset) === byte)
            || header.getUint32(20, true) !== Number(remote.tile_resolution)
            || header.getUint32(24, true) !== Number(remote.tile_resolution)
            || (header.getUint32(32, true) || 1) !== Number(remote.layer_count)
            || !header.getUint32(40, true)) {
            throw new Error(`Local tile ${index + 1} has incompatible KTX2 metadata.`);
        }
    }
    const remoteTiles = new Map((remote.tiles || []).map(tile => [tileIndex(tile), tile]));
    const emptyIndices = [];
    for (let index = 0; index < remote.tile_count; index++) {
        const tile = remoteTiles.get(index);
        if (!tile?.url || tile.fileSize == null) throw new Error('Cloud tile metadata is incomplete; recovery cannot safely continue.');
        if (Number(tile.fileSize) > 0) continue;
        // Older servers do not enforce repairEmptyOnly. Confirm emptiness before upload too.
        const response = await fetch(tile.url, { cache: 'no-store' });
        if (!response.ok) throw new Error(`Unable to verify cloud tile ${index + 1}.`);
        if ((await response.blob()).size > 0) throw new Error(`Cloud tile ${index + 1} contains data. Recovery will not replace it.`);
        emptyIndices.push(index);
    }
    onProgress?.('Generating recovery thumbnail…');
    const thumbnail = await createTextureThumbnail([...byIndex.values()]);
    for (const [offset, index] of emptyIndices.entries()) {
        onProgress?.(`Restoring cloud tile ${offset + 1}/${emptyIndices.length}…`);
        await uploadTile(texture.id, index, byIndex.get(index).blob, { repairEmptyOnly: true });
    }
    // Completion validates every tile and refreshes sizes. Retrying resumes the same asset.
    await completeTextureSet(texture.id);
    const { thumbnailUrl } = await uploadThumbnail(texture.id, thumbnail);
    return { restoredCount: emptyIndices.length, thumbnailUrl, thumbnail };
}
