/**
 * Contour Inference Worker
 *
 * Runs U2Net salient-object detection via onnxruntime-web and returns a
 * min-max normalised alpha map as a flat Uint8ClampedArray (maskWidth × maskHeight).
 * Values are in the 0–255 range — thresholding is done in contourInference.js.
 *
 * Supported messages (postMessage to worker):
 *   { type: 'infer', id, imageData }
 *     imageData: { data: Uint8ClampedArray, width, height }  (RGBA)
 *
 * Responses (postMessage from worker):
 *   { type: 'infer-result', id, alpha, maskWidth, maskHeight }
 *   { type: 'infer-error', id, error }
 */

const MODEL_INPUT_SIZE = 320;
const MEAN = [0.485, 0.456, 0.406];
const STD  = [0.229, 0.224, 0.225];
const MODEL_PATH = `${import.meta.env.BASE_URL || '/'}u2net.quant.onnx`;

let sessionPromise = null;

async function getSession() {
    if (sessionPromise) return sessionPromise;

    sessionPromise = (async () => {
        const ort = await import('onnxruntime-web');
        ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1/dist/';
        ort.env.wasm.numThreads = 1;

        const session = await ort.InferenceSession.create(MODEL_PATH, {
            executionProviders: ['wasm'],
        });

        return { ort, session };
    })();

    return sessionPromise;
}

/**
 * Resize source RGBA data to MODEL_INPUT_SIZE × MODEL_INPUT_SIZE using
 * OffscreenCanvas for high-quality bicubic interpolation (matches reference impl).
 */
async function resizeWithOffscreenCanvas(data, srcW, srcH) {
    const srcCanvas = new OffscreenCanvas(srcW, srcH);
    const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });
    srcCtx.putImageData(new ImageData(data, srcW, srcH), 0, 0);

    const dstCanvas = new OffscreenCanvas(MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
    const dstCtx = dstCanvas.getContext('2d', { willReadFrequently: true });
    dstCtx.imageSmoothingEnabled = true;
    dstCtx.imageSmoothingQuality = 'high';
    dstCtx.drawImage(srcCanvas, 0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);

    return dstCtx.getImageData(0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE).data;
}

/**
 * Convert RGBA pixel data to normalised Float32 CHW tensor (ImageNet stats).
 */
function rgbaToNormalisedCHW(rgba, size) {
    const n = size * size;
    const tensor = new Float32Array(3 * n);

    for (let i = 0; i < n; i++) {
        const off = i * 4;
        tensor[i]         = (rgba[off]     / 255 - MEAN[0]) / STD[0]; // R
        tensor[n + i]     = (rgba[off + 1] / 255 - MEAN[1]) / STD[1]; // G
        tensor[2 * n + i] = (rgba[off + 2] / 255 - MEAN[2]) / STD[2]; // B
    }

    return tensor;
}

/**
 * Min-max normalise raw model output floats to 0–255 byte range.
 * This stretches contrast so that even low-confidence foreground regions
 * survive the downstream threshold (MASK_THRESHOLD = 160).
 */
function normalizeToByteAlpha(values) {
    let min = Infinity;
    let max = -Infinity;

    for (const v of values) {
        if (v < min) min = v;
        if (v > max) max = v;
    }

    const range = max - min || 1;
    const alpha = new Uint8ClampedArray(values.length);

    for (let i = 0; i < values.length; i++) {
        alpha[i] = ((values[i] - min) / range) * 255;
    }

    return alpha;
}

async function runInference(imageData) {
    const { ort, session } = await getSession();
    const { data, width, height } = imageData;

    const resizedRGBA = await resizeWithOffscreenCanvas(data, width, height);
    const chw = rgbaToNormalisedCHW(resizedRGBA, MODEL_INPUT_SIZE);

    const tensor = new ort.Tensor('float32', chw, [1, 3, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE]);
    const feeds = { [session.inputNames[0]]: tensor };
    const results = await session.run(feeds);

    const outputData = results[session.outputNames[0]].data;
    return normalizeToByteAlpha(outputData);
}

self.onmessage = async (event) => {
    const { type, id, imageData } = event.data;

    if (type === 'preload') {
        try {
            await getSession();
            self.postMessage({ type: 'preload-complete', id });
        } catch (err) {
            self.postMessage({ type: 'preload-error', id, error: String(err?.message ?? err) });
        }
        return;
    }

    if (type !== 'infer') return;

    try {
        const alpha = await runInference(imageData);
        self.postMessage(
            { type: 'infer-result', id, alpha, maskWidth: MODEL_INPUT_SIZE, maskHeight: MODEL_INPUT_SIZE },
            [alpha.buffer]
        );
    } catch (err) {
        self.postMessage({ type: 'infer-error', id, error: String(err?.message ?? err) });
    }
};
