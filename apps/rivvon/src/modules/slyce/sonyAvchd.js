import { EncodedPacketSink } from 'mediabunny';

const unsupported = () => new Error('This interlaced video is not supported. Use Sony A7 1920×1080, 59.94i, top-field-first, 8-bit AVCHD.');

class Bits {
    constructor(bytes) {
        this.bytes = bytes.filter((value, i) => !(value === 3 && i >= 2 && bytes[i - 1] === 0 && bytes[i - 2] === 0));
        this.pos = 0;
    }
    read(count = 1) {
        if (this.pos + count > this.bytes.length * 8 || count > 32) throw new Error('Truncated H.264 header.');
        let value = 0;
        for (let i = 0; i < count; i++, this.pos++) value = value * 2 + ((this.bytes[this.pos >> 3] >> (7 - (this.pos & 7))) & 1);
        return value;
    }
    ue() {
        let zeros = 0;
        while (!this.read()) if (++zeros > 30) throw new Error('Invalid H.264 header.');
        return 2 ** zeros - 1 + this.read(zeros);
    }
    se() { const n = this.ue(); return n & 1 ? (n + 1) / 2 : -n / 2; }
}

export function* annexBNalus(data) {
    let start = -1;
    for (let i = 0; i < data.length - 2; i++) {
        if (data[i] !== 0 || data[i + 1] !== 0) continue;
        const length = data[i + 2] === 1 ? 3 : data[i + 2] === 0 && data[i + 3] === 1 ? 4 : 0;
        if (!length) continue;
        if (start >= 0) yield data.subarray(start, i);
        start = i + length;
        i = start - 1;
    }
    if (start >= 0) yield data.subarray(start);
}

export function parseAvchdSps(nalu) {
    const b = new Bits(nalu.subarray(1));
    const profile = b.read(8);
    b.read(8);
    const level = b.read(8), id = b.ue();
    let chroma = 1, separate = 0, lumaDepth = 8, chromaDepth = 8;
    if ([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135].includes(profile)) {
        chroma = b.ue();
        if (chroma === 3) separate = b.read();
        lumaDepth += b.ue(); chromaDepth += b.ue(); b.read();
        if (b.read()) {
            for (let i = 0; i < (chroma === 3 ? 12 : 8); i++) {
                if (!b.read()) continue;
                let last = 8, next = 8;
                for (let j = 0; j < (i < 6 ? 16 : 64); j++) {
                    if (next) next = (last + b.se() + 256) % 256;
                    last = next || last;
                }
            }
        }
    }
    const frameNumBits = b.ue() + 4;
    const pocType = b.ue();
    if (pocType === 0) b.ue();
    else if (pocType === 1) {
        b.read(); b.se(); b.se();
        const cycle = b.ue();
        if (cycle > 255) throw unsupported();
        for (let i = 0; i < cycle; i++) b.se();
    }
    b.ue(); b.read();
    const mbsWide = b.ue() + 1, mapUnitsHigh = b.ue() + 1;
    const frameOnly = b.read();
    if (!frameOnly) b.read();
    b.read();
    let left = 0, right = 0, top = 0, bottom = 0;
    if (b.read()) { left = b.ue(); right = b.ue(); top = b.ue(); bottom = b.ue(); }
    const arrayType = separate ? 0 : chroma;
    const cropX = arrayType === 1 || arrayType === 2 ? 2 : 1;
    const cropY = (arrayType === 1 ? 2 : 1) * (2 - frameOnly);
    return {
        id, profile, level, chroma, separate, lumaDepth, chromaDepth, frameNumBits, frameOnly,
        width: mbsWide * 16 - cropX * (left + right),
        height: mapUnitsHigh * 16 * (2 - frameOnly) - cropY * (top + bottom),
    };
}

/** Inspect actual field pictures, not the extension, camera name, or packet count alone. */
export async function inspectSonyAvchd(track) {
    const config = await track.getDecoderConfig();
    if (!config?.codec?.startsWith('avc1.') || config.description) return null;
    const sps = new Map(), pps = new Map();
    const timestamps = [];
    let top = null, interlaced = false, progressive = false;
    for await (const packet of new EncodedPacketSink(track).packets()) {
        let picture = null;
        for (const nal of annexBNalus(packet.data)) {
            const type = nal[0] & 31;
            if (type === 7) {
                const sequence = parseAvchdSps(nal);
                sps.set(sequence.id, sequence);
                if (!sequence.frameOnly) {
                    interlaced = true;
                    if (sequence.profile !== 100 || sequence.level !== 40 || sequence.chroma !== 1 || sequence.separate
                        || sequence.lumaDepth !== 8 || sequence.chromaDepth !== 8 || sequence.width !== 1920 || sequence.height !== 1080) throw unsupported();
                }
            } else if (type === 8) {
                const bits = new Bits(nal.subarray(1));
                pps.set(bits.ue(), bits.ue());
            } else if (type === 1 || type === 5) {
                const bits = new Bits(nal.subarray(1));
                bits.ue(); bits.ue();
                const sequence = sps.get(pps.get(bits.ue()));
                if (!sequence) throw new Error('Missing AVCHD parameter sets.');
                const frameNum = bits.read(sequence.frameNumBits);
                const isField = !sequence.frameOnly && bits.read();
                if (!isField) { progressive = true; continue; }
                const bottom = bits.read();
                if (picture && (picture.bottom !== bottom || picture.frameNum !== frameNum)) throw unsupported();
                picture = { bottom, frameNum, timestamp: packet.timestamp };
            }
        }
        // Progressive transport streams keep the existing remux path.
        if (!interlaced && progressive) return null;
        if (!picture) continue;
        if (!top) {
            if (picture.bottom) throw unsupported();
            top = picture;
        } else {
            if (!picture.bottom || picture.frameNum !== top.frameNum || Math.abs(picture.timestamp - top.timestamp) > 0.000025) throw unsupported();
            timestamps.push(top.timestamp);
            top = null;
        }
    }
    if (!interlaced) return null;
    if (progressive || top || !timestamps.length) throw unsupported();
    timestamps.sort((a, b) => a - b);
    const frameDuration = 1001 / 30000;
    for (let i = 1; i < timestamps.length; i++) {
        if (Math.abs(timestamps[i] - timestamps[0] - i * frameDuration) > 0.0001) throw unsupported();
    }
    return {
        kind: 'sony-avchd-1080i60', width: 1920, height: 1080,
        origin: timestamps[0], frameDuration, fieldDuration: frameDuration / 2,
        decodedFrameCount: timestamps.length, frameCount: timestamps.length * 2,
        duration: timestamps.length * frameDuration,
    };
}
