// tileBuilder.js 
import { EventEmitter } from 'events';  // https://www.npmjs.com/package/events
import { getCached2dContext } from './samplingRuntime.js';

export class TileBuilder extends EventEmitter {
    constructor(settings) {
        super();
        this.settings = settings;
        const {
            fileInfo,
            samplingMode,
            crossSectionCount,
            crossSectionType,
            frameCount
        } = settings;

        this._distributionRange = samplingMode === 'rows' ? fileInfo.height : fileInfo.width;

        if (crossSectionType === 'planes') {
            this._cosineIndices = new Float64Array(crossSectionCount);
            if (crossSectionCount === 1) {
                this._cosineIndices[0] = 0.5;
            } else {
                for (let i = 0; i < crossSectionCount; i++) {
                    const normalizedIndex = (i / (crossSectionCount - 1)) * Math.PI;
                    this._cosineIndices[i] = (Math.cos(normalizedIndex) + 1) / 2;
                }
            }
        } else {
            this._phaseShifts = new Float64Array(crossSectionCount);
            for (let i = 0; i < crossSectionCount; i++) {
                this._phaseShifts[i] = (2 * Math.PI * i) / crossSectionCount;
            }
            this._waveAmplitude = this._distributionRange / 2;
            this._waveOffset = this._distributionRange / 2;
            this._omega = frameCount ? (2 * Math.PI) / frameCount : 0;
        }

        this.canvasses = this.createCanvasses();
    }

    createCanvasses() {
        const canvasses = [];
        const { tilePlan, crossSectionCount, samplingMode } = this.settings;

        for (let i = 0; i < crossSectionCount; i++) {
            const canvas = new OffscreenCanvas(tilePlan.width, tilePlan.height);
            const ctx = getCached2dContext(canvas);
            // When sampling columns but outputting rows, rotate the canvas
            // so column data is written in the row direction
            if (tilePlan.rotate !== 0) {
                // Move origin to center for rotation
                ctx.translate(tilePlan.width / 2, tilePlan.height / 2);
                // Clockwise rotation (columns → rows)
                ctx.rotate(tilePlan.rotate * Math.PI / 180);
                // Move origin back after rotation
                ctx.translate(-tilePlan.height / 2, -tilePlan.width / 2);
            }
            canvasses.push(canvas);
        }

        return canvasses;
    }

    releaseCanvasSet() {
        // Offline processing does not pool canvas sets yet, but expose the
        // same surface as the realtime builder so orchestrators can share it.
    }

    getCurrentPreviewCanvas() {
        return this.canvasses?.[0] ?? null;
    }

    dispose() {
        this.canvasses = null;
        this.removeAllListeners();
    }



    processFrame(data) {

        const {
            videoFrame,
            frameNumber
        } = data

        const {
            fileInfo,
            tileNumber,
            tilePlan,
            samplingMode,
            crossSectionType,
            frameCount
        } = this.settings



        // Let's normalize the frameNumber to the tile's range
        // so we know where to draw the sample to in the destination tile  
        let drawLocation = frameNumber - tilePlan.tiles[tileNumber].start;
        // NOTE: ↓ Later we also have a sampleLocation  (unique to each canvas)

        for (let canvasNumber = 0; canvasNumber < this.canvasses.length; canvasNumber++) {
            const canvas = this.canvasses[canvasNumber];
            const ctx = getCached2dContext(canvas);

            // We will sample pixels from a different y-location for each canvas    
            // the logic whereby this is done will depend on the crossSectionType
            // planes / waves

            if (crossSectionType === 'planes') {
                const sampleLocation = this._cosineIndices[canvasNumber] * (this._distributionRange - 1);




                // drawImage(image, sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight)
                // When sample and tile dimensions differ, drawImage ⟹ scaling effects

                if (samplingMode === 'columns') {
                    // Column sampling — canvas may be rotated (columns → rows)
                    // Use tilePlan.width for dh since the canvas coordinate system is rotated
                    const sx = sampleLocation           // Source x
                    const sy = 0                        // Source y
                    const sw = 1                        // Source width
                    const sh = fileInfo.height      // Source height
                    const dx = drawLocation             // Destination x
                    const dy = 0                        // Destination y
                    const dw = 1                        // Destination width
                    const dh = tilePlan.width           // Destination height (width because rotated)
                    ctx.drawImage(videoFrame, sx, sy, sw, sh, dx, dy, dw, dh);
                }
                else if (samplingMode === 'rows') {
                    const sx = 0                        // Source x
                    const sy = sampleLocation           // Source y
                    const sw = fileInfo.width       // Source width
                    const sh = 1                        // Source height
                    const dx = 0                        // Destination x
                    const dy = drawLocation             // Destination y
                    const dw = tilePlan.width           // Destination width
                    const dh = 1                        // Destination height
                    ctx.drawImage(videoFrame, sx, sy, sw, sh, dx, dy, dw, dh);
                }
            }
            else if (crossSectionType === 'waves') {
                // Calculate sample location using sine function
                // Use a continuous global frame index so phase doesn't reset per tile
                // frameCount is the total number of frames we actually process (framesUsed)
                const globalIndex = Math.min(frameNumber, frameCount) - 1; // zero-based
                const sampleLocation = this._waveAmplitude * Math.sin(this._omega * globalIndex + this._phaseShifts[canvasNumber]) + this._waveOffset;

                // Clamp sampleLocation to be within video bounds
                const clampedSampleLocation = Math.max(0, Math.min(this._distributionRange - 1, sampleLocation));

                // Sample the pixel based on sampling mode
                let sx, sy, sw, sh, dx, dy, dw, dh;

                if (samplingMode === 'columns') {
                    sx = clampedSampleLocation; // x-coordinate
                    sy = 0;
                    sw = 1;
                    sh = fileInfo.height;
                    dx = drawLocation; // Destination x
                    dy = 0;
                    dw = 1;
                    dh = tilePlan.height;
                } else if (samplingMode === 'rows') {
                    sx = 0;
                    sy = clampedSampleLocation; // y-coordinate
                    sw = fileInfo.width;
                    sh = 1;
                    dx = 0;
                    dy = drawLocation; // Destination y
                    dw = tilePlan.width;
                    dh = 1;
                }

                // Draw the sampled pixels onto the canvas
                ctx.drawImage(videoFrame, sx, sy, sw, sh, dx, dy, dw, dh);



            }
        }

        // Release the VideoFrame now that all drawing is complete
        videoFrame.close();

        // Check if this is the last frame of the tile
        if (frameNumber === tilePlan.tiles[tileNumber].end) {
            const completedCanvasSet = this.canvasses;

            // Mirror the realtime builder contract: the orchestrator owns
            // readback and encoding after sampling is finished.
            this.canvasses = null;
            this.emit('complete', {
                tileId: tileNumber,
                canvasSet: completedCanvasSet
            });
        }

    }


}
