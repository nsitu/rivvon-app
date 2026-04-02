const CANVAS_2D_CTX_CACHE_KEY = '__rivvonSlyce2dCtx';

export function getCached2dContext(canvas) {
    let ctx = canvas?.[CANVAS_2D_CTX_CACHE_KEY] ?? null;
    if (!ctx && canvas?.getContext) {
        ctx = canvas.getContext('2d');
        if (ctx) {
            canvas[CANVAS_2D_CTX_CACHE_KEY] = ctx;
        }
    }
    return ctx;
}

export function readCanvasSetImages(canvasSet) {
    if (!Array.isArray(canvasSet) || canvasSet.length === 0) {
        throw new Error('Completed tile is missing its canvas set.');
    }

    return canvasSet.map(canvas => {
        const ctx = getCached2dContext(canvas);
        if (!ctx) {
            throw new Error('Unable to acquire a 2D canvas context for tile readback.');
        }

        const { width, height } = canvas;
        const imageData = ctx.getImageData(0, 0, width, height);
        return {
            rgba: imageData.data,
            width,
            height
        };
    });
}

export async function consumeSamplingSource({
    source,
    signal = null,
    onItem,
    onAbortItem = null,
    onError = null
}) {
    if (!source || typeof onItem !== 'function') {
        throw new Error('consumeSamplingSource requires a source and an onItem handler.');
    }

    try {
        for await (const item of source) {
            if (signal?.aborted) {
                if (typeof onAbortItem === 'function') {
                    await onAbortItem(item);
                }
                break;
            }

            const shouldContinue = await onItem(item);
            if (shouldContinue === false) {
                break;
            }
        }
    } catch (error) {
        if (typeof onError === 'function') {
            const handled = await onError(error);
            if (handled === true) {
                return;
            }
        }

        throw error;
    }
}