const colourNames = {
    primaries: { 1: 'BT.709', 6: 'SMPTE 170M', bt709: 'BT.709', smpte170m: 'SMPTE 170M' },
    transfer: { 1: 'BT.709', 6: 'SMPTE 170M', 13: 'sRGB', bt709: 'BT.709', smpte170m: 'SMPTE 170M', 'iec61966-2-1': 'sRGB' },
    matrix: { 0: 'RGB', 1: 'BT.709', 6: 'SMPTE 170M', rgb: 'RGB', bt709: 'BT.709', smpte170m: 'SMPTE 170M' },
};
const colourKeys = ['primaries', 'transfer', 'matrix', 'fullRange'];
const declared = (colour, key) => colour?.[key] != null && (key === 'fullRange' || colour[key] !== 2);
const target = colour => colour?.primaries === 1 && colour.transfer === 1 && colour.matrix === 1 && colour.fullRange === false;

export function describeColour(colour) {
    if (!colour) return 'Not declared';
    const name = key => colour[key] == null ? 'Not declared' : (colourNames[key][colour[key]] ?? `Code ${colour[key]}`);
    const range = colour.fullRange === true ? 'Full' : colour.fullRange === false ? 'Limited' : 'Not declared';
    return `${range} range · ${name('primaries')} primaries · ${name('transfer')} transfer · ${name('matrix')} matrix`;
}

export function describeColourEntries(entries) {
    return entries?.length ? [...new Set(entries.map(describeColour))].join('; ') : 'Not declared';
}

// These strings are browser-reported observations, not authoritative device IDs.
// Probe only the source's existing context: do not create a WebGL context on a
// 2D/WebGPU source as a diagnostic side effect.
export async function collectExportEnvironment(renderContext = null, nav = globalThis.navigator) {
    const environment = { userAgent: nav?.userAgent ?? null, platform: nav?.platform ?? null,
        browser: null, os: null, gpu: null, context: null };
    if (nav?.userAgentData) {
        const ua = nav.userAgentData;
        environment.browser = ua.brands ?? null;
        environment.os = { platform: ua.platform, mobile: ua.mobile };
        try {
            const details = await ua.getHighEntropyValues(['platformVersion', 'fullVersionList', 'architecture', 'bitness']);
            environment.browser = details.fullVersionList ?? environment.browser;
            environment.os = { ...environment.os, platformVersion: details.platformVersion,
                architecture: details.architecture, bitness: details.bitness };
        } catch { /* Restricted client hints: preserve the UA/platform fallback. */ }
    }
    try {
        const gl = renderContext;
        if (typeof gl?.getParameter === 'function') {
            const debug = gl.getExtension('WEBGL_debug_renderer_info');
            environment.context = gl.getParameter(gl.VERSION);
            environment.gpu = { vendor: gl.getParameter(debug ? debug.UNMASKED_VENDOR_WEBGL : gl.VENDOR),
                renderer: gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER) };
        }
    } catch { /* GPU details can be restricted or the context lost. */ }
    return environment;
}

