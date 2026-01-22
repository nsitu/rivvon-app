// Utility helpers for image metadata

// Map common file extensions to MIME types; defaults to octet-stream
function extToMime(ext) {
    switch ((ext || '').toLowerCase()) {
        case 'jpg':
        case 'jpeg':
        case 'jfif':
            return 'image/jpeg';
        case 'png':
            return 'image/png';
        case 'webp':
            return 'image/webp';
        default:
            return 'application/octet-stream';
    }
}



// Normalize/clean a file extension string (strip query/fragment, lower-case)
export function getFileExtension(input) {
    return (input || '').toString().split(/[#?]/)[0].toLowerCase();
}

export default { getFileExtension };
