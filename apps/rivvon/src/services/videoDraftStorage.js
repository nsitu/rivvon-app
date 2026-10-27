// Videos are separate from metadata so listing drafts never reads every video.
const DATABASE = 'rivvon-video-drafts';
const STORES = ['drafts', 'videos', 'discarded'];
let connection;

export async function closeVideoDraftDatabase() {
    const pending = connection;
    connection = null;
    if (pending) (await pending).close();
}

function openDatabase() {
    if (connection) return connection;
    connection = new Promise((resolve, reject) => {
        if (!globalThis.indexedDB) {
            reject(new Error('Browser storage is unavailable.'));
            return;
        }
        const request = indexedDB.open(DATABASE, 1);
        let blocked = false;
        request.onupgradeneeded = () => {
            for (const name of STORES) request.result.createObjectStore(name, { keyPath: 'id' });
        };
        request.onblocked = () => {
            blocked = true;
            reject(new Error('Close other Rivvon tabs and retry saving.'));
        };
        request.onerror = () => reject(request.error);
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

async function transact(names, mode, run) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(names, mode);
        let result;
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () => reject(transaction.error || new Error('Browser storage write failed.'));
        transaction.onabort = () => reject(transaction.error || new Error('Browser storage transaction was interrupted.'));
        run(transaction, value => { result = value; });
    });
}

const metadataFields = [
    'id', 'createdAt', 'filename', 'name', 'format', 'mimeType', 'size',
    'settings', 'sourceDrawingPayload', 'renderSnapshot', 'colourReport',
];

export function saveVideoDraft(draft) {
    // Keep transient UI state and object URLs out of the database.
    const record = Object.fromEntries(metadataFields.map(key => [key, draft[key]]));
    record.thumbnailBlob = draft.thumbnailBlob || null;
    record.videoId = draft.publication.videoId || '';
    record.updatedAt = Date.now();
    return transact(STORES, 'readwrite', (tx, done) => {
        // A stale tab must never recreate a discarded draft, including on retry.
        tx.objectStore('discarded').get(record.id).onsuccess = event => {
            if (event.target.result) { done(false); return; }
            const drafts = tx.objectStore('drafts');
            drafts.get(record.id).onsuccess = existing => {
                if (!existing.target.result) {
                    drafts.add(record);
                    tx.objectStore('videos').add({ id: record.id, blob: draft.blob });
                }
                done(true);
            };
        };
    });
}

export function updateVideoDraft(id, { thumbnailBlob, videoId } = {}) {
    return transact(['drafts'], 'readwrite', (tx, done) => {
        const store = tx.objectStore('drafts');
        store.get(id).onsuccess = event => {
            const record = event.target.result;
            if (!record) { done(false); return; }
            // Updating just these fields cannot replace the large video Blob or
            // erase another tab's confirmed publication with stale metadata.
            if (thumbnailBlob !== undefined) record.thumbnailBlob = thumbnailBlob;
            if (videoId) record.videoId = videoId;
            record.updatedAt = Date.now();
            store.put(record);
            done(true);
        };
    });
}

export function listVideoDrafts() {
    return transact(['drafts'], 'readonly', (tx, done) => {
        tx.objectStore('drafts').getAll().onsuccess = event => done(event.target.result);
    });
}

export function getVideoDraft(id) {
    return transact(['drafts'], 'readonly', (tx, done) => {
        tx.objectStore('drafts').get(id).onsuccess = event => done(event.target.result || null);
    });
}

export function getVideoDraftBlob(id) {
    return transact(['videos'], 'readonly', (tx, done) => {
        tx.objectStore('videos').get(id).onsuccess = event => done(event.target.result?.blob || null);
    });
}

export function deleteVideoDraft(id) {
    return transact(STORES, 'readwrite', (tx, done) => {
        tx.objectStore('drafts').delete(id);
        tx.objectStore('videos').delete(id);
        tx.objectStore('discarded').put({ id });
        done(true);
    });
}

// Coordinate publication/discard between tabs when Web Locks are available.
// IndexedDB transactions still make save/update/delete atomic without Web Locks.
export function withVideoDraftLock(id, action) {
    return globalThis.navigator?.locks?.request
        ? navigator.locks.request(`rivvon-video-draft:${id}`, action)
        : action();
}

export function videoDraftStorageError(error) {
    return error?.name === 'QuotaExceededError'
        ? 'Browser storage is full. Download this video or discard older drafts, then retry saving.'
        : 'Could not save this video in browser storage. Download it before leaving, or retry saving.';
}
