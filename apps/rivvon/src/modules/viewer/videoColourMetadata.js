// Small independent, bounds-checked parser. No dependence on encoder metadata.
class Bits {
    constructor(data) { this.data = data; this.position = 0; }
    read(n = 1) {
        if (n > 32 || this.position + n > this.data.length * 8) throw new Error('Truncated SPS.');
        let value = 0;
        for (let i = 0; i < n; i++, this.position++) value = value * 2 + ((this.data[this.position >> 3] >> (7 - (this.position & 7))) & 1);
        return value;
    }
    ue() {
        let zeros = 0;
        while (!this.read()) if (++zeros > 30) throw new Error('Invalid SPS code.');
        return 2 ** zeros - 1 + this.read(zeros);
    }
    se() { const v = this.ue(); return v & 1 ? (v + 1) / 2 : -v / 2; }
}

export function inspectSps(nal) {
    if ((nal[0] & 31) !== 7) throw new Error('Expected H.264 SPS.');
    const rbsp = [];
    for (let i = 1; i < nal.length; i++) {
        if (i > 2 && nal[i] === 3 && nal[i - 1] === 0 && nal[i - 2] === 0) continue;
        rbsp.push(nal[i]);
    }
    const bits = new Bits(rbsp);
    const profile = bits.read(8);
    bits.read(8); const level = bits.read(8); bits.ue();
    let chromaFormat = 1, bitDepthLuma = 8, bitDepthChroma = 8;
    if ([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135].includes(profile)) {
        chromaFormat = bits.ue();
        if (chromaFormat === 3) bits.read();
        bitDepthLuma += bits.ue(); bitDepthChroma += bits.ue(); bits.read();
        if (bits.read()) {
            for (let i = 0; i < (chromaFormat === 3 ? 12 : 8); i++) {
                if (!bits.read()) continue;
                let last = 8, next = 8;
                for (let j = 0; j < (i < 6 ? 16 : 64); j++) {
                    if (next !== 0) next = (last + bits.se() + 256) % 256;
                    if (next !== 0) last = next;
                }
            }
        }
    }
    bits.ue(); const poc = bits.ue();
    if (poc === 0) bits.ue();
    else if (poc === 1) { bits.read(); bits.se(); bits.se(); const n = bits.ue(); for (let i = 0; i < n; i++) bits.se(); }
    bits.ue(); bits.read();
    const macroWidth = bits.ue() + 1, macroHeight = bits.ue() + 1;
    const frameOnly = bits.read(); if (!frameOnly) bits.read(); bits.read();
    let crop = [0, 0, 0, 0];
    if (bits.read()) crop = [bits.ue(), bits.ue(), bits.ue(), bits.ue()];
    const cropX = chromaFormat === 1 || chromaFormat === 2 ? 2 : 1;
    const cropY = (chromaFormat === 1 ? 2 : 1) * (2 - frameOnly);
    const result = { profile, level, chromaFormat, bitDepthLuma, bitDepthChroma,
        width: macroWidth * 16 - cropX * (crop[0] + crop[1]),
        height: macroHeight * 16 * (2 - frameOnly) - cropY * (crop[2] + crop[3]),
        fullRange: null, primaries: null, transfer: null, matrix: null };
    if (!bits.read()) return result;
    if (bits.read()) { if (bits.read(8) === 255) { bits.read(16); bits.read(16); } }
    if (bits.read()) bits.read();
    if (bits.read()) {
        bits.read(3); result.fullRange = Boolean(bits.read());
        if (bits.read()) { result.primaries = bits.read(8); result.transfer = bits.read(8); result.matrix = bits.read(8); }
    }
    return result;
}

export function inspectAnnexBSps(data) {
    const starts = [];
    for (let i = 0; i + 3 < data.length; i++) {
        if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1) { starts.push({ start: i, payload: i + 3 }); i += 2; }
        else if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 1) { starts.push({ start: i, payload: i + 4 }); i += 3; }
    }
    return starts.flatMap((entry, i) => (data[entry.payload] & 31) === 7
        ? [inspectSps(data.subarray(entry.payload, starts[i + 1]?.start ?? data.length))] : []);
}

