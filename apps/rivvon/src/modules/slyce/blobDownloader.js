// Given a blobURL, download it as a file.

/**
 * Download a blob URL as a file
 * @param {string} blobURL - The blob URL to download
 * @param {number} tileNumber - The tile number for naming
 * @param {Object} fileInfo - File information object
 * @param {Object} format - Format descriptor with mime type and extension
 * @param {string} format.mime - MIME type (e.g., 'video/webm', 'image/ktx2')
 * @param {string} format.extension - File extension (e.g., 'webm', 'ktx2')
 */
const downloadBlob = (blobURL, tileNumber, fileInfo, format = { mime: 'video/webm', extension: 'webm' }) => {
    let a = document.createElement('a');
    a.style.display = 'none';
    a.href = blobURL;
    let padded = String(tileNumber).padStart(4, '0');
    // Use format extension from parameter
    a.download = `tile-${padded}-${fileInfo.name}.${format.extension}`;
    document.body.appendChild(a);
    a.click();
    // Clean up
    document.body.removeChild(a);
};

export { downloadBlob };

