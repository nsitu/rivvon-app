import { useAppStore } from '../stores/appStore';
import { Input, ALL_FORMATS, BlobSource } from 'mediabunny';

const getMetaData = async () => {

    const app = useAppStore()  // Pinia store 

    // reset framecount for a new file
    app.set('frameCount', 0)
    app.set('fileInfo', null)

    try {
        app.setStatus('Video Setup', 'Loading video file...');

        // Create mediabunny input from file blob
        const input = new Input({
            formats: ALL_FORMATS,
            source: new BlobSource(app.file),
        });

        app.setStatus('Video Setup', 'Extracting stream info...');

        // Get primary video track
        const videoTrack = await input.getPrimaryVideoTrack();

        app.setStatus('Video Setup', 'Configuring video decoder...');

        // Get decoder configuration
        const config = await videoTrack.getDecoderConfig();

        // Get exact frame count via packet statistics
        const stats = await videoTrack.computePacketStats();
        const codecString = await videoTrack.getCodecParameterString();
        const duration = await videoTrack.computeDuration(); // Get actual duration from track

        console.log('videoTrack', videoTrack);
        console.log('decoderConfig', config);
        console.log('packetStats', stats);
        console.log('duration', duration);

        app.set('frameCount', stats.packetCount);
        app.set('fileInfo', {
            name: app.file.name,
            // Use coded dimensions (before rotation) for video processing
            width: videoTrack.codedWidth,
            height: videoTrack.codedHeight,
            // mediabunny reports rotation as clockwise degrees
            // web-demuxer reported counter-clockwise, so negate for compatibility
            rotation: -videoTrack.rotation,
            codec_string: codecString,
            duration: duration,
            r_frame_rate: `${Math.round(stats.averagePacketRate)}/1`, // Convert to fraction format
            nb_frames: stats.packetCount,
            bit_rate: stats.averageBitrate
        });
        app.set('config', config);

        // Remove the setup status now that we're done
        app.removeStatus('Video Setup');

    } catch (error) {
        console.error('Failed to get file meta data:', error);
        app.setStatus('Video Setup', `Error: ${error.message}`);
    }
}

export { getMetaData }