import { computed } from 'vue';
import { useAppStore } from '../stores/appStore';

// The tilePlan is initially a computed property
// so as to be able to reactively update the user interface with helpful preview
// information about the tile plan.
// afterwards it gets passed on to the videoProcessor
// so that processing can occur reliably without further mutation.

export function useTilePlan() {
    const app = useAppStore(); // Pinia store

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
            !app.frameCount ||
            !app.tileProportion
        ) {
            plan.notices.push('Insufficient data to calculate tile plan.');
            return plan;
        }

        // Use the user-limited frame count (framesToSample) if set, otherwise use full frameCount
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

        // Determine rotation based on samplingMode and outputMode
        if (app.samplingMode !== app.outputMode) {
            plan.rotate = 90;
        }

        // Determine aspect ratio based on tileProportion
        let aspectRatio;
        if (app.tileProportion === 'square') {
            aspectRatio = 1;
        } else if (app.tileProportion === 'landscape') {
            aspectRatio = 16 / 9;
        } else if (app.tileProportion === 'portrait') {
            aspectRatio = 9 / 16;
        } else {
            plan.notices.push('Invalid tile proportion.');
            return plan;
        }

        // Initialize variables
        let framesPerTile; // Number of frames per tile (temporal side)
        // Use effective dimensions for spatial side calculation
        let spatialSide = app.samplingMode === 'rows' ? effectiveWidth : effectiveHeight;
        let maxQualityTiles; // Maximum number of tiles for quality reference

        // Begin processing based on tileMode
        if (app.tileMode === 'tile') {
            // Nested hierarchy: tileMode > samplingMode > outputMode > prioritize
            if (app.samplingMode === 'rows') {
                if (app.outputMode === 'rows') {
                    framesPerTile = Math.floor(spatialSide / aspectRatio);
                    maxQualityTiles = Math.floor(effectiveFrameCount / framesPerTile);
                    // Sampling rows, outputting rows
                    if (app.prioritize === 'quality') {
                        // Prioritize quality
                        plan.isScaled = false;
                        plan.width = spatialSide; // Spatial side
                        plan.height = framesPerTile; // Temporal side  
                        plan.length = maxQualityTiles;
                    } else if (app.prioritize === 'quantity') {
                        // Prioritize quantity 
                        plan.length = maxQualityTiles + 1;
                        // Recalculate framesPerTile
                        framesPerTile = Math.floor(effectiveFrameCount / plan.length);
                        plan.height = framesPerTile; // Temporal side
                        plan.width = Math.floor(plan.height * aspectRatio); // Spatial side 
                        plan.isScaled = true;
                        plan.scaleFrom = spatialSide;
                        plan.scaleTo = plan.width;
                    } else if (app.prioritize === 'powersOfTwo') {
                        // Prioritize power-of-two resolution
                        plan.isScaled = true;
                        plan.width = app.potResolution; // Spatial side (POT)
                        plan.height = Math.floor(app.potResolution / aspectRatio); // Temporal side
                        framesPerTile = plan.height;
                        plan.length = Math.floor(effectiveFrameCount / framesPerTile);
                        plan.scaleFrom = spatialSide;
                        plan.scaleTo = app.potResolution;
                    }
                } else if (app.outputMode === 'columns') {
                    framesPerTile = Math.floor(spatialSide * aspectRatio);
                    maxQualityTiles = Math.floor(effectiveFrameCount / framesPerTile);

                    // Sampling rows, outputting columns (rotation)
                    if (app.prioritize === 'quality') {
                        // Prioritize quality
                        plan.isScaled = false;
                        plan.height = spatialSide; // Spatial side
                        plan.width = framesPerTile // Temporal side 
                        plan.length = maxQualityTiles;
                    } else if (app.prioritize === 'quantity') {
                        // Prioritize quantity
                        plan.length = maxQualityTiles + 1;
                        // Recalculate framesPerTile
                        framesPerTile = Math.floor(effectiveFrameCount / plan.length);
                        plan.width = framesPerTile; // Temporal side
                        // plan.height = Math.floor(plan.width * aspectRatio); // Spatial side 
                        plan.height = Math.floor(plan.width / aspectRatio); // Spatial side 
                        plan.isScaled = true;
                        plan.scaleFrom = spatialSide;
                        plan.scaleTo = plan.height;
                    } else if (app.prioritize === 'powersOfTwo') {
                        // Prioritize power-of-two resolution
                        plan.isScaled = true;
                        plan.height = app.potResolution; // Spatial side (POT)
                        plan.width = Math.floor(app.potResolution * aspectRatio); // Temporal side
                        framesPerTile = plan.width;
                        plan.length = Math.floor(effectiveFrameCount / framesPerTile);
                        plan.scaleFrom = spatialSide;
                        plan.scaleTo = app.potResolution;
                    }
                }
            } else if (app.samplingMode === 'columns') {
                if (app.outputMode === 'rows') {
                    // The adjusted aspect ratio did not always work,
                    // in some cases I had to revert back to the original aspect ratio 
                    // in order to get the desired behaviour 
                    framesPerTile = Math.floor(spatialSide / aspectRatio);
                    maxQualityTiles = Math.floor(effectiveFrameCount / framesPerTile);
                    // Sampling columns, outputting rows (rotation)
                    if (app.prioritize === 'quality') {
                        // Prioritize quality
                        plan.isScaled = false;
                        plan.width = spatialSide; // Spatial side
                        plan.height = framesPerTile // Temporal side 
                        plan.length = maxQualityTiles;
                    } else if (app.prioritize === 'quantity') {
                        // Prioritize quantity
                        plan.length = maxQualityTiles + 1;
                        // Recalculate framesPerTile
                        framesPerTile = Math.floor(effectiveFrameCount / plan.length);
                        plan.height = framesPerTile; // Temporal side
                        plan.width = Math.floor(plan.height * aspectRatio); // Spatial side   
                        plan.isScaled = true;
                        plan.scaleFrom = spatialSide;
                        plan.scaleTo = plan.width;
                    } else if (app.prioritize === 'powersOfTwo') {
                        // Prioritize power-of-two resolution
                        plan.isScaled = true;
                        plan.width = app.potResolution; // Spatial side (POT)
                        plan.height = Math.floor(app.potResolution / aspectRatio); // Temporal side
                        framesPerTile = plan.height;
                        plan.length = Math.floor(effectiveFrameCount / framesPerTile);
                        plan.scaleFrom = spatialSide;
                        plan.scaleTo = app.potResolution;
                    }
                } else if (app.outputMode === 'columns') {
                    framesPerTile = Math.floor(spatialSide * aspectRatio);
                    maxQualityTiles = Math.floor(effectiveFrameCount / framesPerTile);
                    // Sampling columns, outputting columns
                    if (app.prioritize === 'quality') {
                        // Prioritize quality
                        plan.isScaled = false;
                        plan.height = spatialSide; // Spatial side
                        plan.width = framesPerTile; // Temporal side  
                        plan.length = maxQualityTiles;
                    } else if (app.prioritize === 'quantity') {
                        // Prioritize quantity
                        plan.length = maxQualityTiles + 1;
                        // Recalculate framesPerTile
                        framesPerTile = Math.floor(effectiveFrameCount / plan.length);
                        plan.width = framesPerTile; // Temporal side
                        plan.height = Math.floor(plan.width / aspectRatio); // Spatial side 
                        plan.isScaled = true;
                        plan.scaleFrom = spatialSide;
                        plan.scaleTo = plan.height;
                    } else if (app.prioritize === 'powersOfTwo') {
                        // Prioritize power-of-two resolution
                        plan.isScaled = true;
                        plan.height = app.potResolution; // Spatial side (POT)
                        plan.width = Math.floor(app.potResolution * aspectRatio); // Temporal side
                        framesPerTile = plan.width;
                        plan.length = Math.floor(effectiveFrameCount / framesPerTile);
                        plan.scaleFrom = spatialSide;
                        plan.scaleTo = app.potResolution;
                    }
                }
            }

            // Generate tile frame ranges
            plan.tiles = Array.from({ length: plan.length }, (_, i) => {
                const startFrame = i * framesPerTile + 1;
                const endFrame = (i + 1) * framesPerTile;
                return {
                    start: startFrame,
                    end: endFrame,
                };
            });

            // Handle common calculations after nesting
            if (plan.isScaled) {
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

                // All frames are used
                plan.skipping = 0;
            } else {

                if (framesPerTile < 1 || plan.length < 1) {
                    const framesNeeded = framesPerTile || 1;
                    const framesShort = framesNeeded - effectiveFrameCount;
                    plan.notices.push(
                        `Not enough frames to create a single tile with the current settings. Each tile requires ${framesNeeded} frames, but only ${effectiveFrameCount} frames are available. You are short by ${framesShort} frames.`
                    );
                    plan.skipping = effectiveFrameCount; // All frames are skipped
                    return plan;
                }

                // Calculate skipped frames
                const usedFrames = plan.length * framesPerTile;
                plan.skipping = effectiveFrameCount - usedFrames;
            }
        } else if (app.tileMode === 'full') {
            // Full tile mode: one tile covering all frames
            plan.length = 1;
            plan.isScaled = false;
            plan.scaleFrom = spatialSide;
            plan.scaleTo = spatialSide;
            plan.tiles = [{ start: 1, end: effectiveFrameCount }];
            plan.skipping = 0;

            // Determine tile dimensions based on samplingMode and outputMode
            if (app.samplingMode === 'rows') {
                if (app.outputMode === 'rows') {
                    plan.width = spatialSide; // Spatial side
                    plan.height = effectiveFrameCount; // Temporal side
                } else if (app.outputMode === 'columns') {
                    plan.height = spatialSide; // Spatial side
                    plan.width = effectiveFrameCount; // Temporal side
                }
            } else if (app.samplingMode === 'columns') {
                if (app.outputMode === 'rows') {
                    plan.width = spatialSide; // Spatial side
                    plan.height = effectiveFrameCount; // Temporal side
                } else if (app.outputMode === 'columns') {
                    plan.height = spatialSide; // Spatial side
                    plan.width = effectiveFrameCount; // Temporal side
                }
            }
        } else {
            plan.notices.push('Invalid tile mode.');
            return plan;
        }

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
