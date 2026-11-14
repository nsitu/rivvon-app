import '@ffmpeg/ffmpeg/worker';
import { createExportBlob } from './exportBlob.js';

// The pinned FFmpeg worker normally transfers READ_FILE's entire ArrayBuffer.
// Keep its request protocol but return a storage-backed Blob for binary files,
// so repaired output can cross the same range limit as the mounted input.
const postMessage = self.postMessage.bind(self);
self.postMessage = (message, transfer) => {
    if (message.type !== 'READ_FILE' || !(message.data instanceof Uint8Array)) {
        return postMessage(message, transfer);
    }
    void createExportBlob(message.data).then(blob => {
        postMessage({ ...message, data: blob });
    }).catch(error => {
        postMessage({ id: message.id, type: 'ERROR', data: String(error) });
    });
};
