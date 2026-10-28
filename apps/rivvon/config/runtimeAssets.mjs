export const ONNX_RUNTIME_VERSION = '1.25.1';

export const runtimeAssetManifest = Object.freeze({
    onnxRuntimeJsepWasm: Object.freeze({
        sourcePath: 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm',
        objectKey: `runtime-assets/onnxruntime/${ONNX_RUNTIME_VERSION}/ort-wasm-simd-threaded.jsep.wasm`,
        localPath: `/vendor/onnxruntime/${ONNX_RUNTIME_VERSION}/ort-wasm-simd-threaded.jsep.wasm`,
        contentType: 'application/wasm',
        cacheControl: 'public, max-age=31536000, immutable',
    }),
    onnxRuntimeJsepModule: Object.freeze({
        sourcePath: 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs',
        objectKey: `runtime-assets/onnxruntime/${ONNX_RUNTIME_VERSION}/ort-wasm-simd-threaded.jsep.mjs`,
        localPath: `/vendor/onnxruntime/${ONNX_RUNTIME_VERSION}/ort-wasm-simd-threaded.jsep.mjs`,
        contentType: 'text/javascript',
        cacheControl: 'public, max-age=31536000, immutable',
    }),
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
