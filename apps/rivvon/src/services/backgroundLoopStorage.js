// Prototype work files are separate from published clips and scene video drafts.
const DATABASE = 'rivvon-background-loop-work';
let connection;

export async function closeBackgroundLoopDatabase() {
    const pending = connection;
    connection = null;
    if (pending) (await pending).close();
}

function openDatabase() {
    if (connection) return connection;
    connection = new Promise((resolve, reject) => {
        if (!globalThis.indexedDB) { reject(new Error('Browser storage is unavailable.')); return; }
        const request = indexedDB.open(DATABASE, 1);
        let blocked = false;
        request.onupgradeneeded = () => {
            request.result.createObjectStore('jobs', { keyPath: 'id' });
            request.result.createObjectStore('parts', { keyPath: ['jobId', 'kind', 'index'] });
        };
        request.onerror = () => reject(request.error);
        request.onblocked = () => { blocked = true; reject(new Error('Close other background-loop lab tabs and retry.')); };
        request.onsuccess = () => {
            const db = request.result;
            if (blocked) { db.close(); return; }
            db.onversionchange = () => { db.close(); connection = null; };
            db.onclose = () => { connection = null; };
            resolve(db);
        };
    }).catch(error => { connection = null; throw error; });
    return connection;
}

async function transact(stores, mode, run) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(stores, mode);
        let result;
        tx.oncomplete = () => resolve(result);
        tx.onabort = tx.onerror = () => reject(tx.error || new Error('Background-loop storage failed.'));
        try { run(tx, value => { result = value; }); }
        catch (error) { tx.abort(); reject(error); }
    });
}

export const saveBackgroundLoopJob = job => transact(['jobs'], 'readwrite', tx => tx.objectStore('jobs').put(job));
export const getBackgroundLoopJob = id => transact(['jobs'], 'readonly', (tx, done) => {
    tx.objectStore('jobs').get(id).onsuccess = event => done(event.target.result);
});
export const listBackgroundLoopJobs = () => transact(['jobs'], 'readonly', (tx, done) => {
    tx.objectStore('jobs').getAll().onsuccess = event => done(event.target.result);
});
export const saveBackgroundLoopPart = (jobId, kind, index, blob) => transact(['parts'], 'readwrite', tx => {
    tx.objectStore('parts').put({ jobId, kind, index, blob });
});
export const getBackgroundLoopPart = (jobId, kind, index) => transact(['parts'], 'readonly', (tx, done) => {
    tx.objectStore('parts').get([jobId, kind, index]).onsuccess = event => done(event.target.result?.blob);
});
export function deleteBackgroundLoopParts(jobId, kind) {
    return transact(['parts'], 'readwrite', tx => {
        const range = IDBKeyRange.bound([jobId, kind, 0], [jobId, kind, Number.MAX_SAFE_INTEGER]);
        tx.objectStore('parts').delete(range);
    });
}
export async function discardBackgroundLoop(id) {
    return transact(['jobs', 'parts'], 'readwrite', tx => {
        tx.objectStore('jobs').delete(id);
        tx.objectStore('parts').delete(IDBKeyRange.bound([id], [id, []]));
    });
}

export async function getBackgroundLoopBlob(id) {
    const job = await getBackgroundLoopJob(id);
    if (job?.status !== 'complete') throw new Error('The background loop has not been assembled.');
    // Blob handles, rather than ArrayBuffers for every encoded byte, are retained.
    const parts = [];
    for (let i = 0; i < job.outputParts; i++) {
        const blob = await getBackgroundLoopPart(id, 'output', i);
        if (!blob) throw new Error('A stored output part is missing. Reassemble the loop.');
        parts.push(blob);
    }
    return new Blob(parts, { type: 'video/mp4' });
}
