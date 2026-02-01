import { read, write } from 'ktx-parse';

/**
 * KTX2 Array Assembler
 * Assembles multiple KTX2 buffers (from parallel worker encoding)
 * into a single KTX2 array texture.
 */
export class KTX2Assembler {
    /**
     * Extract base parameters from first container
     * @private
     */
    static _extractBaseParams(container) {
        return {
            baseFormat: container.vkFormat,
            baseWidth: container.pixelWidth,
            baseHeight: container.pixelHeight,
            baseSupercompression: container.supercompressionScheme,
            baseKeyValue: container.keyValue,
            baseTypeSize: container.typeSize,
            sharedDfd: container.dataFormatDescriptor,
            firstLayerMipCount: container.levels.length
        };
    }

    /**
     * Validate layer/frame consistency with base parameters
     * @private
     */
    static _validateLayerConsistency(container, baseParams, layerIndex) {
        const { baseFormat, baseWidth, baseHeight, firstLayerMipCount } = baseParams;

        if (baseFormat !== 0 && container.vkFormat !== 0 && container.vkFormat !== baseFormat) {
            throw new Error(`Layer ${layerIndex} format mismatch: expected ${baseFormat}, got ${container.vkFormat}`);
        }
        if (container.pixelWidth !== baseWidth || container.pixelHeight !== baseHeight) {
            throw new Error(`Layer ${layerIndex} size mismatch: expected ${baseWidth}x${baseHeight}, got ${container.pixelWidth}x${container.pixelHeight}`);
        }
        if (container.levels.length !== firstLayerMipCount) {
            throw new Error(`Layer ${layerIndex} mip count mismatch: expected ${firstLayerMipCount}, got ${container.levels.length}`);
        }
    }

    // ======= MIP LEVELS ==================
    // NOTE: KTX2 specification requires array textures 
    // to store all layers for each mip level contiguously in memory.
    // This allows the GPU to efficiently access 
    // any layer at any mip level during rendering.
    // To "assemble" the mip levels means:
    // Concatenate layer data for each mip level into a single buffer
    // Apply proper padding (8-byte alignment) for uncompressed data
    // etc.

    /**
     * Assemble combined mip levels from encoded layers
     * @private
     */
    static _assembleMipLevels(encodedLayers, baseParams) {
        const { baseWidth, baseHeight, baseSupercompression } = baseParams;
        const layerCount = encodedLayers.length;
        const mipCount = encodedLayers[0].levels.length;

        // Helper: Calculate expected UASTC size for a mip level
        const uastcBytesPerImageAtLevel = (level, width, height) => {
            const wL = Math.max(1, width >> level);
            const hL = Math.max(1, height >> level);
            const blocksX = Math.ceil(wL / 4);
            const blocksY = Math.ceil(hL / 4);
            return blocksX * blocksY * 16; // 16 bytes per 4x4 block
        };

        // Helper: Calculate 8-byte alignment padding
        const pad8 = (n) => (8 - (n % 8)) % 8;

        const combinedLevels = [];

        for (let mipLevel = 0; mipLevel < mipCount; mipLevel++) {
            // Collect all layer data for this mip level
            const layersForThisMip = encodedLayers.map(layer => layer.levels[mipLevel]);

            // For NONE supercompression, calculate exact size with padding
            const exactSize = uastcBytesPerImageAtLevel(mipLevel, baseWidth, baseHeight);
            const perImagePadding = pad8(exactSize);
            const perImageWithPad = exactSize + perImagePadding;

            // Calculate total size including padding
            const totalSize = baseSupercompression === 0
                ? perImageWithPad * layerCount
                : layersForThisMip.reduce((sum, l) => sum + l.levelData.byteLength, 0);

            const combined = new Uint8Array(totalSize);
            let offset = 0;

            // Concatenate layer data with proper trimming and padding
            for (const levelData of layersForThisMip) {
                const srcData = new Uint8Array(levelData.levelData);

                if (baseSupercompression === 0) {
                    // NONE: Trim to exact UASTC size and add 8-byte padding
                    const trimmed = srcData.subarray(0, exactSize);
                    combined.set(trimmed, offset);
                    offset += trimmed.byteLength;

                    // Add padding (already zeros from initialization)
                    if (perImagePadding > 0) {
                        offset += perImagePadding;
                    }
                } else {
                    // ZSTD: Keep compressed bytes as-is
                    combined.set(srcData, offset);
                    offset += srcData.byteLength;
                }
            }

            // Calculate total uncompressed size for this mip across all layers
            const totalUncompressed = baseSupercompression === 0
                ? totalSize
                : layersForThisMip.reduce((sum, l) => sum + l.uncompressedByteLength, 0);

            combinedLevels.push({
                levelData: combined,
                uncompressedByteLength: totalUncompressed
            });
        }

        return combinedLevels;
    }

