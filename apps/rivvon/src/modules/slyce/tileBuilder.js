// tileBuilder.js 
import { EventEmitter } from 'events';  // https://www.npmjs.com/package/events

export class TileBuilder extends EventEmitter {
    constructor(settings) {
        super();
        this.settings = settings
        this.outputFormat = settings.outputFormat || 'webm'; // Default to webm if not specified
        this.canvasses = this.createCanvasses();
    }

    createCanvasses() {
        let canvasses = [];
        let { tilePlan, crossSectionCount, samplingMode, outputMode } = this.settings;

        for (let i = 0; i < crossSectionCount; i++) {
            let canvas = new OffscreenCanvas(tilePlan.width, tilePlan.height);
            let ctx = canvas.getContext('2d');
            // in cases where rotation happens
            // we need to map of top-to-bottom ⇔ left-to-right
            if (tilePlan.rotate !== 0) {
                // Move origin to center for rotation
                ctx.translate(tilePlan.width / 2, tilePlan.height / 2);
                // Apply rotation based on sampling and output modes
                if (samplingMode === 'rows' && outputMode === 'columns') {
                    // Counterclockwise
                    ctx.rotate(-tilePlan.rotate * Math.PI / 180);
                }
                else if (samplingMode === 'columns' && outputMode === 'rows') {
                    // Clockwise
                    ctx.rotate(tilePlan.rotate * Math.PI / 180);
                }
                // Move origin back after rotation
                ctx.translate(-tilePlan.height / 2, -tilePlan.width / 2);
            }
            canvasses = canvasses || [];
            canvasses.push(canvas);
        }

        return canvasses;
    }

    // Utility function to calculate sine parameters
    // for the Periodic Function y = A sin(B x + C) + D
    calculateSineParameters(videoWidth, videoHeight, frameCount, totalCanvases, canvasNumber, samplingMode) {
        const A = samplingMode === 'rows' ? videoHeight / 2 : videoWidth / 2;
        const B = (2 * Math.PI) / frameCount;
        const C = (2 * Math.PI * canvasNumber) / totalCanvases; // Phase shift
        const D = samplingMode === 'rows' ? videoHeight / 2 : videoWidth / 2;
        return { A, B, C, D };
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
            outputMode,
            crossSectionCount,
            crossSectionType,
            frameCount
        } = this.settings



        // Let's normalize the frameNumber to the tile's range
        // so we know where to draw the sample to in the destination tile  
        let drawLocation = frameNumber - tilePlan.tiles[tileNumber].start;
        // NOTE: ↓ Later we also have a sampleLocation  (unique to each canvas)


