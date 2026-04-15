let basisModule = null;
let basisInitPromise = null;

const RGBA32_TRANSCODER_FORMAT = 13;
const DEFAULT_FACE_INDEX = 0;

const activeJobs = new Map();

function createWorkerError(error) {
    if (error instanceof Error) {
        return {
            message: error.message,
            stack: error.stack,
            name: error.name
        };
    }

    return {
        message: typeof error === 'string' ? error : String(error),
        stack: null,
        name: 'Error'
    };
}

function getBasisFormat(ktx2File) {
    if (ktx2File.isUASTC()) return 'uastc';
    if (ktx2File.isETC1S()) return 'etc1s';
    if (typeof ktx2File.isHDR === 'function' && ktx2File.isHDR()) return 'uastc-hdr';
    return 'unknown';
}

function cleanupJob(jobId) {
    const job = activeJobs.get(jobId);
    if (!job) return;

    try {
        job.ktx2File.close();
    } catch (error) {
        console.warn('[KTX2 Transcode Worker] close() failed:', error);
    }

    try {
        job.ktx2File.delete();
    } catch (error) {
        console.warn('[KTX2 Transcode Worker] delete() failed:', error);
    }

    activeJobs.delete(jobId);
}

async function loadBasisTranscoderInWorker() {
    if (basisInitPromise) {
        return basisInitPromise;
    }

    basisInitPromise = (async () => {
        const basePath = import.meta.env.BASE_URL || '/';
        const scriptPath = `${basePath}wasm/basis_transcoder.js`;

        const response = await fetch(scriptPath);
        if (!response.ok) {
            throw new Error(`Failed to fetch ${scriptPath}: ${response.statusText}`);
        }

        const scriptText = await response.text();
        (0, eval)(scriptText);

        if (typeof BASIS === 'undefined') {
            throw new Error('BASIS is not defined after loading basis_transcoder.js');
        }

        const module = await BASIS({
            locateFile: (path, scriptDirectory) => {
                if (path.endsWith('.wasm')) {
                    return `${basePath}wasm/${path}`;
                }

                return scriptDirectory + path;
            },
            onAbort: (what) => {
                console.error('[KTX2 Transcode Worker] BASIS transcoder aborted:', what);
            }
        });

        if (!module.initializeBasis) {
            throw new Error('initializeBasis is not available on the Basis transcoder module');
        }

        module.initializeBasis();

        if (!module.KTX2File) {
            throw new Error('KTX2File is not available on the Basis transcoder module');
        }

        basisModule = module;
        return module;
    })();

    return basisInitPromise;
}

async function handleOpenFile({ jobId, buffer }) {
    const module = await loadBasisTranscoderInWorker();
    const sourceBytes = new Uint8Array(buffer);
    const ktx2File = new module.KTX2File(sourceBytes);

    if (!ktx2File.isValid()) {
        ktx2File.close();
        ktx2File.delete();
        throw new Error('Invalid or unsupported KTX2 file');
    }

    const width = ktx2File.getWidth();
    const height = ktx2File.getHeight();
    const layerCount = ktx2File.getLayers() || 1;
    const levelCount = ktx2File.getLevels();
    const faceCount = ktx2File.getFaces();
    const hasAlpha = ktx2File.getHasAlpha();
    const basisFormat = getBasisFormat(ktx2File);

    if (!width || !height || !levelCount) {
        ktx2File.close();
        ktx2File.delete();
        throw new Error('Invalid KTX2 dimensions or mip metadata');
    }

    if (faceCount !== 1) {
        ktx2File.close();
        ktx2File.delete();
        throw new Error(`Unsupported face count for local variant derivation: ${faceCount}`);
    }

    if (basisFormat === 'uastc-hdr') {
        ktx2File.close();
        ktx2File.delete();
        throw new Error('UASTC HDR textures are not supported by the local RGBA32 variant derivation pipeline');
    }

    if (!ktx2File.startTranscoding()) {
        ktx2File.close();
        ktx2File.delete();
        throw new Error('startTranscoding() failed');
    }

    activeJobs.set(jobId, {
        ktx2File,
        width,
        height,
        layerCount,
        levelCount,
        faceCount,
        hasAlpha,
        basisFormat,
        sourceByteLength: sourceBytes.byteLength
    });

    return {
        jobId,
        width,
        height,
        layerCount,
        levelCount,
        faceCount,
        hasAlpha,
        basisFormat,
        sourceByteLength: sourceBytes.byteLength
    };
}

async function handleDecodeLayer({ jobId, layerIndex, mipLevel = 0 }) {
    const job = activeJobs.get(jobId);
    if (!job) {
        throw new Error(`No active KTX2 decode job found for ${jobId}`);
    }

    if (layerIndex < 0 || layerIndex >= job.layerCount) {
        throw new Error(`Layer index ${layerIndex} is out of range for layerCount=${job.layerCount}`);
    }

    if (mipLevel < 0 || mipLevel >= job.levelCount) {
        throw new Error(`Mip level ${mipLevel} is out of range for levelCount=${job.levelCount}`);
    }

    const levelInfo = job.ktx2File.getImageLevelInfo(mipLevel, layerIndex, DEFAULT_FACE_INDEX);
    const width = levelInfo.origWidth || levelInfo.width;
    const height = levelInfo.origHeight || levelInfo.height;
    const outputByteLength = job.ktx2File.getImageTranscodedSizeInBytes(
        mipLevel,
        layerIndex,
        DEFAULT_FACE_INDEX,
        RGBA32_TRANSCODER_FORMAT
    );

    const rgba = new Uint8Array(outputByteLength);
    const success = job.ktx2File.transcodeImage(
        rgba,
        mipLevel,
        layerIndex,
        DEFAULT_FACE_INDEX,
        RGBA32_TRANSCODER_FORMAT,
        0,
        -1,
        -1
    );

    if (!success) {
        throw new Error(`transcodeImage() failed for layer ${layerIndex}, mip ${mipLevel}`);
    }

    return {
        jobId,
        layerIndex,
        mipLevel,
        width,
        height,
        rgbaByteLength: rgba.byteLength,
        buffer: rgba.buffer
    };
}

self.onmessage = async (event) => {
    const { type, requestId, data } = event.data;

    try {
        switch (type) {
            case 'OPEN_FILE': {
                const payload = await handleOpenFile(data);
                self.postMessage({ type: 'OPEN_FILE_DONE', requestId, data: payload });
                break;
            }
            case 'DECODE_LAYER': {
                const payload = await handleDecodeLayer(data);
                self.postMessage(
                    { type: 'DECODE_LAYER_DONE', requestId, data: payload },
                    [payload.buffer]
                );
                break;
            }
            case 'CLOSE_FILE': {
                cleanupJob(data.jobId);
                self.postMessage({ type: 'CLOSE_FILE_DONE', requestId, data: { jobId: data.jobId } });
                break;
            }
            default:
                throw new Error(`Unknown worker message type: ${type}`);
        }
    } catch (error) {
        self.postMessage({
            type: 'ERROR',
            requestId,
            error: createWorkerError(error)
        });
    }
};