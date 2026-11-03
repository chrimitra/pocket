// Piccolo wrapper attorno a IndexedDB: tutti i dati restano sul dispositivo.
const DB_NAME = 'tasca';
const DB_VERSION = 3;
export const STORES = ['accounts', 'categories', 'transactions', 'goals', 'rules', 'meta'];

let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = req.result;
        if (e.oldVersion < 1) {
          db.createObjectStore('accounts', { keyPath: 'id' });
          db.createObjectStore('categories', { keyPath: 'id' });
          db.createObjectStore('transactions', { keyPath: 'id' }).createIndex('date', 'date');
          db.createObjectStore('meta', { keyPath: 'key' });
        }
        if (e.oldVersion < 2) db.createObjectStore('goals', { keyPath: 'id' });
        if (e.oldVersion < 3) db.createObjectStore('rules', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

export async function getAll(store) {
  const db = await open();
  return request(db.transaction(store).objectStore(store).getAll());
}

export async function get(store, key) {
  const db = await open();
  return request(db.transaction(store).objectStore(store).get(key));
}

export async function put(store, value) {
  return putMany(store, [value]);
}

export async function putMany(store, values) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  for (const v of values) os.put(v);
  return done(tx);
}

export async function remove(store, key) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(key);
  return done(tx);
}

export async function clearAll() {
  const db = await open();
  const tx = db.transaction(STORES, 'readwrite');
  for (const s of STORES) tx.objectStore(s).clear();
  return done(tx);
}
