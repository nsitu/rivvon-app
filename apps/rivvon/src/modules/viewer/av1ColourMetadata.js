// Independent, bounds-checked inspection of AV1 low-overhead sequence headers.
// Syntax: https://aomediacodec.github.io/av1-spec/#sequence-header-obu-syntax
class Bits {
    constructor(data) { this.data = data; this.position = 0; }
    read(count = 1) {
        if (count > 32 || this.position + count > this.data.length * 8) throw new Error('Truncated AV1 sequence header.');
        let value = 0;
        for (let i = 0; i < count; i++, this.position++) value = value * 2 + ((this.data[this.position >> 3] >> (7 - (this.position & 7))) & 1);
        return value;
    }
    skip(count) { while (count > 0) { const n = Math.min(count, 32); this.read(n); count -= n; } }
    uvlc() { let zeros = 0; while (!this.read()) if (++zeros === 32) return 0xffffffff; return 2 ** zeros - 1 + this.read(zeros); }
}

export function inspectAv1SequenceHeader(payload) {
    const bits = new Bits(payload);
    const profile = bits.read(3);
    if (profile > 2) throw new Error('Unsupported AV1 sequence profile.');
    bits.read(); const reduced = bits.read();
    if (reduced) bits.read(5);
    else {
        let delayBits = 0;
        if (bits.read()) {
            bits.skip(64);
            if (bits.read()) bits.uvlc();
            if (bits.read()) { delayBits = bits.read(5) + 1; bits.skip(42); }
        }
        const initialDelay = bits.read(), points = bits.read(5) + 1;
        for (let i = 0; i < points; i++) {
            bits.read(12); if (bits.read(5) > 7) bits.read();
            if (delayBits && bits.read()) bits.skip(delayBits * 2 + 1);
            if (initialDelay && bits.read()) bits.read(4);
        }
    }
    const widthBits = bits.read(4) + 1, heightBits = bits.read(4) + 1;
    const width = bits.read(widthBits) + 1, height = bits.read(heightBits) + 1;
    if (!reduced && bits.read()) bits.skip(7);
    bits.skip(3);
    if (!reduced) {
        bits.skip(4); const orderHint = bits.read();
        if (orderHint) bits.skip(2);
        const screenContent = bits.read() ? 2 : bits.read();
        if (screenContent > 0 && !bits.read()) bits.read();
        if (orderHint) bits.read(3);
    }
    bits.skip(3);
    const highBitdepth = bits.read();
    const bitDepth = profile === 2 && highBitdepth ? (bits.read() ? 12 : 10) : highBitdepth ? 10 : 8;
    const monochrome = profile === 1 ? false : Boolean(bits.read());
    let primaries = 2, transfer = 2, matrix = 2;
    if (bits.read()) { primaries = bits.read(8); transfer = bits.read(8); matrix = bits.read(8); }
    let fullRange, subX = 1, subY = 1;
    if (monochrome) fullRange = Boolean(bits.read());
    else if (primaries === 1 && transfer === 13 && matrix === 0) { fullRange = true; subX = subY = 0; }
    else {
        fullRange = Boolean(bits.read());
        if (profile === 1) subX = subY = 0;
        else if (profile === 2) {
            if (bitDepth === 12) { subX = bits.read(); subY = subX ? bits.read() : 0; }
            else subY = 0;
        }
        if (subX && subY) bits.read(2);
    }
    return { profile, width, height, primaries, transfer, matrix, fullRange,
        chromaFormat: monochrome ? 0 : subX && subY ? 1 : subX ? 2 : 3, bitDepthLuma: bitDepth, bitDepthChroma: bitDepth };
}

export function inspectAv1ColourObus(data) {
    const headers = [];
    for (let cursor = 0; cursor < data.length;) {
        const header = data[cursor++], type = (header >> 3) & 15;
        if (header & 0x81 || !(header & 2)) throw new Error('Invalid AV1 low-overhead OBU header.');
        if (header & 4) {
            if (cursor >= data.length || (data[cursor++] & 7)) throw new Error('Invalid AV1 OBU extension.');
        }
        let size = 0, terminated = false;
        for (let i = 0; i < 8; i++) {
            if (cursor >= data.length) throw new Error('Truncated AV1 OBU size.');
            const byte = data[cursor++]; size += (byte & 127) * 2 ** (i * 7);
            if (!(byte & 128)) { terminated = true; break; }
        }
        if (!terminated || !Number.isSafeInteger(size) || cursor + size > data.length) throw new Error('Invalid AV1 OBU size.');
        if (type === 1) headers.push(inspectAv1SequenceHeader(data.subarray(cursor, cursor + size)));
        cursor += size;
    }
    return headers;
}
