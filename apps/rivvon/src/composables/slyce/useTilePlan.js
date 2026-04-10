import { computed } from 'vue';
import { useSlyceStore } from '../../stores/slyceStore';

// The tilePlan is initially a computed property
// so as to be able to reactively update the user interface with helpful preview
// information about the tile plan.
// afterwards it gets passed on to the videoProcessor
// so that processing can occur reliably without further mutation.

export function useTilePlan() {
    const app = useSlyceStore(); // Pinia store

    const tilePlan = computed(() => {
        const plan = {
            length: 0,
            width: 0,
            height: 0,
            tiles: [],
            notices: [],
            isScaled: false,
            scaleFrom: 0,
            scaleTo: 0,
            rotate: 0, // Rotation angle (0 or 90 degrees)
            skipping: 0, // Number of frames being skipped
            // Cropping info (passed to videoProcessor)
            isCropping: false,
            cropX: 0,
            cropY: 0,
            cropWidth: 0,
            cropHeight: 0,
        };

        // Ensure necessary data is available
        if (
            !app.fileInfo?.width ||
            !app.fileInfo?.height ||
            !app.frameCount
        ) {
            plan.notices.push('Insufficient data to calculate tile plan.');
            return plan;
        }

        // Use the user-limited frame count (framesToSample) if set, otherwise use full frameCount
        // framesToSample is derived from frameStart/frameEnd range
        const effectiveFrameCount = app.framesToSample > 0 ? Math.min(app.framesToSample, app.frameCount) : app.frameCount;

        // Determine effective dimensions based on crop settings
        const effectiveWidth = app.cropMode && app.cropWidth ? app.cropWidth : app.fileInfo.width;
        const effectiveHeight = app.cropMode && app.cropHeight ? app.cropHeight : app.fileInfo.height;

        // Store crop info in plan for videoProcessor
        plan.isCropping = app.cropMode;
        plan.cropX = app.cropMode ? app.cropX : 0;
        plan.cropY = app.cropMode ? app.cropY : 0;
        plan.cropWidth = effectiveWidth;
        plan.cropHeight = effectiveHeight;

        // Rotation is needed when sampling columns but outputting rows
        if (app.samplingAxis === 'columns') {
            plan.rotate = 90;
        }

        // Initialize variables
        let framesPerTile; // Number of frames per tile (temporal side)
        // Use effective dimensions for spatial side calculation
        let spatialSide = app.samplingAxis === 'rows' ? effectiveWidth : effectiveHeight;

        // Power-of-two square tiles — width and height are both potResolution
        plan.isScaled = true;
        plan.scaleFrom = spatialSide;
        plan.scaleTo = app.potResolution;

        plan.width = app.potResolution;  // Spatial side (POT)
        plan.height = app.potResolution; // Temporal side (square tiles)
        framesPerTile = plan.height;

        plan.length = Math.floor(effectiveFrameCount / framesPerTile);

        // Generate tile frame ranges
        plan.tiles = Array.from({ length: plan.length }, (_, i) => {
            const startFrame = i * framesPerTile + 1;
            const endFrame = (i + 1) * framesPerTile;
            return {
                start: startFrame,
                end: endFrame,
            };
        });

        // Ensure framesPerTile and plan.length are valid
        if (framesPerTile < 1 || plan.length < 1) {
            const framesNeeded = framesPerTile || 1;
            const framesShort = framesNeeded - effectiveFrameCount;
            plan.notices.push(
                `Not enough frames to create tiles with the current settings. Each tile requires ${framesNeeded} frames, but only ${effectiveFrameCount} frames are available. You are short by ${framesShort} frames.`
            );
            plan.skipping = effectiveFrameCount; // All frames are skipped
            return plan;
        }

        // POT tiles use all allocated frames; remainder is skipped
        const usedFrames = plan.length * framesPerTile;
        plan.skipping = effectiveFrameCount - usedFrames;

        // Ensure dimensions are integers
        plan.width = Math.floor(plan.width);
        plan.height = Math.floor(plan.height);
        plan.scaleTo = Math.floor(plan.scaleTo);

        return plan;
    });

    return {
        tilePlan,
    };
}
