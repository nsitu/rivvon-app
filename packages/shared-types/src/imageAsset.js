export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 40 * 1000 * 1000;
export const MAX_IMAGE_SIDE = 4096;
export const MAX_THUMBNAIL_SIDE = 512;
export const MAX_THUMBNAIL_BYTES = 1024 * 1024;
export const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const BUILTIN_BACKGROUND_IDS = ['card', 'textile', 'cenote'];

export function normalizeBackgroundSource(value, legacy = 'card') {
    if (value == null) return { kind: 'builtin', id: BUILTIN_BACKGROUND_IDS.includes(legacy) ? legacy : 'card' };
    if (!value || !['builtin', 'image'].includes(value.kind) || typeof value.id !== 'string'
        || !/^[\w-]{1,64}$/.test(value.id) || (value.kind === 'builtin' && !BUILTIN_BACKGROUND_IDS.includes(value.id))) {
        throw new Error('Invalid background image reference');
    }
    return { kind: value.kind, id: value.id };
}

// Read the raster container before decoding. Shared by upload validation and the
// browser so dimensions/animation limits are enforced before allocating pixels.
export function inspectImage(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const ascii = (offset, count) => String.fromCharCode(...bytes.subarray(offset, offset + count));
    let mimeType, width, height;
    if (bytes.length >= 33 && ascii(0, 8) === '\x89PNG\r\n\x1a\n' && ascii(12, 4) === 'IHDR') {
        mimeType = 'image/png'; width = view.getUint32(16); height = view.getUint32(20);
        let end = false;
        for (let offset = 8; offset + 12 <= bytes.length;) {
            const length = view.getUint32(offset), type = ascii(offset + 4, 4);
            if (offset + length + 12 > bytes.length) throw new Error('Truncated PNG image');
            if (type === 'acTL') throw new Error('Animated images are not supported');
            if (type === 'IEND') { end = true; break; }
            offset += length + 12;
        }
        if (!end) throw new Error('Truncated PNG image');
    } else if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
        mimeType = 'image/webp';
        if (view.getUint32(4, true) + 8 !== bytes.length) throw new Error('Truncated WebP image');
        for (let offset = 12; offset + 8 <= bytes.length;) {
            const type = ascii(offset, 4), size = view.getUint32(offset + 4, true), start = offset + 8;
            if (start + size > bytes.length) throw new Error('Truncated WebP image');
            if (type === 'ANIM' || type === 'ANMF' || (type === 'VP8X' && (bytes[start] & 2))) throw new Error('Animated images are not supported');
            if (type === 'VP8X' && size >= 10) {
                width = 1 + bytes[start + 4] + (bytes[start + 5] << 8) + (bytes[start + 6] << 16);
                height = 1 + bytes[start + 7] + (bytes[start + 8] << 8) + (bytes[start + 9] << 16);
            } else if (type === 'VP8 ' && size >= 10 && ascii(start + 3, 3) === '\x9d\x01\x2a') {
                width ??= view.getUint16(start + 6, true) & 0x3fff; height ??= view.getUint16(start + 8, true) & 0x3fff;
            } else if (type === 'VP8L' && size >= 5 && bytes[start] === 0x2f) {
                const bits = view.getUint32(start + 1, true);
                width ??= (bits & 0x3fff) + 1; height ??= ((bits >>> 14) & 0x3fff) + 1;
            }
            offset = start + size + (size % 2);
        }
    } else if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8
        && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9) {
        mimeType = 'image/jpeg';
        for (let offset = 2; offset + 4 <= bytes.length;) {
            if (bytes[offset++] !== 0xff) throw new Error('Invalid JPEG image');
            while (bytes[offset] === 0xff) offset++;
            const marker = bytes[offset++];
            if (marker === 0xda || marker === 0xd9) break;
            if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
            if (offset + 2 > bytes.length) break;
            const size = view.getUint16(offset);
            if (size < 2 || offset + size > bytes.length) throw new Error('Truncated JPEG image');
            if ([0xc0, 0xc1, 0xc2].includes(marker) && size >= 8) {
                height = view.getUint16(offset + 3); width = view.getUint16(offset + 5);
            }
            offset += size;
        }
    }
    if (!mimeType || !width || !height || width * height > MAX_IMAGE_PIXELS) {
        throw new Error('Choose a valid JPEG, PNG, or static WebP image of at most 40 megapixels');
    }
    return { mimeType, width, height };
}
