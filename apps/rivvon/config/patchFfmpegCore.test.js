import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { patchFfmpegCore } from './patchFfmpegCore.mjs';
import { getSdrEncodeArgs } from '../src/modules/viewer/exportColour.js';

const require = createRequire(import.meta.url);
const source = readFileSync(require.resolve('@ffmpeg/core'), 'utf8');
const wasmBinary = readFileSync(require.resolve('@ffmpeg/core/wasm'));
const args = getSdrEncodeArgs({ width: 2, height: 2, fps: 30, frames: 4, quality: 'very-high' });

async function loadCore(patch) {
    // Use the installed UMD factory with real WASM in Node. The same minified
    // bindings are also present in the ESM loader copied by Vite.
    const { runInNewContext } = await import('node:vm');
    const code = (patch ? patchFfmpegCore(source) : source)
        .replace('Module["reset"]=reset;', 'Module["reset"]=reset;Module["testStackSave"]=()=>stackSave();');
    const context = { module: { exports: {} }, exports: {}, __filename: require.resolve('@ffmpeg/core'),
        self: { location: { href: 'file:///ffmpeg-core.js' } }, console, WebAssembly, performance };
    runInNewContext(code, context);
    const core = await context.module.exports({ wasmBinary });
    core.setLogger(() => {});
    return core;
}

function encodeBatch(core) {
    core.FS.writeFile('frames.yuv', new Uint8Array(24).fill(128));
    expect(core.exec(...args)).toBe(0);
    core.reset();
    core.FS.unlink('frames.yuv');
}

describe('pinned FFmpeg WASM stack fix', () => {
    it('rejects missing, duplicate, or already-patched bindings', () => {
        expect(() => patchFfmpegCore('')).toThrow('Cannot patch FFmpeg exec');
        expect(() => patchFfmpegCore(source + source)).toThrow('exactly once');
        expect(() => patchFfmpegCore(source.replace('function ffprobe(', 'function changedFfprobe(')))
            .toThrow('Cannot patch FFmpeg ffprobe');
        expect(() => patchFfmpegCore(patchFfmpegCore(source))).toThrow('Cannot patch FFmpeg exec');
    });

    it('reproduces stack exhaustion in the unpatched core with tiny frames', async () => {
        const core = await loadCore(false);
        let completed = 0, failure;
        try {
            for (; completed < 200; completed++) {
                encodeBatch(core);
                core.FS.unlink('chunk.h264');
            }
        } catch (error) { failure = error; }
        expect(completed).toBeGreaterThan(0);
        expect(completed).toBeLessThan(200);
        expect(String(failure)).toContain('memory access out of bounds');
    });

    it('preserves the stack through 1,000 encodes, probes, nonzero exits, and exceptions', async () => {
        const core = await loadCore(true);
        const stack = core.testStackSave();
        for (let batch = 0; batch < 1000; batch++) {
            encodeBatch(core);
            expect(core.testStackSave()).toBe(stack);
            if (batch % 100 === 0) {
                expect(core.ffprobe('-h')).toBe(0);
                expect(core.testStackSave()).toBe(stack);
                core.reset();
            }
            core.FS.unlink('chunk.h264');
        }
        for (const command of ['exec', 'ffprobe']) {
            expect(core[command]('-rivvon-invalid-option')).not.toBe(0);
            expect(core.testStackSave()).toBe(stack);
            core.reset();
        }
        const failure = new Error('Unexpected logger exception');
        core.setLogger(() => { throw failure; });
        for (const command of ['exec', 'ffprobe']) {
            expect(() => core[command]('-h')).toThrow(failure);
            expect(core.testStackSave()).toBe(stack);
        }
    }, 15000);
});
