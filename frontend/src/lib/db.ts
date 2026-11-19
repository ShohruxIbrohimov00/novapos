// Qurilmadagi oflayn baza (IndexedDB).
// ⚠️ Sxema va versiya webapp/static/js/offline-db.js va webapp/sw.js bilan BIR XIL bo'lishi SHART —
// eski sahifalar, Service Worker va React bitta bazadan foydalanadi.

const DB_NAME = 'novapos_db';
const DB_VERSION = 6;

const SCHEMA: Record<string, { keyPath?: string; autoIncrement?: boolean; indexes?: string[] }> = {
  products_cache:  { keyPath: 'id', indexes: ['store_id', 'barcode', 'short_code', 'category_id'] },
  customers_cache: { keyPath: 'id', indexes: ['store_id', 'phone'] },
  offline_sales:   { keyPath: 'local_id', autoIncrement: true, indexes: ['status', 'created_at', 'store_id'] },
  offline_queue:   { keyPath: 'id', autoIncrement: true, indexes: ['status', 'endpoint', 'created_at'] },
  reports_cache:   {},
  auth:            {},
  meta:            {},
};

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result, tx = req.transaction!;
      for (const [name, def] of Object.entries(SCHEMA)) {
        const os = db.objectStoreNames.contains(name)
          ? tx.objectStore(name)
          : db.createObjectStore(name, def.keyPath ? { keyPath: def.keyPath, autoIncrement: !!def.autoIncrement } : undefined);
        for (const ix of def.indexes ?? []) if (!os.indexNames.contains(ix)) os.createIndex(ix, ix);
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => { dbPromise = null; reject(req.error); };
    req.onblocked = () => { /* boshqa varaq yopilishini kutamiz */ };
  });
  return dbPromise;
}

function wrap<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

async function store(name: string, mode: IDBTransactionMode = 'readonly') {
  const db = await openDb();
  return db.transaction(name, mode).objectStore(name);
}

export async function getAll<T>(name: string): Promise<T[]> {
  try { return (await wrap((await store(name)).getAll())) as T[]; } catch { return []; }
}

/** Butun ro'yxatni almashtiradi (masalan, serverdan kelgan mahsulotlar) */
export async function replaceAll<T extends { id: number }>(name: string, items: T[]): Promise<void> {
  const db = await openDb();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(name, 'readwrite');
    const os = tx.objectStore(name);
    os.clear();
    for (const it of items) if (it && it.id) os.put(it);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

export async function put<T>(name: string, value: T): Promise<IDBValidKey> {
  return wrap((await store(name, 'readwrite')).put(value));
}

export async function del(name: string, key: IDBValidKey): Promise<void> {
  await wrap((await store(name, 'readwrite')).delete(key));
}