        this.canvasses.forEach((canvas, canvasNumber) => {


            let ctx = canvas.getContext('2d')

            // We will sample pixels from a different y-location for each canvas    
            // the logic whereby this is done will depend on the crossSectionType
            // planes / waves

            if (crossSectionType === 'planes') {
                // Cosine distribution  (This creates a gentle sway back and forth)
                // TODO: audit this Math to make sure it uses the full range properly
                // A normalized index describes the canvas number as a fraction of the total canvasses
                // (A number between 0 and 1). We multiply this by PI to get a number between 0 and PI
                // This is a useful range for cosine functions.
                let normalizedIndex = (canvasNumber / (crossSectionCount - 1)) * Math.PI;
                // if we are sampling rows, they are distributed along the video height
                // if we are sampling columns, they are distributed along the video width
                let distributionRange = 0
                if (samplingMode === 'rows') distributionRange = fileInfo.height;
                if (samplingMode === 'columns') distributionRange = fileInfo.width;
                let sampleLocation = (Math.cos(normalizedIndex) + 1) / 2 * (distributionRange - 1);




                // drawImage(image, sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight)
                // When sample and tile dimensions differ, drawImage ⟹ scaling effects

                if (samplingMode === 'columns') {
                    if (outputMode === 'columns') {
                        const sx = sampleLocation           // Source x
                        const sy = 0                        // Source y
                        const sw = 1                        // Source width
                        const sh = fileInfo.height      // Source height
                        const dx = drawLocation             // Destination x
                        const dy = 0                        // Destination y
                        const dw = 1                        // Destination width
                        const dh = tilePlan.height          // Destination height
                        ctx.drawImage(videoFrame, sx, sy, sw, sh, dx, dy, dw, dh);
                    }
                    else if (outputMode === 'rows') {
                        // We have already rotated the canvas
                        // to account for samplingMode != outputMode
                        // the lets us write columns to rows
                        // NOTE: we still need to use tilePlan.width for the height
                        // since the canvas is rotated.
                        const sx = sampleLocation           // Source x
                        const sy = 0                        // Source y
                        const sw = 1                        // Source width
                        const sh = fileInfo.height      // Source height
                        const dx = drawLocation             // Destination x
                        const dy = 0                        // Destination y
                        const dw = 1                        // Destination width
                        const dh = tilePlan.width           // ***Destination height
                        ctx.drawImage(videoFrame, sx, sy, sw, sh, dx, dy, dw, dh);
                    }
                }
                else if (samplingMode === 'rows') {
                    if (outputMode === 'rows') {
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
                    else if (outputMode === 'columns') {
                        // We have already rotated the canvas
                        // to account for samplingMode != outputMode
                        // the lets us write rows to columns
                        // NOTE: we still need to use tilePlan.height for the height
                        // since the canvas is rotated.
                        const sx = 0                        // Source x
                        const sy = sampleLocation           // Source y
                        const sw = fileInfo.width       // Source width
                        const sh = 1                        // Source height
                        const dx = 0                        // Destination x
                        const dy = drawLocation             // Destination y
                        const dw = tilePlan.height          // Destination width
                        const dh = 1                        // Destination height
                        ctx.drawImage(videoFrame, sx, sy, sw, sh, dx, dy, dw, dh);
                    }
                }
            }
            else if (crossSectionType === 'waves') {
                // Sample pixels via imagined corrugated forms
                // being in number equal to the number of canvasses 
                // having amplitude matching the video dimensions
                // -if sampling rows, then the video height
                // -if sampling columns, then the video width
                // and having wavelength spanning the video framecount 
                // and having offsets from the start evenly distributed 
                // such that we "wind up back at the beginning"
                // after having sampled the last frame

                // we will need to find the equation that decscribes this wave 
                // and then plug into that equation the relevant variables
                // for the current frame.

                // Calculate sine parameters



                // NOTE: alternately we could determine the wavelength
                // based on the framecount of each individual tile
                // as opposed to the framecount of the entire video
                // const frameCount = tilePlan.tiles[tileNumber].end - tilePlan.tiles[tileNumber].start + 1;

                const { A, B, C, D } = this.calculateSineParameters(
                    fileInfo.width,
                    fileInfo.height,
                    frameCount,
                    crossSectionCount,
                    canvasNumber,
                    samplingMode
                );

                // Determine distribution range based on sampling mode
                const distributionRange = samplingMode === 'rows' ? fileInfo.height : fileInfo.width;

                // Calculate sample location using sine function
                // Use a continuous global frame index so phase doesn't reset per tile
                // frameCount is the total number of frames we actually process (framesUsed)
                const globalIndex = Math.min(frameNumber, frameCount) - 1; // zero-based
                const sampleLocation = A * Math.sin(B * globalIndex + C) + D;

                // Clamp sampleLocation to be within video bounds
                const clampedSampleLocation = Math.max(0, Math.min(distributionRange - 1, sampleLocation));

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
        })

        // Release the VideoFrame now that all drawing is complete
        videoFrame.close();

        // Check if this is the last frame of the tile
        if (frameNumber === tilePlan.tiles[tileNumber].end) {
            let images, kind;

            if (this.outputFormat === 'ktx2') {
                // KTX2 mode: Extract RGBA pixel data
                kind = 'ktx2';
                images = this.canvasses.map(canvas => {
                    const ctx = canvas.getContext('2d');
                    const imageData = ctx.getImageData(0, 0, tilePlan.width, tilePlan.height);
                    return {
                        rgba: imageData.data, // Uint8ClampedArray with RGBA values
                        width: tilePlan.width,
                        height: tilePlan.height
                    };
                });
            } else {
                // WebM mode: Use ImageBitmap (existing behavior)
                kind = 'webm';
                images = this.canvasses.map(canvas => canvas.transferToImageBitmap());
            }

            // Emit consistent payload with kind discriminator
            this.emit('complete', { images, kind });

            // "destroy" these canvasses
            delete this.canvasses
        }

    }


}
