import JSZip from 'jszip';

/**
 * Download all tiles as a ZIP file
 * @param {Object} blobURLs - Map of tile numbers to blob URLs
 * @param {Object} fileInfo - File metadata
 * @param {Object} format - Format descriptor { mime, extension }
 * @param {Object} appStore - The app store instance containing all settings
 */
export async function downloadAllAsZip(blobURLs, fileInfo, format, appStore) {
    const zip = new JSZip();
    const filename = fileInfo?.name?.replace(/\.[^/.]+$/, '') || 'video';

    // Create metadata object with video info and settings
    const metadata = {
        generatedBy: 'Slyce',
        generatedAt: new Date().toISOString(),

        // Original video metadata
        video: {
            name: fileInfo?.name,
            size: fileInfo?.size,
            type: fileInfo?.type,
            width: fileInfo?.width,
            height: fileInfo?.height,
            duration: fileInfo?.duration,
            sourceFrameCount: appStore?.frameCount,
            // Actual frames sampled (may be limited by user via framesToSample setting)
            sampledFrameCount: appStore?.framesToSample > 0
                ? Math.min(appStore.framesToSample, appStore.frameCount)
                : appStore?.frameCount,
        },

        // Processing settings
        settings: {
            framesToSample: appStore?.framesToSample,
            crossSectionCount: appStore?.crossSectionCount,
            crossSectionType: appStore?.crossSectionType,
            samplingMode: appStore?.samplingMode,
            outputMode: appStore?.outputMode,
            tileMode: appStore?.tileMode,
            tileProportion: appStore?.tileProportion,
            prioritize: appStore?.prioritize,
            potResolution: appStore?.potResolution,
            downsampleStrategy: appStore?.downsampleStrategy,
            outputFormat: appStore?.outputFormat,
        },

        // Crop settings (if applicable)
        crop: appStore?.cropMode ? {
            enabled: true,
            x: appStore?.cropX,
            y: appStore?.cropY,
            width: appStore?.cropWidth,
            height: appStore?.cropHeight,
        } : {
            enabled: false,
        },

        // Tile plan
        tilePlan: appStore?.tilePlan,

        // Output info
        output: {
            format: format.extension,
            mimeType: format.mime,
            tileCount: Object.keys(blobURLs).length,
        }
    };

    // Add metadata.json to the zip
    zip.file('metadata.json', JSON.stringify(metadata, null, 2));

    // Add each blob to the zip with simple numeric names
    for (const [tileNumber, blobUrl] of Object.entries(blobURLs)) {
        try {
            const response = await fetch(blobUrl);
            const blob = await response.blob();
            zip.file(
                `${tileNumber}.${format.extension}`,
                blob,
                { binary: true }
            );
        } catch (error) {
            console.error(`Failed to add tile ${tileNumber} to ZIP:`, error);
            throw error;
        }
    }

    // Generate ZIP with compression (may be slow for large files)
    const zipBlob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 } // Balance between speed and size
    });

    // Trigger download
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}_tiles.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
