// Lightweight IndexedDB model cache + fetcher
// Stores ONNX model by URL as ArrayBuffer in an object store.

const DB_NAME = 'sam3y-models';
const STORE_NAME = 'models';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getCached(db, url) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(url);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function putCached(db, url, data) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(data, url);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

async function fetchModel(url) {
  const resp = await fetch(url, { cache: 'no-store' });
  if (!resp.ok) throw new Error('Model fetch failed: ' + resp.status);
  return await resp.arrayBuffer();
}

// Public API
self.ModelCache = {
  async getOrFetch(url) {
    const db = await openDb();
    const cached = await getCached(db, url);
    if (cached) return cached;
    const data = await fetchModel(url);
    await putCached(db, url, data);
    return data;
  }
};

