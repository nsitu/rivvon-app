import { readdirSync, statSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const limit = 25 * 1024 * 1024;
const root = resolve(process.argv[2] || fileURLToPath(new URL('../dist/', import.meta.url)));
const oversized = [];

function checkDirectory(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) {
            checkDirectory(path);
        } else {
            const { size } = statSync(path);
            if (size > limit) oversized.push({ path: relative(root, path), size });
        }
    }
}

checkDirectory(root);
if (oversized.length) {
    console.error('Cloudflare Pages assets must be at most 25 MiB. Publish larger files through the R2 runtime asset manifest:');
    for (const { path, size } of oversized) console.error(`  ${path}: ${(size / 1024 / 1024).toFixed(2)} MiB (${size} bytes)`);
    process.exitCode = 1;
} else {
    console.log('All Pages assets are within the 25 MiB limit.');
}
