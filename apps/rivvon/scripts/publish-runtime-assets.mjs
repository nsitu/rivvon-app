import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRuntimeAssetEntries } from '../config/runtimeAssets.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, '..');
const bucketName = process.env.RUNTIME_ASSET_BUCKET || 'rivvon-textures';

function parseSelectedAssets(argv) {
    const selectedAssets = new Set();

    for (let index = 0; index < argv.length; index++) {
        if (argv[index] !== '--asset') {
            continue;
        }

        const assetId = argv[index + 1];
        if (!assetId) {
            throw new Error('Expected an asset id after --asset');
        }

        selectedAssets.add(assetId);
        index++;
    }

    return selectedAssets;
}

function ensureSourceFileExists(assetId, sourceFile) {
    if (!existsSync(sourceFile)) {
        throw new Error(`Source file is missing for ${assetId}: ${sourceFile}`);
    }
}

function runUpload(commandArgs) {
    const result = spawnSync('pnpm', commandArgs, {
        cwd: appRoot,
        stdio: 'inherit',
        shell: process.platform === 'win32',
        env: process.env,
    });

    if (result.status !== 0) {
        throw new Error(`Wrangler upload failed with exit code ${result.status ?? 'unknown'}`);
    }
}

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const selectedAssets = parseSelectedAssets(argv);
const assets = getRuntimeAssetEntries().filter(({ assetId }) => selectedAssets.size === 0 || selectedAssets.has(assetId));

if (assets.length === 0) {
    throw new Error('No runtime assets matched the requested selection.');
}

for (const asset of assets) {
    const sourceFile = resolve(appRoot, asset.sourcePath);
    const objectPath = `${bucketName}/${asset.objectKey}`;

    ensureSourceFileExists(asset.assetId, sourceFile);

    const commandArgs = [
        'dlx',
        'wrangler@4.86.0',
        'r2',
        'object',
        'put',
        objectPath,
        '--remote',
        '--file',
        sourceFile,
        '--content-type',
        asset.contentType,
        '--cache-control',
        asset.cacheControl,
    ];

    if (dryRun) {
        console.log(`[dry-run] ${asset.assetId} -> ${objectPath}`);
        continue;
    }

    console.log(`Uploading ${asset.assetId} -> ${objectPath}`);
    runUpload(commandArgs);
}
