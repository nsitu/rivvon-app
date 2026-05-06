const CDN_BASE_URL = 'https://cdn.rivvon.ca';

export function buildCdnUrl(path: string): string {
    return `${CDN_BASE_URL}/${path}`;
}

export function extractCdnPath(url: string): string {
    const prefix = `${CDN_BASE_URL}/`;
    return url.startsWith(prefix) ? url.slice(prefix.length) : url;
}

export function buildGoogleDriveDownloadUrl(fileId: string): string {
    return `https://drive.google.com/uc?export=download&id=${fileId}`;
}

export function buildTextureTileR2Key(textureSetId: string, tileIndex: number): string {
    return `textures/${textureSetId}/${tileIndex}.ktx2`;
}

export function buildTextureThumbnailR2Key(textureSetId: string, extension: string): string {
    return `thumbnails/${textureSetId}.${extension}`;
}

export function buildDrawingPayloadR2Key(drawingId: string): string {
    return `drawings/${drawingId}/drawing.json`;
}

export function buildDrawingThumbnailR2Key(drawingId: string, extension: string): string {
    return `drawing-thumbnails/${drawingId}.${extension}`;
}