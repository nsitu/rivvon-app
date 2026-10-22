/** Structural checks before accepting a tile; decoding remains a client concern. */
export function isValidKtx2Tile(buffer: ArrayBuffer): boolean {
    if (buffer.byteLength < 104) return false;
    const signature = [0xAB, 0x4B, 0x54, 0x58, 0x20, 0x32, 0x30, 0xBB, 0x0D, 0x0A, 0x1A, 0x0A];
    const bytes = new Uint8Array(buffer);
    if (!signature.every((byte, index) => bytes[index] === byte)) return false;
    const header = new DataView(buffer);
    const levels = header.getUint32(40, true);
    if (!header.getUint32(20, true) || !header.getUint32(24, true) || !levels || 80 + levels * 24 > buffer.byteLength) return false;
    for (let level = 0; level < levels; level++) {
        const offset = Number(header.getBigUint64(80 + level * 24, true));
        const length = Number(header.getBigUint64(88 + level * 24, true));
        if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 80 + levels * 24 || length <= 0 || offset + length > buffer.byteLength) return false;
    }
    return true;
}
