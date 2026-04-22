import { createDrawingDocument } from '../modules/shared/drawingLibrary.js';

const DB_NAME = 'rivvon-drawings';
const DB_VERSION = 1;
const STORE_DRAWINGS = 'drawings';

let dbInstance = null;

function generateId() {
    return `drawing_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

async function openDatabase() {
    if (dbInstance) {
        return dbInstance;
    }

    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
            reject(request.error);
        };

        request.onsuccess = () => {
            dbInstance = request.result;
            resolve(dbInstance);
        };

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            let drawingStore;

            if (!db.objectStoreNames.contains(STORE_DRAWINGS)) {
                drawingStore = db.createObjectStore(STORE_DRAWINGS, { keyPath: 'id' });
            } else {
                drawingStore = event.target.transaction.objectStore(STORE_DRAWINGS);
            }

            if (!drawingStore.indexNames.contains('created_at')) {
                drawingStore.createIndex('created_at', 'created_at', { unique: false });
            }
            if (!drawingStore.indexNames.contains('updated_at')) {
                drawingStore.createIndex('updated_at', 'updated_at', { unique: false });
            }
            if (!drawingStore.indexNames.contains('kind')) {
                drawingStore.createIndex('kind', 'kind', { unique: false });
            }
            if (!drawingStore.indexNames.contains('name')) {
                drawingStore.createIndex('name', 'name', { unique: false });
            }
            if (!drawingStore.indexNames.contains('storage_provider')) {
                drawingStore.createIndex('storage_provider', 'storage_provider', { unique: false });
            }
            if (!drawingStore.indexNames.contains('root_drawing_id')) {
                drawingStore.createIndex('root_drawing_id', 'root_drawing_id', { unique: false });
            }
            if (!drawingStore.indexNames.contains('parent_drawing_id')) {
                drawingStore.createIndex('parent_drawing_id', 'parent_drawing_id', { unique: false });
            }
            if (!drawingStore.indexNames.contains('cached_from')) {
                drawingStore.createIndex('cached_from', 'cached_from', { unique: false });
            }
        };
    });
}

async function getDrawing(id) {
    const db = await openDatabase();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_DRAWINGS], 'readonly');
        const store = transaction.objectStore(STORE_DRAWINGS);
        const request = store.get(id);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result || null);
    });
}

async function putDrawingRecord(record) {
    const db = await openDatabase();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_DRAWINGS], 'readwrite');

        transaction.onerror = () => reject(transaction.error);
        transaction.oncomplete = () => resolve(record);

        transaction.objectStore(STORE_DRAWINGS).put(record);
    });
}

async function saveDrawing(input) {
    const nextId = typeof input?.id === 'string' && input.id.trim()
        ? input.id.trim()
        : generateId();
    const existing = input?.id ? await getDrawing(nextId) : null;
    const record = createDrawingDocument({
        ...(existing || {}),
        ...(input || {}),
        id: nextId,
        createdAt: input?.createdAt ?? input?.created_at ?? existing?.created_at,
        updatedAt: Date.now(),
    });

    return putDrawingRecord(record);
}

async function getAllDrawings() {
    const db = await openDatabase();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_DRAWINGS], 'readonly');
        const store = transaction.objectStore(STORE_DRAWINGS);
        const request = store.getAll();

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            const drawings = Array.isArray(request.result) ? request.result : [];
            drawings.sort((left, right) => (right.updated_at || 0) - (left.updated_at || 0));
            resolve(drawings);
        };
    });
}

async function deleteDrawing(id) {
    const db = await openDatabase();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_DRAWINGS], 'readwrite');
        const store = transaction.objectStore(STORE_DRAWINGS);
        const request = store.delete(id);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
    });
}

async function updateDrawing(id, updates = {}) {
    const existing = await getDrawing(id);
    if (!existing) {
        throw new Error('Saved drawing not found');
    }

    return saveDrawing({
        ...existing,
        ...updates,
        id,
        createdAt: existing.created_at,
    });
}

function useDrawingStorage() {
    return {
        saveDrawing,
        getDrawing,
        getAllDrawings,
        updateDrawing,
        deleteDrawing,
    };
}

export {
    saveDrawing,
    getDrawing,
    getAllDrawings,
    updateDrawing,
    deleteDrawing,
    useDrawingStorage,
};