export function completeExportColourReport(base, metadata = null, inspectionError = null) {
    // Measure the completed file without copying/decoding its media. This includes
    // container overhead, so label it separately from the requested video bitrate.
    const output = base.output?.duration > 0 && Number.isFinite(base.output.duration)
        ? { ...base.output, averageBitrate: base.output.bytes * 8 / base.output.duration } : null;
    const rateControlWarnings = [];
    if (output && base.targetBitrate > 0 && base.bitrateMode !== 'quantizer') {
        const ratio = output.averageBitrate / base.targetBitrate;
        if (ratio < 0.5 || ratio > 1.5) {
            rateControlWarnings.push(`Average file bitrate is ${(output.averageBitrate / 1_000_000).toFixed(2)} Mb/s against a ${(base.targetBitrate / 1_000_000).toFixed(2)} Mb/s video target. ${base.bitrateMode === 'constant'
                ? 'The encoder output differs substantially from the CBR target.'
                : 'VBR can use less data for simple content; a large mismatch on detailed content can also indicate that the encoder did not honour the target.'}`);
            if (base.encodingMethod === 'webcodecs' && base.hardwareAcceleration !== 'prefer-software') {
                rateControlWarnings.push('If quality is lower than expected, try Encoder preference → Prefer software. Browser hardware encoders can accept a bitrate configuration without producing the requested rate.');
            }
        }
    }
    const container = metadata?.container ?? [];
    const bitstream = base.videoCodec === 'av1' ? base.sequenceHeaders ?? [] : metadata?.sps ?? [];
    const bitstreamLabel = base.videoCodec === 'av1' ? 'AV1 sequence header' : 'H.264 SPS';
    const declarations = [...container, ...bitstream];
    const warnings = [];
    let agreement = 'incomplete';
    if (container.length && bitstream.length && declarations.every(c => colourKeys.every(k => declared(c, k)))) agreement = 'agree';
    if (declarations.some((c, i) => declarations.slice(i + 1).some(other =>
        colourKeys.some(k => declared(c, k) && declared(other, k) && c[k] !== other[k])))) agreement = 'conflict';
    const matchesSdrTarget = !inspectionError && base.format === 'mp4' && container.length > 0 && bitstream.length > 0
        && declarations.every(target) && bitstream.every(s => s.chromaFormat === 1 && s.bitDepthLuma === 8 && s.bitDepthChroma === 8);
    const requestedColour = base.explicitYuv && ['limited', 'full'].includes(base.videoRange);
    const matchesRequestedColour = requestedColour ? !inspectionError && base.format === 'mp4' && container.length > 0 && bitstream.length > 0
        && declarations.every(c => c.primaries === 1 && c.transfer === 1 && c.matrix === 1 && c.fullRange === (base.videoRange === 'full'))
        && bitstream.every(s => s.chromaFormat === 1 && s.bitDepthLuma === 8 && s.bitDepthChroma === 8) : null;
    const requested = { primaries: 1, transfer: 1, matrix: 1, fullRange: base.videoRange === 'full' };
    const conflictsWithRequestedColour = requestedColour ? declarations.some(c =>
        colourKeys.some(key => declared(c, key) && c[key] !== requested[key]))
        || bitstream.some(s => Object.entries({ chromaFormat: 1, bitDepthLuma: 8, bitDepthChroma: 8 })
            .some(([key, value]) => s[key] != null && s[key] !== value))
        || (base.decoderColourSpaces ?? []).some(c => c && (
            ['primaries', 'transfer', 'matrix'].some(key => c[key] != null && c[key] !== 'bt709')
            || (typeof c.fullRange === 'boolean' && c.fullRange !== requested.fullRange))) : null;
    if (base.format === 'mp4') {
        if (!container.length) warnings.push('MP4 colour declaration is absent or could not be inspected.');
        if (!bitstream.length || bitstream.some(s => colourKeys.some(k => !declared(s, k)))) warnings.push(`${bitstreamLabel} colour declaration is absent or incomplete.`);
        if (agreement === 'conflict') warnings.push('Container and/or bitstream colour declarations conflict.');
        if (conflictsWithRequestedColour) warnings.push(`Known output declarations or pixel format conflict with the requested BT.709 ${base.videoRange}, 8-bit 4:2:0 output.`);
        else if (requestedColour && !matchesRequestedColour) warnings.push(`Incomplete metadata does not fully confirm BT.709 ${base.videoRange} output; player interpretation may vary.`);
        else if (!requestedColour && !matchesSdrTarget) warnings.push('This file does not establish the complete BT.709 limited, 8-bit 4:2:0 contract.');
    } else warnings.push('WebM container and VP9 bitstream colour are not independently inspected; encoder metadata is reported.');
    if (inspectionError) warnings.push(`Colour inspection failed: ${inspectionError}`);
    if (base.spsRepair?.status === 'skipped') warnings.push(`Missing SPS colour was not added: ${base.spsRepair.reason}`);
    if (base.encodingMethod === 'webcodecs') warnings.push(base.explicitYuv
        ? 'BT.709 I420 pixels were explicitly supplied; colour tags alone do not verify that the encoder preserved their values.'
        : 'Colour tags describe the output; they do not prove correct browser-managed pixel conversion.');
    return { ...base, ...(metadata ?? {}), output, rateControlWarnings, phase: 'complete', completedAt: new Date().toISOString(),
        verification: { matchesSdrTarget: Boolean(matchesSdrTarget), matchesRequestedColour, conflictsWithRequestedColour, containerAndBitstream: agreement,
            pixelConversion: base.encodingMethod === 'ffmpeg' ? 'explicit-sRGB-to-BT.709-limited-I420'
                : base.explicitYuv ? `explicit-sRGB-to-BT.709-${base.videoRange}-I420` : 'browser-managed-unverified', warnings } };
}

export function exportEnvironmentLabel(environment) {
    // Keep all raw brands in JSON, but omit the client-hint GREASE brand in UI.
    const browser = environment?.browser?.filter(b => !/not.*brand/i.test(b.brand)).map(b => `${b.brand} ${b.version}`).join(', ');
    const os = environment?.os;
    return [browser || environment?.userAgent || 'Browser unavailable',
        os ? `${os.platform}${os.platformVersion ? ` (platform version ${os.platformVersion})` : ''}` : environment?.platform || 'OS unavailable'].join(' · ');
}
