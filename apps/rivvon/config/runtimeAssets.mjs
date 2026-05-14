export const runtimeAssetManifest = Object.freeze({
    rife422Model: Object.freeze({
        sourcePath: 'runtime-assets/source/models/rife422_v2_ensembleFalse_op20_clamp.onnx',
        objectKey: 'runtime-assets/models/rife422_v2_ensembleFalse_op20_clamp/rife422_v2_ensembleFalse_op20_clamp.onnx',
        localPath: '/rife422_v2_ensembleFalse_op20_clamp.onnx',
        contentType: 'application/octet-stream',
        cacheControl: 'public, max-age=31536000, immutable',
    }),
    u2netModelZip: Object.freeze({
        sourcePath: 'runtime-assets/source/models/u2net.quant.onnx.zip',
        objectKey: 'runtime-assets/models/u2net.quant/u2net.quant.onnx.zip',
        localPath: '/u2net.quant.onnx.zip',
        contentType: 'application/zip',
        cacheControl: 'public, max-age=31536000, immutable',
    }),
});

export function getRuntimeAssetEntries() {
    return Object.entries(runtimeAssetManifest).map(([assetId, entry]) => ({
        assetId,
        ...entry,
    }));
}
