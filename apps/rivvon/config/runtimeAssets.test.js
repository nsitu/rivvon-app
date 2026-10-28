import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ONNX_RUNTIME_VERSION } from './runtimeAssets.mjs';

describe('ONNX Runtime artifact compatibility', () => {
    it('pins the JS dependency and published artifacts to the same installed version', () => {
        const appPackage = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
        const installedPackage = JSON.parse(readFileSync(new URL('../node_modules/onnxruntime-web/package.json', import.meta.url), 'utf8'));
        expect(appPackage.dependencies['onnxruntime-web']).toBe(ONNX_RUNTIME_VERSION);
        expect(installedPackage.version).toBe(ONNX_RUNTIME_VERSION);
    });
});
