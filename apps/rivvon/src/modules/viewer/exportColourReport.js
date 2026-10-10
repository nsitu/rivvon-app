const colourNames = {
    primaries: { 1: 'BT.709', 6: 'SMPTE 170M', bt709: 'BT.709', smpte170m: 'SMPTE 170M' },
    transfer: { 1: 'BT.709', 6: 'SMPTE 170M', 13: 'sRGB', bt709: 'BT.709', smpte170m: 'SMPTE 170M', 'iec61966-2-1': 'sRGB' },
    matrix: { 0: 'RGB', 1: 'BT.709', 6: 'SMPTE 170M', rgb: 'RGB', bt709: 'BT.709', smpte170m: 'SMPTE 170M' },
};
const colourKeys = ['primaries', 'transfer', 'matrix', 'fullRange'];
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
    const container = metadata?.container ?? [], sps = metadata?.sps ?? [];
    const declarations = [...container, ...sps];
    const warnings = [];
    let agreement = 'incomplete';
    if (container.length && sps.length && declarations.every(c => colourKeys.every(k => c[k] != null))) agreement = 'agree';
    if (declarations.some((c, i) => declarations.slice(i + 1).some(other =>
        colourKeys.some(k => c[k] != null && other[k] != null && c[k] !== other[k])))) agreement = 'conflict';
    const matchesSdrTarget = !inspectionError && base.format === 'mp4' && container.length > 0 && sps.length > 0
        && declarations.every(target) && sps.every(s => s.chromaFormat === 1 && s.bitDepthLuma === 8 && s.bitDepthChroma === 8);
    if (base.format === 'mp4') {
        if (!container.length) warnings.push('MP4 colour declaration is absent or could not be inspected.');
        if (!sps.length || sps.some(s => colourKeys.some(k => s[k] == null))) warnings.push('H.264 SPS colour declaration is absent or incomplete.');
        if (agreement === 'conflict') warnings.push('Container and/or bitstream colour declarations conflict.');
        if (!matchesSdrTarget) warnings.push('This file does not establish the complete BT.709 limited, 8-bit 4:2:0 contract.');
    } else warnings.push('WebM container and VP9 bitstream colour are not independently inspected; encoder metadata is reported.');
    if (inspectionError) warnings.push(`Colour inspection failed: ${inspectionError}`);
    if (base.spsRepair?.status === 'skipped') warnings.push(`Missing SPS colour was not added: ${base.spsRepair.reason}`);
    if (base.encodingMethod === 'webcodecs') warnings.push('Colour tags describe the output; they do not prove correct browser-managed pixel conversion.');
    return { ...base, ...(metadata ?? {}), phase: 'complete', completedAt: new Date().toISOString(),
        verification: { matchesSdrTarget: Boolean(matchesSdrTarget), containerAndBitstream: agreement,
            pixelConversion: base.encodingMethod === 'ffmpeg' ? 'explicit-sRGB-to-BT.709-limited-I420' : 'browser-managed-unverified', warnings } };
}

export function exportEnvironmentLabel(environment) {
    // Keep all raw brands in JSON, but omit the client-hint GREASE brand in UI.
    const browser = environment?.browser?.filter(b => !/not.*brand/i.test(b.brand)).map(b => `${b.brand} ${b.version}`).join(', ');
    const os = environment?.os;
    return [browser || environment?.userAgent || 'Browser unavailable',
        os ? `${os.platform}${os.platformVersion ? ` (platform version ${os.platformVersion})` : ''}` : environment?.platform || 'OS unavailable'].join(' · ');
}