    /**
     * Create final KTX2 array container
     * @private
     */
    static _createArrayContainer(encodedLayers, baseParams, combinedLevels) {
        return {
            vkFormat: baseParams.baseFormat,
            typeSize: baseParams.baseTypeSize,
            pixelWidth: baseParams.baseWidth,
            pixelHeight: baseParams.baseHeight,
            pixelDepth: 0,
            layerCount: encodedLayers.length,
            faceCount: 1,
            levelCount: combinedLevels.length,
            supercompressionScheme: baseParams.baseSupercompression,
            levels: combinedLevels,
            dataFormatDescriptor: baseParams.sharedDfd,
            keyValue: baseParams.baseKeyValue || {},
            globalData: null
        };
    }




    /**
     * Encode multiple RGBA frames using an existing worker pool (for reuse across multiple tiles)
     * @param {KTX2WorkerPool} workerPool - Existing worker pool to use
     * @param {Array} frames - Array of {rgba: Uint8Array, width: number, height: number} objects
     * @param {Function} [onProgress] - Progress callback function(layersEncoded, totalLayers)
     * @returns {Promise<ArrayBuffer>} - KTX2 file buffer with layered texture
     */
    static async encodeParallelWithPool(workerPool, frames, onProgress = null) {
        console.log(`[Parallel Array Encoder] Starting parallel encoding with existing worker pool...`);
        const startTime = performance.now();

        if (!frames || frames.length === 0) {
            throw new Error('No frames provided');
        }

        if (!workerPool) {
            throw new Error('Worker pool is required');
        }

        // Encode all frames in parallel using the existing pool
        const encodedFramesData = await workerPool.encodeAllFrames(frames, (completed, total, data) => {
            if (onProgress) {
                onProgress(completed, total);
            }
        });

        console.log(`[Parallel] All ${encodedFramesData.length} frames encoded. Assembling array texture...`);

        // Now process the encoded buffers sequentially to build the final KTX2
        const encodedLayers = [];
        let baseParams = null;

        for (let i = 0; i < encodedFramesData.length; i++) {
            const ktx2Buffer = encodedFramesData[i].buffer;

            // Parse KTX2 to extract compressed data
            const container = read(new Uint8Array(ktx2Buffer));

            // Validate consistency across layers
            if (i === 0) {
                baseParams = this._extractBaseParams(container);
            } else {
                this._validateLayerConsistency(container, baseParams, i);
            }

            // Extract all mip levels for this layer
            const layerLevels = container.levels.map(level => ({
                levelData: level.levelData,
                uncompressedByteLength: level.uncompressedByteLength
            }));

            encodedLayers.push({
                levels: layerLevels,
                format: container.vkFormat,
                width: container.pixelWidth,
                height: container.pixelHeight
            });

            // Help GC reclaim memory
            container.levels = null;
        }

        // Force array texture when only a single layer was produced by duplicating the encoded bytes.
        if (encodedLayers.length === 1) {
            console.warn('[KTX2] Single layer detected — duplicating layer to force array texture (three.js compatibility).');
            const layer = encodedLayers[0];
            const duplicate = {
                levels: layer.levels.map(l => ({
                    levelData: l.levelData,
                    uncompressedByteLength: l.uncompressedByteLength
                })),
                format: layer.format,
                width: layer.width,
                height: layer.height
            };
            encodedLayers.push(duplicate);
        }

        // Assemble combined mip levels and create container
        const combinedLevels = this._assembleMipLevels(encodedLayers, baseParams);
        const arrayContainer = this._createArrayContainer(encodedLayers, baseParams, combinedLevels);

        // Write final KTX2 file
        const finalBuffer = write(arrayContainer);

        const endTime = performance.now();
        const duration = (endTime - startTime).toFixed(2);
        console.log(`[Parallel Array Encoder] Complete: ${finalBuffer.byteLength} bytes, ${encodedLayers.length} layers, ${combinedLevels.length} mips, ${duration}ms`);

        return finalBuffer;
    }
}
