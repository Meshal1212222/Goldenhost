// IndexedDB Storage for Design Library - No Size Limits!

const DB_NAME = 'MondayDesignLibrary';
const DB_VERSION = 1;
const STORE_NAME = 'designs';

// Initialize IndexedDB
function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const objectStore = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                objectStore.createIndex('type', 'type', { unique: false });
                objectStore.createIndex('uploadDate', 'uploadDate', { unique: false });
            }
        };
    });
}

// Save file to IndexedDB
async function saveFileDB(fileData) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.add(fileData);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// Get all files by type (wireframe or brand)
async function getFilesByType(type) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const index = store.index('type');
        const request = index.getAll(type);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// Get file by ID
async function getFileDB(id) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(id);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// Delete file by ID
async function deleteFileDB(id) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(id);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

// Clear all files
async function clearAllFilesDB() {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.clear();

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

// Get total storage size
async function getTotalSize() {
    const wireframes = await getFilesByType('wireframe');
    const brandImages = await getFilesByType('brand');

    let totalSize = 0;
    [...wireframes, ...brandImages].forEach(file => {
        totalSize += file.size || 0;
    });

    return totalSize;
}

// Get storage stats
async function getStorageStats() {
    const wireframes = await getFilesByType('wireframe');
    const brandImages = await getFilesByType('brand');
    const totalSize = await getTotalSize();

    return {
        wireframeCount: wireframes.length,
        brandImageCount: brandImages.length,
        totalSize: totalSize,
        totalSizeMB: (totalSize / (1024 * 1024)).toFixed(2)
    };
}

// Notes Storage (using localStorage - small size)
function saveNotes(notes) {
    localStorage.setItem('designNotes', notes);
}

function getNotes() {
    return localStorage.getItem('designNotes') || '';
}