export function inspectMp4Colour(data, { includeTiming = false } = {}) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const result = { container: [], sps: [], sampleEntries: [], frameCount: 0, durationTicks: 0, timescale: 0,
        mediaDurationTicks: 0, movieTimescale: 0, movieDurationTicks: 0 };
    if (includeTiming) { result.sampleTiming = []; result.compositionTiming = []; result.edits = []; }
    const text = offset => String.fromCharCode(...data.subarray(offset, offset + 4));
    function walk(start, end) {
        for (let offset = start; offset + 8 <= end;) {
            let size = view.getUint32(offset), header = 8;
            const type = text(offset + 4);
            if (size === 1) { if (offset + 16 > end) throw new Error('Truncated MP4 box.'); size = Number(view.getBigUint64(offset + 8)); header = 16; }
            if (size === 0) size = end - offset;
            if (size < header || offset + size > end) throw new Error('Invalid MP4 box size.');
            const payload = offset + header, limit = offset + size;
            if (['moov', 'trak', 'mdia', 'minf', 'stbl'].includes(type) || (type === 'edts' && includeTiming)) walk(payload, limit);
            else if (type === 'stsd') walk(payload + 8, limit);
            else if (['avc1','avc3','hvc1','hev1','av01','vp09'].includes(type)) {
                result.sampleEntries.push(type); walk(payload + 78, limit);
            }
            else if (type === 'colr') {
                if (limit - payload < 11 || text(payload) !== 'nclx') throw new Error('Expected MP4 nclx colour box.');
                result.container.push({ primaries: view.getUint16(payload + 4), transfer: view.getUint16(payload + 6),
                    matrix: view.getUint16(payload + 8), fullRange: Boolean(data[payload + 10] & 128) });
            } else if (type === 'avcC') {
                if (limit - payload < 7) throw new Error('Truncated avcC.');
                let cursor = payload + 6;
                for (let i = 0; i < (data[payload + 5] & 31); i++) {
                    if (cursor + 2 > limit) throw new Error('Truncated avcC SPS.');
                    const length = view.getUint16(cursor); cursor += 2;
                    if (cursor + length > limit) throw new Error('Truncated avcC SPS.');
                    result.sps.push(inspectSps(data.subarray(cursor, cursor + length))); cursor += length;
                }
            } else if (type === 'stts') {
                if (payload + 8 > limit) throw new Error('Truncated stts.');
                const count = view.getUint32(payload + 4);
                if (payload + 8 + count * 8 > limit) throw new Error('Truncated stts entries.');
                for (let i = 0; i < count; i++) {
                    const n = view.getUint32(payload + 8 + i * 8), delta = view.getUint32(payload + 12 + i * 8);
                    result.frameCount += n; result.durationTicks += n * delta;
                    if (includeTiming) result.sampleTiming.push({ count: n, value: delta });
                }
            } else if (type === 'elst' && includeTiming) {
                if (payload + 8 > limit) throw new Error('Truncated elst.');
                const count = view.getUint32(payload + 4), wide = data[payload] === 1, stride = wide ? 20 : 12;
                if (payload + 8 + count * stride > limit) throw new Error('Truncated elst entries.');
                for (let i = 0; i < count; i++) {
                    const cursor = payload + 8 + i * stride;
                    result.edits.push({ duration: wide ? Number(view.getBigUint64(cursor)) : view.getUint32(cursor),
                        mediaTime: wide ? Number(view.getBigInt64(cursor + 8)) : view.getInt32(cursor + 4),
                        rateInteger: view.getInt16(cursor + stride - 4), rateFraction: view.getInt16(cursor + stride - 2) });
                }
            } else if (type === 'ctts' && includeTiming) {
                if (payload + 8 > limit) throw new Error('Truncated ctts.');
                const count = view.getUint32(payload + 4);
                if (payload + 8 + count * 8 > limit) throw new Error('Truncated ctts entries.');
                for (let i = 0; i < count; i++) result.compositionTiming.push({ count: view.getUint32(payload + 8 + i * 8),
                    value: data[payload] === 1 ? view.getInt32(payload + 12 + i * 8) : view.getUint32(payload + 12 + i * 8) });
            } else if (type === 'mdhd' || type === 'mvhd') {
                const location = payload + (data[payload] === 1 ? 20 : 12);
                const durationSize = data[payload] === 1 ? 8 : 4;
                if (location + 4 + durationSize > limit) throw new Error(`Truncated ${type}.`);
                const scale = view.getUint32(location);
                const duration = durationSize === 8 ? Number(view.getBigUint64(location + 4)) : view.getUint32(location + 4);
                if (type === 'mdhd') { result.timescale = scale; result.mediaDurationTicks = duration; }
                else { result.movieTimescale = scale; result.movieDurationTicks = duration; }
            }
            offset = limit;
        }
    }
    walk(0, data.length);
    return result;
}

