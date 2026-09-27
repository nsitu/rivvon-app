/**
 * Video file types accepted by the texture creator.
 *
 * Some operating systems report Sony AVCHD .mts files with an empty or
 * generic MIME type, so extension matching is needed in addition to the
 * browser's video/* MIME check.
 */
export const VIDEO_FILE_ACCEPT = 'video/*,.mts';

export function isTransportStreamFile(file) {
    if (!file) {
        return false;
    }

    const type = typeof file.type === 'string' ? file.type.toLowerCase() : '';
    if (type === 'video/mp2t') {
        return true;
    }

    return typeof file.name === 'string' && /\.(?:mts|m2ts)$/i.test(file.name.trim());
}

export function isVideoFile(file) {
    if (!file) {
        return false;
    }

    if (typeof file.type === 'string' && file.type.toLowerCase().startsWith('video/')) {
        return true;
    }

    return typeof file.name === 'string' && /\.mts$/i.test(file.name.trim());
}
