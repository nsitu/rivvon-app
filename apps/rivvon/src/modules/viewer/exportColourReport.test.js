import { describe, expect, it, vi } from 'vitest';
import { collectExportEnvironment, completeExportColourReport, describeColour, describeColourEntries, exportEnvironmentLabel } from './exportColourReport.js';

const colour = { primaries: 1, transfer: 1, matrix: 1, fullRange: false };
const sps = { ...colour, chromaFormat: 1, bitDepthLuma: 8, bitDepthChroma: 8 };
const base = { format: 'mp4', encodingMethod: 'webcodecs' };
describe('export colour reports', () => {
    it('does not mistake matching declarations for verified pixel conversion', () => {
        const report = completeExportColourReport(base, { container: [colour], sps: [sps] });
        expect(report.phase).toBe('complete');
        expect(report.verification).toMatchObject({ matchesSdrTarget: true, containerAndBitstream: 'agree', pixelConversion: 'browser-managed-unverified' });
        expect(report.verification.warnings.join()).toContain('do not prove');
    });
    it('reports the original hardware path without assigning a default to missing SPS colour', () => {
        const report = completeExportColourReport(base, { container: [{ ...colour, transfer: 13, fullRange: true }],
            sps: [{ ...sps, primaries: null, transfer: null, matrix: null, fullRange: null }] });
        expect(report.verification).toMatchObject({ matchesSdrTarget: false, containerAndBitstream: 'incomplete' });
        expect(describeColour(report.container[0])).toContain('Full range');
        expect(describeColour(report.sps[0])).toContain('Not declared range');
    });
    it('detects disagreements across all SPS and container entries', () => {
        const report = completeExportColourReport(base, { container: [colour], sps: [sps, { ...sps, fullRange: true }] });
        expect(report.verification).toMatchObject({ matchesSdrTarget: false, containerAndBitstream: 'conflict' });
    });
    it.each([{ chromaFormat: 3 }, { bitDepthLuma: 10 }])('rejects target status for pixel formats %j', change => {
        expect(completeExportColourReport(base, { container: [colour], sps: [{ ...sps, ...change }] }).verification.matchesSdrTarget).toBe(false);
    });
    it('distinguishes explicit software conversion and reports inspection errors', () => {
        const report = completeExportColourReport({ ...base, encodingMethod: 'ffmpeg' }, null, 'Truncated SPS');
        expect(report.verification.matchesSdrTarget).toBe(false);
        expect(report.verification.pixelConversion).toContain('explicit');
        expect(report.verification.warnings.join()).toContain('Truncated SPS');
    });
    it('reports WebM encoder metadata without claiming container inspection', () => {
        const report = completeExportColourReport({ ...base, format: 'webm' });
        expect(report.verification.matchesSdrTarget).toBe(false);
        expect(report.verification.warnings.join()).toContain('not independently inspected');
        expect(describeColour({ primaries: 'bt709', transfer: 'iec61966-2-1', matrix: 'bt709', fullRange: true })).toBe('Full range · BT.709 primaries · sRGB transfer · BT.709 matrix');
        expect(describeColourEntries([])).toBe('Not declared');
    });
});

describe('best-effort environment capture', () => {
    it('shows OS version codes as platform versions and omits fake brands only from the label', () => {
        const environment = { browser: [{ brand:'Chromium',version:'155' },{ brand:'Not(A:Brand',version:'24' }],os:{ platform:'Windows',platformVersion:'19.0.0' } };
        expect(exportEnvironmentLabel(environment)).toBe('Chromium 155 · Windows (platform version 19.0.0)');
        expect(environment.browser).toHaveLength(2);
    });
    it('captures browser/OS versions and an existing GL context', async () => {
        const gl = { getExtension: () => ({ UNMASKED_VENDOR_WEBGL: 1, UNMASKED_RENDERER_WEBGL: 2 }),
            VERSION: 3, getParameter: n => ({ 1: 'Intel', 2: 'ANGLE GPU', 3: 'WebGL 2.0' })[n] };
        const nav = { userAgent: 'Chrome UA', platform: 'Win32', userAgentData: { platform: 'Windows', mobile: false,
            getHighEntropyValues: vi.fn().mockResolvedValue({ fullVersionList: [{ brand: 'Chrome', version: '155' }], platformVersion: '19.0.0', architecture: 'x86', bitness: '64' }) } };
        expect(await collectExportEnvironment(gl, nav)).toMatchObject({ browser: [{ brand: 'Chrome', version: '155' }],
            os: { platform: 'Windows', platformVersion: '19.0.0' }, gpu: { vendor: 'Intel', renderer: 'ANGLE GPU' } });
    });
    it('keeps UA fallback when client hints/GPU observations fail', async () => {
        const nav = { userAgent: 'Fallback UA', platform: 'MacIntel', userAgentData: { platform: 'macOS',
            getHighEntropyValues: vi.fn().mockRejectedValue(new Error('restricted')) } };
        expect(await collectExportEnvironment({ getParameter() { throw new Error('lost'); }, getExtension() { throw new Error('lost'); } }, nav))
            .toMatchObject({ userAgent: 'Fallback UA', platform: 'MacIntel', os: { platform: 'macOS' }, gpu: null });
    });
});
