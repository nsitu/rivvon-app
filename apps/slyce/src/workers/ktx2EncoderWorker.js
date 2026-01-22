// We can't use getBasisModule() in a worker because it relies on the main thread's module
// Instead, we need to load BASIS directly in the worker context

let basisModule = null;

async function loadBasisInWorker() {
    if (basisModule) {
        return basisModule;
    }

    console.log('[KTX2 Worker] Loading BASIS module in worker context...');

    // Module workers can't use importScripts(), so we fetch and eval instead
    // We use the single-threaded encoder (see /public/wasm/readme.md for architecture explanation)
    // Use import.meta.env.BASE_URL to handle both local dev and GitHub Pages deployment
    const basePath = import.meta.env.BASE_URL || '/';
    const scriptPath = `${basePath}wasm/basis_encoder.js`;

    try {
        // Fetch the script as text
        const response = await fetch(scriptPath);
        if (!response.ok) {
            throw new Error(`Failed to fetch ${scriptPath}: ${response.statusText}`);
        }

        const scriptText = await response.text();
        console.log(`[KTX2 Worker] Script fetched (${scriptText.length} bytes), evaluating...`);

        // Evaluate the script in global scope
        // This adds the BASIS() function to the global scope
        (0, eval)(scriptText);

        if (typeof BASIS === 'undefined') {
            throw new Error('BASIS not defined after eval');
        }

        console.log('[KTX2 Worker] BASIS script loaded, initializing module...');

        // Initialize the module
        const moduleConfig = {
            // Tell BASIS where to find its WASM file
            locateFile: (path, scriptDirectory) => {
                // The WASM files are in /wasm/ directory
                if (path.endsWith('.wasm')) {
                    return `${basePath}wasm/${path}`;
                }
                return scriptDirectory + path;
            },
            onRuntimeInitialized: () => {
                console.log('[KTX2 Worker] BASIS runtime initialized');
            },
            onAbort: (what) => {
                console.error('[KTX2 Worker] BASIS aborted:', what);
            }
        };

        const module = await BASIS(moduleConfig);

        if (!module.initializeBasis) {
            throw new Error('initializeBasis not available');
        }

        console.log('[KTX2 Worker] Calling initializeBasis()...');
        module.initializeBasis();
        console.log('[KTX2 Worker] Basis initialized successfully');

        basisModule = module;
        return module;

    } catch (error) {
        console.error('[KTX2 Worker] Failed to load BASIS:', error);
        throw error;
    }
}

// Initialize BASIS module when worker starts
let initPromise = loadBasisInWorker();

self.onmessage = async (e) => {
    const { type, data } = e.data;

    if (type === 'ENCODE_FRAME') {
        try {
            // Wait for BASIS to be initialized if not already
            const Module = await initPromise;
            const { BasisEncoder } = Module;

            const { rgba, width, height, frameIndex } = data;

            // Create encoder instance for this frame
            const basisEncoder = new BasisEncoder();

            // Single-threaded mode (parallelism is managed by the worker pool)
            basisEncoder.controlThreading(false, 1);

            // Set up encoding buffer
            const bufferSize = Math.max(1024 * 1024, width * height * 2);
            const ktx2FileData = new Uint8Array(bufferSize);

            // Set source image
            basisEncoder.setSliceSourceImage(
                0,
                rgba,
                width,
                height,
                Module.ldr_image_type.cRGBA32.value
            );

            // Configure settings (matching KTX2Encoder defaults)
            basisEncoder.setCreateKTX2File(true);
            basisEncoder.setKTX2UASTCSupercompression(false);
            basisEncoder.setKTX2SRGBTransferFunc(true);
            basisEncoder.setFormatMode(1); // UASTC LDR 4x4
            basisEncoder.setPerceptual(true);
            basisEncoder.setMipSRGB(true);
            basisEncoder.setRDOUASTC(false);
            basisEncoder.setMipGen(true);
            basisEncoder.setPackUASTCFlags(1);

            // Encode
            const startTime = performance.now();
            const numOutputBytes = basisEncoder.encode(ktx2FileData);
            const elapsed = performance.now() - startTime;

            // Clean up encoder
            basisEncoder.delete();

            if (numOutputBytes === 0) {
                throw new Error('Encoding returned 0 bytes');
            }

            // Extract actual data
            const actualKTX2FileData = new Uint8Array(ktx2FileData.buffer, 0, numOutputBytes);

            // Send back the encoded data
            self.postMessage({
                type: 'FRAME_DONE',
                data: {
                    frameIndex,
                    buffer: actualKTX2FileData.buffer,
                    size: numOutputBytes,
                    elapsed
                }
            }, [actualKTX2FileData.buffer]);

        } catch (error) {
            console.error('[KTX2 Worker] Encoding failed:', error);
            self.postMessage({
                type: 'ERROR',
                error: error.message,
                frameIndex: data.frameIndex
            });
        }
    }
};
