// Read-only audit, fetching MP4 box headers and moov via HTTP Range. Never writes
// gallery state. A container nclx alone cannot establish the encoded colour space.
import { writeFile } from 'node:fs/promises';
import { inspectMp4Colour } from '../src/modules/viewer/videoColourMetadata.js';
const api = process.env.RIVVON_API_URL || 'https://api.rivvon.ca';
const gallery = await (await fetch(`${api}/videos?limit=100`)).json();
async function range(url,start,end) {
    const response = await fetch(url,{ headers:{ Range:`bytes=${start}-${end}` } });
    if (!response.ok) throw new Error(`HTTP ${response.status} reading ${url}`);
    const data = new Uint8Array(await response.arrayBuffer());
    if (response.status === 200) return data.subarray(start,end + 1);
    return data;
}
const result = [];
for (const video of gallery.videos) {
    if (video.format !== 'mp4') continue;
    let offset = 0, metadata;
    while (offset < video.file_size) {
        const header = await range(video.playback_url,offset,offset + 15);
        if (header.length < 8) throw new Error('Truncated MP4 header.');
        const view = new DataView(header.buffer,header.byteOffset,header.byteLength);
        const type = String.fromCharCode(...header.subarray(4,8));
        const size = view.getUint32(0) === 1 ? Number(view.getBigUint64(8)) : view.getUint32(0);
        if (size < 8) throw new Error('Invalid box size.');
        if (type === 'moov') { metadata = inspectMp4Colour(await range(video.playback_url,offset,offset + size - 1)); break; }
        offset += size;
    }
    if (!metadata) throw new Error(`No moov for ${video.id}`);
    result.push({ id:video.id,url:video.playback_url,width:video.width,height:video.height,fps:video.fps,
        sampleEntries:metadata.sampleEntries,container:metadata.container,sps:metadata.sps,
        requiresColourNormalization:!metadata.container.length || !metadata.sps.length || [...metadata.container,...metadata.sps].some(c =>
            c.fullRange !== false || c.primaries !== 1 || c.transfer !== 1 || c.matrix !== 1) });
}
await writeFile(process.argv[2] || 'gallery-colour-audit.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
