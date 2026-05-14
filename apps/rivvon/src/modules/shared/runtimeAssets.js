import { runtimeAssetManifest as configuredRuntimeAssetManifest } from '../../../config/runtimeAssets.mjs';

const PUBLIC_BASE_URL = ensureTrailingSlash(import.meta.env.BASE_URL || '/');
const ASSET_BASE_URL = normalizeOptionalBaseUrl(import.meta.env.VITE_ASSET_BASE_URL);
const ASSET_MODE = normalizeAssetMode(import.meta.env.VITE_ASSET_MODE);

export const runtimeAssetManifest = configuredRuntimeAssetManifest;

function ensureTrailingSlash(value) {
    return value.endsWith('/') ? value : `${value}/`;
}

function stripLeadingSlash(value) {
    return value.startsWith('/') ? value.slice(1) : value;
}

function normalizeOptionalBaseUrl(value) {
    if (!value) {
        return '';
    }

    return ensureTrailingSlash(value.trim());
}

function normalizeAssetMode(value) {
    if (!value) {
        return 'auto';
    }

    return value.trim().toLowerCase();
}

function buildPublicUrl(path) {
    return `${PUBLIC_BASE_URL}${stripLeadingSlash(path)}`;
}

function buildExternalUrl(objectKey) {
    if (!ASSET_BASE_URL) {
        return '';
    }

    return `${ASSET_BASE_URL}${stripLeadingSlash(objectKey)}`;
}

export function getRuntimeAssetEntry(assetId) {
    const entry = runtimeAssetManifest[assetId];

    if (!entry) {
        throw new Error(`Unknown runtime asset: ${assetId}`);
    }

    return entry;
}

export function getRuntimeAssetUrls(assetId) {
    const entry = getRuntimeAssetEntry(assetId);
    const localUrl = buildPublicUrl(entry.localPath);
    const externalUrl = buildExternalUrl(entry.objectKey);

    if (ASSET_MODE === 'local' || !externalUrl) {
        return [localUrl];
    }

    return [externalUrl, localUrl];
}

export function getRuntimeAssetUrl(assetId) {
    return getRuntimeAssetUrls(assetId)[0];
}
