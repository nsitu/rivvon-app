import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { closeSync, ftruncateSync, mkdirSync, mkdtempSync, openSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./check-pages-assets.mjs', import.meta.url));
const directories = [];
afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixture(size) {
    const directory = mkdtempSync(join(tmpdir(), 'rivvon-pages-size-'));
    directories.push(directory);
    mkdirSync(join(directory, 'vendor'));
    const file = openSync(join(directory, 'vendor', 'core.wasm'), 'w');
    try { ftruncateSync(file, size); } finally { closeSync(file); }
    return directory;
}

describe('Pages deployment size guard', () => {
    it('accepts a file at exactly 25 MiB', () => {
        const result = spawnSync(process.execPath, [script, fixture(25 * 1024 * 1024)], { encoding: 'utf8' });
        expect(result.status).toBe(0);
    });

    it('rejects a nested file even one byte over the limit and identifies it', () => {
        const result = spawnSync(process.execPath, [script, fixture(25 * 1024 * 1024 + 1)], { encoding: 'utf8' });
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('core.wasm');
        expect(result.stderr).toContain('26214401 bytes');
    });

    it('fails if there is no build output to check', () => {
        const result = spawnSync(process.execPath, [script, join(fixture(0), 'missing')], { encoding: 'utf8' });
        expect(result.status).not.toBe(0);
    });
});
