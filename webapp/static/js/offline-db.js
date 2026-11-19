/**
 * NovaPOS — Offline Database Manager v4.0
 * ==========================================
 * IndexedDB orqali to'liq offline ishlov berish:
 *   ✅ products_cache   — mahsulotlar (stok, barcode, short_code)
 *   ✅ customers_cache  — mijozlar
 *   ✅ offline_sales    — internet yo'qda saqlangan sotuvlar
 *   ✅ offline_queue    — POST/PATCH/DELETE operatsiyalar navbati
 *   ✅ reports_cache    — dashboard ma'lumotlar
 *   ✅ auth             — token (SW uchun)
 *   ✅ meta             — sync vaqtlari va boshqa metama'lumotlar
 */

// ✅ Umumiy sxema (offline-db.js, sw.js va React lib/db.ts da BIR XIL bo'lishi shart).
// v6: kim birinchi ochishidan qat'i nazar hamma jadval va indekslar yaratiladi.
const NOVA_DB_SCHEMA = {
  products_cache:  { keyPath: 'id', indexes: ['store_id', 'barcode', 'short_code', 'category_id'] },
  customers_cache: { keyPath: 'id', indexes: ['store_id', 'phone'] },
  offline_sales:   { keyPath: 'local_id', autoIncrement: true, indexes: ['status', 'created_at', 'store_id'] },
  offline_queue:   { keyPath: 'id', autoIncrement: true, indexes: ['status', 'endpoint', 'created_at'] },
  reports_cache:   {},
  auth:            {},
  meta:            {},
};
function novaDbUpgrade(db, tx) {
  for (const [name, def] of Object.entries(NOVA_DB_SCHEMA)) {
    const os = db.objectStoreNames.contains(name)
      ? tx.objectStore(name)
      : db.createObjectStore(name, def.keyPath ? { keyPath: def.keyPath, autoIncrement: !!def.autoIncrement } : undefined);
    for (const ix of def.indexes || []) if (!os.indexNames.contains(ix)) os.createIndex(ix, ix);
  }
}