export function assertSdrSps(entries, { width, height }) {
    if (!entries.length || entries.some(s => s.chromaFormat !== 1 || s.bitDepthLuma !== 8 || s.bitDepthChroma !== 8
        || s.fullRange !== false || s.primaries !== 1 || s.transfer !== 1 || s.matrix !== 1
        || s.width !== width || s.height !== height)) throw new Error('Encoded H.264 does not conform to BT.709 limited, 8-bit 4:2:0.');
}

// FFmpeg's raw AVC reader has a fixed timestamp clock and can round the last
// packet/movie duration. These are known CFR, zero-B-frame samples: restore their
// original synthetic-clock timings, including edit-list and movie duration.
// Only timing fields are changed. Colour metadata and encoded pixels are untouched.
export function restoreCfrMp4Timing(data, { fps, frames }) {
    const metadata = inspectMp4Colour(data);
    if (metadata.frameCount !== frames || metadata.timescale !== metadata.movieTimescale) throw new Error('Unexpected CFR mux structure.');
    const delta = Math.round(metadata.timescale / fps), duration = delta * frames;
    if (Math.abs(delta / metadata.timescale - 1 / fps) > 1e-10) throw new Error('Frame rate is not representable in the MP4 clock.');
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    function setDuration(offset, size) {
        if (size === 8) view.setBigUint64(offset, BigInt(duration));
        else { if (duration > 0xffffffff) throw new Error('MP4 duration exceeds its clock limit.'); view.setUint32(offset, duration); }
    }
    function walk(start, end) {
        for (let offset = start; offset + 8 <= end;) {
            let size = view.getUint32(offset), header = 8;
            if (size === 1) { size = Number(view.getBigUint64(offset + 8)); header = 16; }
            if (!size) size = end - offset;
            if (size < header || offset + size > end) throw new Error('Invalid MP4 timing box.');
            const type = String.fromCharCode(...data.subarray(offset + 4, offset + 8));
            const payload = offset + header, limit = offset + size;
            if (['moov','trak','mdia','minf','stbl','edts'].includes(type)) walk(payload, limit);
            else if (type === 'mvhd' || type === 'mdhd') setDuration(payload + (data[payload] === 1 ? 24 : 16), data[payload] === 1 ? 8 : 4);
            else if (type === 'tkhd') setDuration(payload + (data[payload] === 1 ? 28 : 20), data[payload] === 1 ? 8 : 4);
            else if (type === 'stts') {
                const entries = view.getUint32(payload + 4);
                for (let i = 0; i < entries; i++) view.setUint32(payload + 12 + i * 8, delta);
            } else if (type === 'elst') {
                if (view.getUint32(payload + 4) !== 1) throw new Error('Unexpected CFR edit list.');
                const durationSize = data[payload] === 1 ? 8 : 4;
                const mediaTime = durationSize === 8 ? Number(view.getBigInt64(payload + 16)) : view.getInt32(payload + 12);
                if (mediaTime !== 0) throw new Error('Unexpected CFR start time.');
                setDuration(payload + 8, durationSize);
            } else if (type === 'ctts') throw new Error('CFR export must not contain reordered frames.');
            offset = limit;
        }
    }
    walk(0, data.length);
    return data;
}

export function assertSdrMp4(data, { width, height, fps, frames }) {
    const metadata = inspectMp4Colour(data);
    assertSdrSps(metadata.sps, { width, height });
    if (!metadata.container.length || metadata.container.some(c => c.primaries !== 1 || c.transfer !== 1 || c.matrix !== 1 || c.fullRange !== false)) {
        throw new Error('MP4 nclx and H.264 VUI colour metadata disagree.');
    }
    if (metadata.frameCount !== frames || !metadata.timescale
        || Math.abs(metadata.durationTicks / metadata.timescale - frames / fps) > 1 / metadata.timescale
        || Math.abs(metadata.mediaDurationTicks / metadata.timescale - frames / fps) > 1 / metadata.timescale
        || !metadata.movieTimescale
        || Math.abs(metadata.movieDurationTicks / metadata.movieTimescale - frames / fps) > 1 / metadata.movieTimescale) {
        throw new Error('MP4 frame count or duration differs from the rendered sequence.');
    }
    return metadata;
}
