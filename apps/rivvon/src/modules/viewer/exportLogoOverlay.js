import { createLazyLoader } from '../shared/lazyLoader.js';

export const EXPORT_LOGO_SRC = '/made-with-rivvon.svg';
export const EXPORT_LOGO_AREA_RATIO = 0.005;
export const EXPORT_LOGO_DEFAULT_CORNER = 'bottomLeft';
export const EXPORT_LOGO_CORNER_OPTIONS = Object.freeze([
    { label: 'Top Left', value: 'topLeft' },
    { label: 'Top Right', value: 'topRight' },
    { label: 'Bottom Right', value: 'bottomRight' },
    { label: 'Bottom Left', value: 'bottomLeft' },
]);

const EXPORT_LOGO_FALLBACK_ASPECT_RATIO = 533.2 / 88.4;
const EXPORT_LOGO_PADDING_RATIO = 0.025;
const EXPORT_LOGO_CORNERS = new Set(['topLeft', 'topRight', 'bottomRight', 'bottomLeft']);

function parsePositiveNumber(value) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function getSvgAspectRatio(svgText) {
    const parsedSvg = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    const svgRoot = parsedSvg.documentElement;
    const viewBox = svgRoot?.getAttribute('viewBox');

    if (viewBox) {
        const [, , width, height] = viewBox.trim().split(/[\s,]+/).map(part => Number.parseFloat(part));
        if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
            return width / height;
        }
    }

    const width = parsePositiveNumber(svgRoot?.getAttribute('width'));
    const height = parsePositiveNumber(svgRoot?.getAttribute('height'));
    if (width && height) {
        return width / height;
    }

    return EXPORT_LOGO_FALLBACK_ASPECT_RATIO;
}

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.decoding = 'async';
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Failed to decode export logo image.'));
        image.src = src;
    });
}

export function normalizeExportLogoCorner(value, fallback = EXPORT_LOGO_DEFAULT_CORNER) {
    if (EXPORT_LOGO_CORNERS.has(value)) {
        return value;
    }

    return EXPORT_LOGO_CORNERS.has(fallback)
        ? fallback
        : EXPORT_LOGO_DEFAULT_CORNER;
}

export function getExportLogoOverlayLayout(videoWidth, videoHeight, aspectRatio = EXPORT_LOGO_FALLBACK_ASPECT_RATIO, corner = EXPORT_LOGO_DEFAULT_CORNER) {
    const safeWidth = Math.max(1, Math.round(videoWidth));
    const safeHeight = Math.max(1, Math.round(videoHeight));
    const targetArea = safeWidth * safeHeight * EXPORT_LOGO_AREA_RATIO;
    const width = Math.sqrt(targetArea * aspectRatio);
    const height = Math.sqrt(targetArea / aspectRatio);
    const padding = Math.max(12, Math.round(Math.min(safeWidth, safeHeight) * EXPORT_LOGO_PADDING_RATIO));
    const normalizedCorner = normalizeExportLogoCorner(corner);

    const x = normalizedCorner === 'topLeft' || normalizedCorner === 'bottomLeft'
        ? padding
        : safeWidth - padding - width;

    const y = normalizedCorner === 'topLeft' || normalizedCorner === 'topRight'
        ? padding
        : safeHeight - padding - height;

    return {
        width,
        height,
        x,
        y,
        padding,
        targetArea,
        corner: normalizedCorner,
    };
}

export function drawExportLogoOverlay(context, logoImage, videoWidth, videoHeight, aspectRatio, corner = EXPORT_LOGO_DEFAULT_CORNER) {
    const layout = getExportLogoOverlayLayout(videoWidth, videoHeight, aspectRatio, corner);
    drawLogo(context, logoImage, layout);
    return layout;
}

function getLogoShadow(height) {
    return {
        blur: Math.max(6, Math.round(height * 0.2)),
        offsetY: Math.max(2, Math.round(height * 0.08)),
    };
}

function drawLogo(context, logoImage, layout) {
    const { blur, offsetY } = getLogoShadow(layout.height);
    context.save();
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';

    // Keep the white logo legible on both bright and dark backgrounds.
    context.shadowColor = 'rgba(0, 0, 0, 0.45)';
    context.shadowBlur = blur;
    context.shadowOffsetX = 0;
    context.shadowOffsetY = offsetY;

    context.drawImage(logoImage, layout.x, layout.y, layout.width, layout.height);
    context.restore();
}

export function rasterizeExportLogo(image, layout) {
    // Include the soft shadow and retain the logo's fractional pixel alignment.
    const { blur, offsetY } = getLogoShadow(layout.height);
    const inset = 3 * blur + offsetY;
    const x = Math.floor(layout.x) - inset;
    const y = Math.floor(layout.y) - inset;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(layout.x + layout.width) + inset - x;
    canvas.height = Math.ceil(layout.y + layout.height) + inset - y;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Failed to rasterize the export logo.');
    context.translate(-x, -y);
    drawLogo(context, image, layout);
    return { canvas, x, y };
}

export const loadExportLogoAsset = createLazyLoader(async () => {
    const response = await fetch(EXPORT_LOGO_SRC, { cache: 'force-cache' });
    if (!response.ok) {
        throw new Error(`Failed to fetch export logo (${response.status}).`);
    }

    const svgText = await response.text();
    const aspectRatio = getSvgAspectRatio(svgText);
    let image;

    try {
        const svgBlob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
        const blobUrl = URL.createObjectURL(svgBlob);
        try {
            image = await loadImage(blobUrl);
        } finally {
            URL.revokeObjectURL(blobUrl);
        }
    } catch (blobError) {
        console.warn('[ExportLogoOverlay] Blob URL decode failed, trying direct asset path:', blobError);
        image = await loadImage(EXPORT_LOGO_SRC);
    }

    return { image, aspectRatio };
});