const NovaPOS_DB = (() => {
  const DB_NAME    = 'novapos_db';
  const DB_VERSION = 6;   // ← sw.js va frontend/src/lib/db.ts bilan BIR XIL
  const CHUNK_SIZE = 200; // bitta TX da max yozuv (UI muzlamasligi uchun)

  let _db = null;

  // ── IndexedDB ochish ──────────────────────────────────────
  function open() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror   = () => reject(req.error);
      req.onsuccess = () => {
        _db = req.result;
        // Boshqa varaq bazani yangi versiyaga ko'tarsa — ulanishni yopamiz (aks holda u bloklanadi)
        _db.onversionchange = () => { try { _db.close(); } catch (e) {} _db = null; };
        resolve(_db);
      };

      req.onupgradeneeded = (e) => novaDbUpgrade(e.target.result, e.target.transaction);
    });
  }

  // ── Ichki yordamchilar ────────────────────────────────────
  async function _get(store, key) {
    const db = await open();
    return new Promise((res, rej) => {
      const r = db.transaction(store, 'readonly').objectStore(store).get(key);
      r.onsuccess = () => res(r.result ?? null);
      r.onerror   = () => rej(r.error);
    });
  }

  async function _getAll(store, indexName, value) {
    const db = await open();
    return new Promise((res, rej) => {
      const os = db.transaction(store, 'readonly').objectStore(store);
      const r  = indexName ? os.index(indexName).getAll(value) : os.getAll();
      r.onsuccess = () => res(r.result || []);
      r.onerror   = () => rej(r.error);
    });
  }

  async function _put(store, value, key) {
    // ✅ DataError oldini olish uchun tekshiruv
    if (store === 'products_cache' || store === 'customers_cache') {
        if (!value || (typeof value === 'object' && !value.id)) {
            console.error(`[IDB] ${store} ga saqlashda xato: ID topilmadi`, value);
            return null;
        }
    }

    const db = await open();
    return new Promise((res, rej) => {
      try {
        const os = db.transaction(store, 'readwrite').objectStore(store);
        const r  = key !== undefined ? os.put(value, key) : os.put(value);
        r.onsuccess = () => res(r.result);
        r.onerror   = () => {
            console.warn('[IDB] Put error:', r.error);
            res(null); // Crash bo'lmasligi uchun reject emas, null qaytaramiz
        };
      } catch (e) {
        console.error('[IDB] Transaction error:', e);
        res(null);
      }
    });
  }

  async function _delete(store, key) {
    const db = await open();
    return new Promise((res, rej) => {
      const r = db.transaction(store, 'readwrite').objectStore(store).delete(key);
      r.onsuccess = () => res(true);
      r.onerror   = () => rej(r.error);
    });
  }

  async function _count(store) {
    const db = await open();
    return new Promise((res, rej) => {
      const r = db.transaction(store, 'readonly').objectStore(store).count();
      r.onsuccess = () => res(r.result);
      r.onerror   = () => rej(r.error);
    });
  }

  async function _clearStore(store) {
    const db = await open();
    return new Promise((res, rej) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).clear();
      tx.oncomplete = () => res(true);
      tx.onerror    = () => rej(tx.error);
    });
  }

  // Chunked bulk insert — UI ni bloklamaslik uchun
  async function _putChunked(storeName, items) {
    if (!items?.length) return 0;
    const db = await open();
    for (let i = 0; i < items.length; i += CHUNK_SIZE) {
      const chunk = items.slice(i, i + CHUNK_SIZE);
      await new Promise((res, rej) => {
        const tx = db.transaction(storeName, 'readwrite');
        const st = tx.objectStore(storeName);
        chunk.forEach(item => st.put(item));
        tx.oncomplete = () => res();
        tx.onerror    = () => rej(tx.error);
        tx.onabort    = () => rej(new Error('TX aborted'));
      });
      // Har chunk dan keyin event loop ga imkon ber
      await new Promise(r => setTimeout(r, 0));
    }
    return items.length;
  }

  // ============================================================
  // MAHSULOTLAR
  // ============================================================
  const products = {

    // To'liq ro'yxatni saqlash (eski ma'lumotlar o'chiriladi)
    async saveAll(list) {
      if (!list?.length) return 0;
      await _clearStore('products_cache');
      const n = await _putChunked('products_cache', list);
      await _put('meta', Date.now(), 'products_synced_at');
      return n;
    },

    // Faqat o'zgargan mahsulotlarni yangilash (tezroq)
    async saveDelta(list) {
      if (!list?.length) return 0;
      const n = await _putChunked('products_cache', list);
      await _put('meta', Date.now(), 'products_synced_at');
      return n;
    },

    async getAll(storeId) {
      if (storeId) return _getAll('products_cache', 'store_id', storeId);
      return _getAll('products_cache');
    },

    async getById(id)    { return _get('products_cache', id); },
    async getCount()     { return _count('products_cache'); },
    
    async updateLocal(p) { 
      // 1. Obyekt borligini tekshiramiz
      if (!p || typeof p !== 'object') return null;

      // 2. Agar 'id' yo'q bo'lsa, uni 'product_id' maydonidan olib ko'ramiz
      if (!p.id && p.product_id) {
          p.id = p.product_id;
      }

      // 3. Agar baribir 'id' topilmasa, to'xtatamiz.
      if (!p.id) {
          return null;
      }

      // 4. Bazadagi eski ma'lumot bilan birlashtiramiz (Merge)
      try {
          const existing = await _get('products_cache', p.id);
          const finalData = existing ? { ...existing, ...p } : p;
          
          return _put('products_cache', finalData);
      } catch (e) {
          console.error('[IDB] product updateLocal xatosi:', e);
          return null;
      }
    },

    // Barcode yoki short_code bo'yicha qidirish
    async getByCode(code) {
      const db   = await open();
      const code_str = String(code).trim();
      // Barcode indeks
      const byBarcode = await new Promise((res, rej) => {
        const r = db.transaction('products_cache', 'readonly')
          .objectStore('products_cache').index('barcode').get(code_str);
        r.onsuccess = () => res(r.result || null);
        r.onerror   = () => rej(r.error);
      });
      if (byBarcode) return byBarcode;
      // short_code indeks
      return new Promise((res, rej) => {
        const r = db.transaction('products_cache', 'readonly')
          .objectStore('products_cache').index('short_code').get(code_str);
        r.onsuccess = () => res(r.result || null);
        r.onerror   = () => rej(r.error);
      });
    },

    // Matn bo'yicha qidirish (nom, barcode, short_code)
    async search(q, storeId) {
      const all = await this.getAll(storeId);
      if (!q) return all;
      const lq = q.toLowerCase().trim();
      return all.filter(p =>
        p.name?.toLowerCase().includes(lq)  ||
        p.barcode   === q                   ||
        p.short_code === q                  ||
        p.barcode?.includes(q)
      );
    },

    // Stokni kamaytirish (bir mahsulot)
    async decreaseStock(productId, qty) {
      const p = await _get('products_cache', productId);
      if (!p) return null;
      p.quantity = Math.max(0, (parseFloat(p.quantity) || 0) - qty);
      await _put('products_cache', p);
      return p;
    },

    // Stokni yangilash (server dan kelgan qiymat)
    async updateStock(productId, newQty) {
      const p = await _get('products_cache', productId);
      if (!p) return null;
      p.quantity = Math.max(0, parseFloat(newQty) || 0);
      await _put('products_cache', p);
      return p;
    },

    // Bir necha mahsulotni bitta TX da kamaytirish (sotuv uchun)
    async batchDecreaseStock(items) {
      // items: [{product_id, quantity}, ...]
      if (!items?.length) return 0;
      const db  = await open();
      return new Promise((res, rej) => {
        const tx   = db.transaction('products_cache', 'readwrite');
        const st   = tx.objectStore('products_cache');
        let   done = 0;

        const step = (i) => {
          if (i >= items.length) return;
          const { product_id, quantity } = items[i];
          const req = st.get(product_id);
          req.onsuccess = () => {
            const p = req.result;
            if (p) {
              p.quantity = Math.max(0, (parseFloat(p.quantity) || 0) - quantity);
              st.put(p);
              done++;
            }
            step(i + 1);
          };
          req.onerror = () => step(i + 1);
        };
        step(0);
        tx.oncomplete = () => res(done);
        tx.onerror    = () => rej(tx.error);
      });
    },

    async getLastSyncTime() {
      const ts = await _get('meta', 'products_synced_at');
      return ts ? new Date(ts) : null;
    },
  };

  // ============================================================
  // MIJOZLAR
  // ============================================================
  const customers = {

    async saveAll(list) {
      if (!list?.length) return 0;
      await _clearStore('customers_cache');
      const n = await _putChunked('customers_cache', list);
      await _put('meta', Date.now(), 'customers_synced_at');
      return n;
    },

    async getAll(storeId) {
      if (storeId) return _getAll('customers_cache', 'store_id', storeId);
      return _getAll('customers_cache');
    },

    async getById(id)    { return _get('customers_cache', id); },

    async search(q) {
      const all = await _getAll('customers_cache');
      if (!q) return all;
      const lq = q.toLowerCase().trim();
      return all.filter(c =>
        c.full_name?.toLowerCase().includes(lq) ||
        c.phone?.includes(q)
      );
    },

    async updateLocal(c) { 
      // 1. Obyekt borligini tekshiramiz
      if (!c || typeof c !== 'object') return null;
  
      // 2. ID ni aniqlaymiz
      if (!c.id && c.customer_id) {
          c.id = c.customer_id;
      }
  
      if (!c.id) return null;
  
      // 3. Bazadagi eski MIJOZ bilan birlashtiramiz (Merge)
      try {
          // TO'G'IRLANDI: Endi 'customers_cache' dan qidiradi
          const existing = await _get('customers_cache', c.id);
          const finalData = existing ? { ...existing, ...c } : c;
          
          // TO'G'IRLANDI: Endi 'customers_cache' ga saqlaydi
          return _put('customers_cache', finalData);
      } catch (e) {
          console.error('[IDB] customer updateLocal xatosi:', e);
          return null;
      }
    },

    async getLastSyncTime() {
      const ts = await _get('meta', 'customers_synced_at');
      return ts ? new Date(ts) : null;
    },
  };

  // ============================================================
  // OFFLINE SOTUVLAR
  // ============================================================
  const offlineSales = {

    async add(saleData) {
      const storeId = saleData.store_id ||
        JSON.parse(localStorage.getItem('user_info') || '{}')?.store_id;

      // Oflayn sotuv belgilari: server qoldiq yetmasa ham qabul qiladi,
      // haqiqiy sotilgan vaqt bilan yozadi, client_uid bo'yicha ikki marta yozmaydi
      saleData = { ...saleData, is_offline: true };
      if (!saleData.offline_created_at) saleData.offline_created_at = new Date().toISOString();
      if (!saleData.client_uid) {
        saleData.client_uid = (self.crypto?.randomUUID?.()) ||
          ('u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12));
      }

      const record = {
        data:          saleData,
        store_id:      storeId,
        created_at:    new Date().toISOString(),
        status:        'pending',
        retry_count:   0,
        local_receipt: 'OFFLINE-' + Date.now(),
      };

      const id = await _put('offline_sales', record);
      record.local_id = id;

      // Background Sync ro'yxatga olish
      if ('serviceWorker' in navigator && 'SyncManager' in window) {
        navigator.serviceWorker.ready
          .then(reg => reg.sync.register('sync-offline-sales'))
          .catch(() => {});
      }

      return record;
    },

    async getPending() {
      const all = await _getAll('offline_sales');
      return all.filter(s => s.status === 'pending' || s.status === 'failed');
    },

    async getCount() {
      return (await this.getPending()).length;
    },

    async getAll() {
      return _getAll('offline_sales');
    },

    async markSyncing(localId) {
      const s = await _get('offline_sales', localId);
      if (s) { s.status = 'syncing'; await _put('offline_sales', s); }
    },

    async markSynced(localId) {
      return _delete('offline_sales', localId);
    },

    async markFailed(localId, errorMsg) {
      const s = await _get('offline_sales', localId);
      if (s) {
        s.status      = 'failed';
        s.retry_count = (s.retry_count || 0) + 1;
        s.last_error  = errorMsg || 'Unknown error';
        await _put('offline_sales', s);
      }
    },
  };

  // ============================================================
  // OFFLINE QUEUE (POST/PATCH/DELETE operatsiyalar)
  // ============================================================
  const offlineOps = {

    async add(endpoint, method, data) {
      const record = {
        endpoint,
        method,
        data,
        created_at:  new Date().toISOString(),
        status:      'pending',
        retry_count: 0,
      };
      const id = await _put('offline_queue', record);

      if ('serviceWorker' in navigator && 'SyncManager' in window) {
        navigator.serviceWorker.ready
          .then(reg => reg.sync.register('sync-offline-ops'))
          .catch(() => {});
      }
      return id;
    },

    async getPending() {
      const all = await _getAll('offline_queue');
      return all.filter(o => o.status === 'pending' || o.status === 'failed');
    },

    async getCount() {
      return (await this.getPending()).length;
    },

    async markSynced(id) {
      return _delete('offline_queue', id);
    },

    async markFailed(id, errorMsg) {
      const o = await _get('offline_queue', id);
      if (o) {
        o.status      = 'failed';
        o.retry_count = (o.retry_count || 0) + 1;
        o.last_error  = errorMsg;
        await _put('offline_queue', o);
      }
    },
  };

  // ============================================================
  // REPORTS CACHE
  // ============================================================
  const reportsCache = {
    async save(key, data)  { return _put('reports_cache', data, key); },
    async get(key)         { return _get('reports_cache', key); },
    async clear()          { return _clearStore('reports_cache'); },
  };

  // ============================================================
  // AUTH (Service Worker uchun token saqlash)
  // ============================================================
  const auth = {
    async saveToken(token)  { return _put('auth', token, 'access_token'); },
    async getToken()        { return _get('auth', 'access_token'); },
    async clearToken()      { return _delete('auth', 'access_token'); },
  };

  // ============================================================
  // META (sync vaqtlari, sozlamalar)
  // ============================================================
  const meta = {
    async get(key)        { return _get('meta', key); },
    async set(key, value) { return _put('meta', value, key); },
    async delete(key)     { return _delete('meta', key); },
  };

  // ============================================================
  // PUBLIC API
  // ============================================================
  return {
    open,
    products,
    customers,
    offlineSales,
    offlineOps,
    reportsCache,
    auth,
    meta,
  };
})();

window.NovaPOS_DB = NovaPOS_DB;