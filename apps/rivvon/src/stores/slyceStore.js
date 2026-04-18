// src/stores/slyceStore.js
// Pinia store for Slyce texture builder state

import { defineStore } from 'pinia';
import { abortProcessing } from '../modules/slyce/videoProcessor';
import { createLocalSaveState, createObjectLocalSaveController } from '../modules/slyce/localSaveController.js';
import { createPublishState, createObjectPublishController } from '../modules/slyce/publishController.js';

export const useSlyceStore = defineStore('slyce', {
    state: () => ({
        config: {},
        frameCount: 0,
        frameStart: 1,       // Start frame of range (1-indexed)
        frameEnd: 0,         // End frame of range (0 = unset; defaults to frameCount)
        frameNumber: 0,
        crossSectionCount: 60,
        crossSectionType: 'waves', // planes, waves
        samplingSide: 'long',       // long, short — resolved to rows/columns via samplingAxis getter
        // tileMode removed — always 'tile' by convention (full-size mode unused)
        potResolution: 256,             // 32, 64, 128, 256, 512, 1024
        autoDeriveResolutions: [],      // optional lower-resolution family variants to auto-generate after root encode
        publishDestination: 'google-drive',
        downsampleStrategy: 'upfront', // always upfront — see docs/downsampling-strategy.md
        // outputMode removed — always 'rows' by convention (rotation handled at render time if needed)
        readerIsFinished: false,
        fileInfo: null,
        textureName: '',
        textureDescription: '',
        samplePixelCount: 0, /** equals width or height depending on samplingSide */
        messages: [],
        status: {},

        fpsNow: 0,          // current FPS measurement
        timestamps: [],     // store recent frame timestamps
        lastFPSUpdate: 0,   // helps ensure we don't recalc FPS too often

        currentStep: '1',
        tilePlan: {},

        // KTX2 blob URLs
        ktx2BlobURLs: {},

        // KTX2 playback state
        ktx2Playback: {
            currentLayer: 0,      // current layer index (0 to layerCount-1)
            layerCount: 0,        // total layers in texture array
            isPlaying: false,     // play/pause state
            fps: 30,              // playback speed (layers per second)
            direction: 1,         // 1 = forward, -1 = reverse (for ping-pong mode)
        },

        // Renderer type selection (set during app initialization)
        rendererType: 'webgl',    // 'webgl' | 'webgpu' (determined at runtime)

        // Cropping state
        cropMode: false,          // true = crop to region, false = entire frame
        cropX: 0,                 // Left offset from original (pixels)
        cropY: 0,                 // Top offset from original (pixels)
        cropWidth: null,          // Cropped width (null = full width)
        cropHeight: null,         // Cropped height (null = full height)

        // Thumbnail blob for CDN upload (captured during processing)
        thumbnailBlob: null,

        // File-mode local persistence state
        ...createLocalSaveState(),

        // File-mode cloud publication state
        ...createPublishState(),

        // Resource management — when true, fully dispose viewer GPU context during processing
        freeGpuResources: true,

        // Reference to active TileSnapshotPreview instance (set by TilePreview.vue)
        tileSnapshotPreview: null,

        // Per-tile preview blob URLs keyed by tile index (set by TileSnapshotPreview)
        tilePreviewUrls: {},
    }),
    actions: {
        set(key, value) {
            this[key] = value;
        },
        log(message) {
            this.messages.push(message);
        },
        // Register KTX2 blob URL and revoke any previous URL for same tile
        registerBlobURL(tileNumber, blob) {
            // Revoke previous URL if exists
            if (this.ktx2BlobURLs[tileNumber]) {
                URL.revokeObjectURL(this.ktx2BlobURLs[tileNumber]);
            }
            this.ktx2BlobURLs[tileNumber] = URL.createObjectURL(blob);
        },
        // Set a tile preview blob URL (from TileSnapshotPreview)
        setTilePreviewUrl(tileIndex, blobUrl) {
            this.tilePreviewUrls[tileIndex] = blobUrl;
        },
        // Revoke all KTX2 blob URLs
        revokeBlobURLs() {
            Object.values(this.ktx2BlobURLs).forEach(url => {
                if (url) URL.revokeObjectURL(url);
            });
            this.ktx2BlobURLs = {};
        },
        setStatus(key, value) {
            this.status[key] = value;
        },
        removeStatus(key) {
            delete this.status[key];
        },
        clearAllStatus() {
            this.status = {};
        },
        getLocalSaveController() {
            return createObjectLocalSaveController(this);
        },
        getPublishController() {
            return createObjectPublishController(this);
        },
        resetLocalSaveState() {
            return this.getLocalSaveController().resetLocalSaveState();
        },
        resetPublishState() {
            return this.getPublishController().resetPublishState();
        },
        beginLocalSave() {
            return this.getLocalSaveController().beginLocalSave();
        },
        cancelLocalSave() {
            return this.getLocalSaveController().cancelLocalSave();
        },
        // Partial reset - clears processing results but keeps video and settings
        resetProcessing() {
            // Abort any ongoing processing
            abortProcessing();

            // Revoke all KTX2 blob URLs before clearing
            Object.values(this.ktx2BlobURLs).forEach(url => {
                if (url) URL.revokeObjectURL(url);
            });

            // Reset only processing-related state (preserve file, fileInfo, settings)
            this.currentStep = '2';
            this.frameNumber = 0;
            this.readerIsFinished = false;
            this.messages = [];
            this.status = {};
            this.fpsNow = 0;
            this.timestamps = [];
            this.lastFPSUpdate = 0;
            this.ktx2BlobURLs = {};
            this.thumbnailBlob = null;
            this.resetLocalSaveState();
            this.resetPublishState();
            this.ktx2Playback = {
                currentLayer: 0,
                layerCount: 0,
                isPlaying: false,
                fps: 30,
                direction: 1,
            };
        },
        reset() {
            // Abort any ongoing processing
            abortProcessing();

            // Revoke all KTX2 blob URLs before clearing
            Object.values(this.ktx2BlobURLs).forEach(url => {
                if (url) URL.revokeObjectURL(url);
            });

            // Reset all state to initial values
            this.config = {};
            this.frameCount = 0;
            this.frameStart = 1;
            this.frameEnd = 0;
            this.frameNumber = 0;
            this.readerIsFinished = false;
            this.autoDeriveResolutions = [];
            this.publishDestination = 'google-drive';
            this.fileInfo = null;
            this.textureName = '';
            this.textureDescription = '';
            this.file = null;
            this.fileURL = null;
            this.samplePixelCount = 0;
            this.messages = [];
            this.status = {};
            this.fpsNow = 0;
            this.timestamps = [];
            this.lastFPSUpdate = 0;
            this.currentStep = '1';
            this.tilePlan = {};
            this.ktx2BlobURLs = {};
            this.ktx2Playback = {
                currentLayer: 0,
                layerCount: 0,
                isPlaying: false,
                fps: 30,
                direction: 1,
            };
            this.cropMode = false;
            this.cropX = 0;
            this.cropY = 0;
            this.cropWidth = null;
            this.cropHeight = null;
            this.thumbnailBlob = null;
            this.resetLocalSaveState();
            this.resetPublishState();
            // Dispose snapshot preview (revokes blob URLs) before clearing
            if (this.tileSnapshotPreview) {
                this.tileSnapshotPreview.dispose();
            }
            this.tileSnapshotPreview = null;
            this.tilePreviewUrls = {};
        },
        trackFrame() {
            // Called each time a frame is processed/decoded

            const now = performance.now();
            this.timestamps.push(now);
            // Keep a rolling buffer, e.g. last 120 frames
            if (this.timestamps.length > 120) {
                this.timestamps.shift();
            }

            // Optionally, update FPS no more than ~4 times/sec
            if (now - this.lastFPSUpdate > 250) {
                this.lastFPSUpdate = now;

                if (this.timestamps.length > 1) {
                    const first = this.timestamps[0];
                    const last = this.timestamps[this.timestamps.length - 1];
                    const deltaSeconds = (last - first) / 1000;
                    const frameCount = this.timestamps.length - 1;
                    const fps = frameCount / deltaSeconds;
                    this.fpsNow = Math.round(fps);
                }
            }
        }
    },
    getters: {
        // Not to overcomplicate things, but there would also
        // be a separate FPS for encoding tiles. 
        fps() {
            return this.fpsNow
        },
        // Number of frames in the selected range (derived from frameStart/frameEnd)
        framesToSample() {
            if (this.frameEnd > 0 && this.frameStart > 0) {
                return this.frameEnd - this.frameStart + 1;
            }
            return 0;
        },
        // True when all expected tiles have been encoded
        isComplete() {
            const expectedTiles = this.tilePlan?.tiles?.length ?? 0;
            const encodedTiles = Object.keys(this.ktx2BlobURLs).length;
            return expectedTiles > 0 && encodedTiles >= expectedTiles;
        },
        // Cropping getters
        effectiveWidth() {
            return this.cropMode && this.cropWidth ? this.cropWidth : this.fileInfo?.width ?? 0;
        },
        effectiveHeight() {
            return this.cropMode && this.cropHeight ? this.cropHeight : this.fileInfo?.height ?? 0;
        },
        // Resolve samplingSide ('long'/'short') to actual axis ('rows'/'columns')
        // based on perceived dimensions (accounting for rotation metadata).
        // 'rows' always yields raw-width pixels; 'columns' yields raw-height pixels.
        // We pick whichever raw axis produces the desired perceived dimension.
        samplingAxis() {
            const w = this.effectiveWidth;
            const h = this.effectiveHeight;
            if (!w || !h) return 'rows';
            const rotation = ((this.fileInfo?.rotation || 0) % 360 + 360) % 360;
            const isRotated = rotation === 90 || rotation === 270;
            const perceivedW = isRotated ? h : w;
            const perceivedH = isRotated ? w : h;
            const perceivedLong = Math.max(perceivedW, perceivedH);
            // raw width (w) is what 'rows' produces — check if that matches the long edge
            const longAxisIsRows = (w === perceivedLong);
            if (this.samplingSide === 'long') {
                return longAxisIsRows ? 'rows' : 'columns';
            } else {
                return longAxisIsRows ? 'columns' : 'rows';
            }
        }
    }
});
