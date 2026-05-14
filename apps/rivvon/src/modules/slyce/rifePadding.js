export function calculatePaddedSize(width, height, alignment = 64) {
    const paddedWidth = Math.ceil(width / alignment) * alignment;
    const paddedHeight = Math.ceil(height / alignment) * alignment;
    return { paddedWidth, paddedHeight };
}

export function calculateProcessingSize(width, height, maxDimension = 1280, alignment = 64) {
    let scale = 1;

    if (width > maxDimension || height > maxDimension) {
        scale = maxDimension / Math.max(width, height);
    }

    let scaledWidth = width;
    let scaledHeight = height;

    if (scale < 1) {
        scaledWidth = Math.max(alignment, Math.floor(width * scale / alignment) * alignment);
        scaledHeight = Math.max(alignment, Math.floor(height * scale / alignment) * alignment);
    }

    const isDownscaled = scaledWidth !== width || scaledHeight !== height;
    const actualScale = isDownscaled ? Math.min(scaledWidth / width, scaledHeight / height) : 1;
    const { paddedWidth, paddedHeight } = calculatePaddedSize(scaledWidth, scaledHeight, alignment);

    return {
        originalWidth: width,
        originalHeight: height,
        scaledWidth,
        scaledHeight,
        paddedWidth,
        paddedHeight,
        scale: actualScale,
        isDownscaled,
        padRight: paddedWidth - scaledWidth,
        padBottom: paddedHeight - scaledHeight,
    };
}

export function createPaddedCanvas(imageData, paddedWidth, paddedHeight) {
    const canvas = new OffscreenCanvas(paddedWidth, paddedHeight);
    const ctx = canvas.getContext('2d');

    const srcWidth = imageData.width;
    const srcHeight = imageData.height;

    const tempCanvas = new OffscreenCanvas(srcWidth, srcHeight);
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.putImageData(imageData, 0, 0);
    ctx.drawImage(tempCanvas, 0, 0);

    const padRight = paddedWidth - srcWidth;
    const padBottom = paddedHeight - srcHeight;

    if (padRight > 0) {
        ctx.save();
        ctx.translate(srcWidth + padRight, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(
            tempCanvas,
            srcWidth - padRight, 0, padRight, srcHeight,
            0, 0, padRight, srcHeight
        );
        ctx.restore();
    }

    if (padBottom > 0) {
        ctx.save();
        ctx.translate(0, srcHeight + padBottom);
        ctx.scale(1, -1);
        ctx.drawImage(
            tempCanvas,
            0, srcHeight - padBottom, srcWidth, padBottom,
            0, 0, srcWidth, padBottom
        );
        ctx.restore();
    }

    if (padRight > 0 && padBottom > 0) {
        ctx.save();
        ctx.translate(srcWidth + padRight, srcHeight + padBottom);
        ctx.scale(-1, -1);
        ctx.drawImage(
            tempCanvas,
            srcWidth - padRight, srcHeight - padBottom, padRight, padBottom,
            0, 0, padRight, padBottom
        );
        ctx.restore();
    }

    return ctx.getImageData(0, 0, paddedWidth, paddedHeight);
}

export function cropToOriginal(imageData, targetWidth, targetHeight) {
    if (imageData.width === targetWidth && imageData.height === targetHeight) {
        return imageData;
    }

    const canvas = new OffscreenCanvas(imageData.width, imageData.height);
    const ctx = canvas.getContext('2d');
    ctx.putImageData(imageData, 0, 0);

    const croppedCanvas = new OffscreenCanvas(targetWidth, targetHeight);
    const croppedCtx = croppedCanvas.getContext('2d');
    croppedCtx.drawImage(canvas, 0, 0, targetWidth, targetHeight, 0, 0, targetWidth, targetHeight);

    return croppedCtx.getImageData(0, 0, targetWidth, targetHeight);
}

export function resizeImageData(imageData, newWidth, newHeight) {
    if (imageData.width === newWidth && imageData.height === newHeight) {
        return imageData;
    }

    const srcCanvas = new OffscreenCanvas(imageData.width, imageData.height);
    const srcCtx = srcCanvas.getContext('2d');
    srcCtx.putImageData(imageData, 0, 0);

    const dstCanvas = new OffscreenCanvas(newWidth, newHeight);
    const dstCtx = dstCanvas.getContext('2d');
    dstCtx.imageSmoothingEnabled = true;
    dstCtx.imageSmoothingQuality = 'high';
    dstCtx.drawImage(srcCanvas, 0, 0, newWidth, newHeight);

    return dstCtx.getImageData(0, 0, newWidth, newHeight);
}