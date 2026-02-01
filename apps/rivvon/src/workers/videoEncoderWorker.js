// tileEncoderWorker.js
import { Output, WebMOutputFormat, BufferTarget, CanvasSource, QUALITY_HIGH } from 'mediabunny';

let totalFrames = 0;
let framesEncoded = 0;

let imageBitmaps = null; // <--- declare up here

// We'll expect a message that includes:
// - an array of OffscreenCanvas (the tile frames)
// - the tile's width/height
// - a config object for the encoder
self.onmessage = async (e) => {
    const { type, data } = e.data;

    if (type === 'ENCODE_TILE') {
        framesEncoded = 0;
        totalFrames = 0;

        try {

            const { tilePlan, imageBitmaps, crossSectionType } = data;

            // 1. Create Output with WebM format
            const output = new Output({
                format: new WebMOutputFormat(),
                target: new BufferTarget(),
            });

            // 2. Create CanvasSource for video encoding
            // We'll create a temporary canvas to feed frames to mediabunny
            const canvas = new OffscreenCanvas(tilePlan.width, tilePlan.height);
            const ctx = canvas.getContext('2d');

            // TODO: allow the user to select the bitrate 
            // in the settingsArea
            const videoSource = new CanvasSource(canvas, {
                codec: 'vp9',
                bitrate: 10e6 // 10 Mbps
            });
            output.addVideoTrack(videoSource);

            // if we are using planes, a forward + reverse loop makes sense
            // however, if we are using waves, we should just encode the frames
            // 3. Encode frames (for forward + reverse loop)

            let frames = []
            if (crossSectionType == 'planes') {
                frames = [
                    ...imageBitmaps,
                    ...imageBitmaps.slice().reverse()
                ];
            }
            else if (crossSectionType == 'waves') {
                frames = [
                    ...imageBitmaps
                ];
            }
            totalFrames = frames.length;

            // Start the output
            await output.start();

            // Just an example frameRate:
            const frameRate = 30;
            const frameDuration = 1 / frameRate; // seconds

            for (let i = 0; i < frames.length; i++) {
                // Draw the ImageBitmap to the canvas
                ctx.clearRect(0, 0, tilePlan.width, tilePlan.height);
                ctx.drawImage(frames[i], 0, 0);

                // Add frame to video source
                await videoSource.add(i * frameDuration, frameDuration);

                framesEncoded++;
                self.postMessage({
                    type: 'PROGRESS',
                    data: {
                        framesEncoded,
                        totalFrames
                    }
                });
            }

            // 4. Finalize the output
            await output.finalize();

            // 5. Get the buffer from the output
            const buffer = output.target.buffer;


            // Transfer ArrayBuffer instead of Blob
            self.postMessage(
                {
                    type: 'DONE',
                    buffer: buffer
                },
                [buffer]
            );

            // 7. Respond back with the Blob
            // (we can’t *transfer* a Blob, but we can post it as is)
            // self.postMessage({ type: 'DONE', blob });

            // Optional: close the worker once done
            // self.close();
        } catch (err) {
            // in case of errors
            self.postMessage({ type: 'ERROR', data: err.message });
        }
        finally {
            // ---- Clean up references in the worker ---- 
            // Call .close() on each ImageBitmap (optional, but recommended)
            // This explicitly frees the underlying image data
            if (imageBitmaps) {
                for (const bmp of imageBitmaps) {
                    if (typeof bmp.close === 'function') {
                        bmp.close();
                    }
                }
            }
            // Set arrays/variables to null or empty them
            // so we don't keep any lingering references
            imageBitmaps = null;
        }
    }
};
