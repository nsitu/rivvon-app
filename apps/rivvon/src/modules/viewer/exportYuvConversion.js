import { rgbaToBt709I420, validateSdrDimensions } from './exportColour.js';
import { createGpuYuvConversion } from './gpuYuvConversion.js';

// Instantiated only by export writers. GPU conversion still reads I420 bytes
// back to CPU memory; it does not promise direct texture import into WebCodecs.
export function createExportYuvConversion(width, height, { method = 'gpu', fullRange = false } = {}) {
    if (!['gpu', 'cpu'].includes(method)) throw new Error('Unknown YUV conversion method.');
    validateSdrDimensions(width, height, 30);
    let gpu = null, fallbackReason = null, disposed = false;
    const fallback = error => { fallbackReason = error.message; gpu?.dispose(); gpu = null; };
    if (method === 'gpu') {
        try { gpu = createGpuYuvConversion(width, height, { fullRange }); }
        catch (error) { fallback(error); }
    }
    return {
        get info() {
            return { requestedMethod: method, method: gpu ? 'gpu' : 'cpu', fallbackReason,
                readbackBytesPerFrame: gpu?.readbackBytesPerFrame ?? width * height * 4 };
        },
        convert(canvas, target) {
            if (disposed) throw new Error('YUV converter is disposed.');
            if (gpu) {
                try { return gpu.convert(canvas, target); }
                catch (error) { fallback(error); }
            }
            const context = canvas.getContext('2d');
            if (!context) throw new Error('An sRGB export compositor is required for CPU conversion.');
            return rgbaToBt709I420(context.getImageData(0, 0, width, height).data, width, height, target, { fullRange });
        },
        dispose() { if (!disposed) { disposed = true; gpu?.dispose(); } },
    };
}
