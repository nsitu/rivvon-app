export const runtimeAssetManifest = Object.freeze({
    ffmpegCoreWasm: Object.freeze({
        sourcePath: 'node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm',
        objectKey: 'runtime-assets/ffmpeg/0.12.10/ffmpeg-core.wasm',
        localPath: '/vendor/ffmpeg/0.12.10/ffmpeg-core.wasm',
        contentType: 'application/wasm',
        cacheControl: 'public, max-age=31536000, immutable',
    }),
    rife422Model: Object.freeze({
        sourcePath: 'runtime-assets/source/models/rife422_v2_ensembleFalse_op20_clamp.onnx',
        objectKey: 'runtime-assets/models/rife422_v2_ensembleFalse_op20_clamp/rife422_v2_ensembleFalse_op20_clamp.onnx',
        localPath: '/rife422_v2_ensembleFalse_op20_clamp.onnx',
        contentType: 'application/octet-stream',
        cacheControl: 'public, max-age=31536000, immutable',
    }),
    u2netModel: Object.freeze({
        sourcePath: 'runtime-assets/source/models/u2net.quant.onnx.br',
        localSourcePath: 'runtime-assets/source/models/u2net.quant.onnx',
        objectKey: 'runtime-assets/models/u2net.quant/u2net.quant.onnx',
        localPath: '/u2net.quant.onnx',
        contentType: 'application/octet-stream',
        contentEncoding: 'br',
        cacheControl: 'public, max-age=31536000, immutable',
    }),
});

export function getRuntimeAssetEntries() {
    return Object.entries(runtimeAssetManifest).map(([assetId, entry]) => ({
        assetId,
        ...entry,
    }));
}
