export const EXPORT_LOGO_SRC = '/rivvon.svg';
export const EXPORT_LOGO_AREA_RATIO = 0.005;

const EXPORT_LOGO_FALLBACK_ASPECT_RATIO = 533.2 / 88.4;
const EXPORT_LOGO_PADDING_RATIO = 0.025;

let cachedExportLogoPromise = null;

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

export function getExportLogoOverlayLayout(videoWidth, videoHeight, aspectRatio = EXPORT_LOGO_FALLBACK_ASPECT_RATIO) {
    const safeWidth = Math.max(1, Math.round(videoWidth));
    const safeHeight = Math.max(1, Math.round(videoHeight));
    const targetArea = safeWidth * safeHeight * EXPORT_LOGO_AREA_RATIO;
    const width = Math.sqrt(targetArea * aspectRatio);
    const height = Math.sqrt(targetArea / aspectRatio);
    const padding = Math.max(12, Math.round(Math.min(safeWidth, safeHeight) * EXPORT_LOGO_PADDING_RATIO));

    return {
        width,
        height,
        x: safeWidth - padding - width,
        y: safeHeight - padding - height,
        padding,
        targetArea,
    };
}

export function drawExportLogoOverlay(context, logoImage, videoWidth, videoHeight, aspectRatio) {
    const layout = getExportLogoOverlayLayout(videoWidth, videoHeight, aspectRatio);

    context.save();
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(logoImage, layout.x, layout.y, layout.width, layout.height);
    context.restore();

    return layout;
}

export async function loadExportLogoAsset() {
    if (!cachedExportLogoPromise) {
        cachedExportLogoPromise = (async () => {
            const response = await fetch(EXPORT_LOGO_SRC, { cache: 'force-cache' });
            if (!response.ok) {
                throw new Error(`Failed to fetch export logo (${response.status}).`);
            }

            const svgText = await response.text();
            const aspectRatio = getSvgAspectRatio(svgText);
            const image = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`);

            return { image, aspectRatio };
        })().catch(error => {
            cachedExportLogoPromise = null;
            throw error;
        });
    }

    return cachedExportLogoPromise;
}