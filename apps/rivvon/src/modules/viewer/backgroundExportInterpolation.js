import { DataArrayTexture, LinearFilter } from 'three';
import { Ktx2TranscodeWorkerClient } from '../slyce/ktx2TranscodeWorkerClient.js';

const ENDPOINT_EPSILON = 1e-7;

function throwIfAborted(signal) {
    if (signal?.aborted) throw new DOMException('Background interpolation cancelled.', 'AbortError');
}

/** Export-owned pixels only: never replace the TileManager's ribbon textures. */
export function createBackgroundExportInterpolation({
    tileManager,
    signal,
    onStatus,
    createDecoder = () => new Ktx2TranscodeWorkerClient(),
    createInterpolator = async () => {
        const { RIFEInterpolator } = await import('../slyce/rifeInterpolator.js');
        return new RIFEInterpolator();
    },
}) {
    let decoder = null;
    let interpolator = null;
    let disposed = false;
    const jobs = new Map();
    const textures = [];

    function checkActive() {
        throwIfAborted(signal);
        if (disposed) throw new Error('Background interpolation has been disposed.');
    }

    async function getJob(tileIndex) {
        if (jobs.has(tileIndex)) return jobs.get(tileIndex);
        const bytes = tileManager.zipFiles?.[`${tileIndex}.ktx2`];
        let buffer;
        if (bytes?.byteLength) {
            // openFile transfers its argument. Retain the application's source bytes.
            buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        } else if (!tileManager.isZip && tileManager.folder) {
            const response = await fetch(`${tileManager.folder}/${tileIndex}.ktx2`, { signal });
            if (!response.ok) throw new Error(`Unable to load background tile ${tileIndex}: ${response.status}`);
            buffer = await response.arrayBuffer();
        } else {
            throw new Error(`Source KTX2 bytes for background tile ${tileIndex} are unavailable. Reload the texture or select Crossfade.`);
        }
        checkActive();
        decoder ??= createDecoder();
        const id = `background-${tileIndex}`;
        const meta = await decoder.openFile(id, buffer);
        const job = { id, meta, layers: new Map() };
        jobs.set(tileIndex, job);
        checkActive();
        if (meta.hasAlpha || meta.basisFormat === 'uastc-hdr') {
            throw new Error('Motion interpolation requires opaque SDR background textures. Select Crossfade for this texture.');
        }
        return job;
    }

    async function getLayer(job, layer) {
        if (!job.layers.has(layer)) {
            const decoded = await decoder.decodeLayer(job.id, layer);
            checkActive();
            job.layers.set(layer, new ImageData(new Uint8ClampedArray(decoded.buffer), decoded.width, decoded.height));
        }
        return job.layers.get(layer);
    }

    function upload(slot, image, sourceTexture) {
        let texture = textures[slot];
        if (!texture || texture.image.width !== image.width || texture.image.height !== image.height) {
            texture?.dispose();
            texture = new DataArrayTexture(new Uint8Array(image.data.length), image.width, image.height, 1);
            texture.minFilter = sourceTexture.minFilter ?? LinearFilter;
            texture.magFilter = sourceTexture.magFilter ?? LinearFilter;
            // Match the source's minification support. WebGPU samples available
            // mip levels even when the texture's minFilter is plain LinearFilter.
            texture.generateMipmaps = sourceTexture.generateMipmaps === true || sourceTexture.mipmaps?.length > 1;
            texture.wrapS = sourceTexture.wrapS;
            texture.wrapT = sourceTexture.wrapT;
            texture.anisotropy = sourceTexture.anisotropy;
            texture.flipY = false;
            textures[slot] = texture;
        }
        texture.colorSpace = sourceTexture.colorSpace;
        texture.image.data.set(image.data);
        texture.needsUpdate = true;
        return texture;
    }

    return {
        async prepareFrame(frame) {
            checkActive();
            if (!frame.currentTexture) return frame;
            const blend = Math.max(0, Math.min(1, frame.layerBlend));
            const atStart = blend < ENDPOINT_EPSILON || frame.currentLayer === frame.nextLayer;
            const atEnd = 1 - blend < ENDPOINT_EPSILON;
            const layers = atStart ? [frame.currentLayer] : atEnd ? [frame.nextLayer] : [frame.currentLayer, frame.nextLayer];
            const tileIndices = [...new Set([
                frame.currentSample.tileIndex,
                ...(frame.flowActive ? [frame.nextSample.tileIndex] : []),
            ])];
            // At most two open containers and two decoded layers per container.
            for (const [index, job] of jobs) {
                if (!tileIndices.includes(index)) {
                    await decoder.closeFile(job.id);
                    jobs.delete(index);
                } else {
                    for (const layer of job.layers.keys()) if (!layers.includes(layer)) job.layers.delete(layer);
                }
            }
            const outputs = new Map();
            for (const [slot, tileIndex] of tileIndices.entries()) {
                checkActive();
                const job = await getJob(tileIndex);
                const first = await getLayer(job, layers[0]);
                let result = first;
                if (layers.length === 2) {
                    const second = await getLayer(job, layers[1]);
                    if (!interpolator) {
                        onStatus?.('Loading background motion interpolation…');
                        interpolator = await createInterpolator();
                        await interpolator.init();
                        checkActive();
                        if (!interpolator.supportsExplicitTimestep()) {
                            throw new Error('The background interpolation model must support arbitrary timesteps.');
                        }
                    }
                    onStatus?.(`Interpolating background (${interpolator.activeExecutionProvider || 'RIFE'})…`);
                    result = await interpolator.interpolateImageData(first, second, blend);
                    // Let cancel input run even when WASM completes on the UI thread.
                    await new Promise(resolve => setTimeout(resolve, 0));
                    checkActive();
                }
                const source = tileIndex === frame.currentSample.tileIndex ? frame.currentTexture : frame.nextTexture;
                outputs.set(tileIndex, upload(slot, result, source));
            }
            const currentTexture = outputs.get(frame.currentSample.tileIndex);
            return {
                ...frame,
                currentTexture,
                nextTexture: outputs.get(frame.nextSample.tileIndex) || currentTexture,
                currentLayer: 0, nextLayer: 0, layerBlend: 0,
            };
        },
        async dispose() {
            disposed = true;
            decoder?.terminate();
            decoder = null;
            jobs.clear();
            for (const texture of textures) texture.dispose();
            textures.length = 0;
            await interpolator?.reset();
            interpolator = null;
        },
    };
}
