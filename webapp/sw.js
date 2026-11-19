/**
 * NovaPOS — Service Worker v6.0
 * ==============================
 * v6.0:
 *   ✅ Barcha kutubxonalar (htmx, Font Awesome, shriftlar, QR skaner) LOKAL —
 *      internet bo'lmasa ham ilova to'liq ochiladi
 *   ✅ Barcha sahifalar o'rnatishda oldindan keshlanadi
 *   ✅ Sahifalar: keshdan darhol (tez ochiladi), fonda yangilanadi
 *   ✅ API: avval tarmoq (doim yangi ma'lumot), tarmoq yo'q bo'lsa — kesh,
 *      u ham bo'lmasa 503 + X-SW-Offline (api.js IndexedDB dan oladi)
 *   ✅ Oflayn sotuvlar client_uid bilan — ikki marta yozilmaydi
 */

const VER      = '7.2.0';
const C_STATIC = `nova-static-${VER}`;
const C_PAGES  = `nova-pages-${VER}`;
const C_API    = `nova-api-${VER}`;
const ALL_C    = [C_STATIC, C_PAGES, C_API];

const STATIC_FILES = [
  '/static/js/offline-db.js',
  '/static/js/sync-manager.js',
  '/static/js/api.js',
  '/static/js/auth.js',
  '/static/js/main.js',
  '/static/js/cart.js',
  '/static/js/printer.js',
  '/static/js/scanner.js',
  '/static/manifest.json',
  '/static/img/icon-192.png',
  '/static/img/icon-512.png',
  '/static/sounds/success.wav',
  '/static/sounds/error.wav',
  '/static/vendor/htmx.min.js',
  '/static/vendor/html5-qrcode.min.js',
  '/static/vendor/fontawesome/css/all.min.css',
  '/static/vendor/fontawesome/webfonts/fa-solid-900.woff2',
  '/static/vendor/fontawesome/webfonts/fa-regular-400.woff2',
  '/static/vendor/fontawesome/webfonts/fa-brands-400.woff2',
  '/static/vendor/fonts/fonts.css',
  '/static/vendor/fonts/plus-jakarta-sans-latin-400-normal.woff2',
  '/static/vendor/fonts/plus-jakarta-sans-latin-500-normal.woff2',
  '/static/vendor/fonts/plus-jakarta-sans-latin-600-normal.woff2',
  '/static/vendor/fonts/plus-jakarta-sans-latin-700-normal.woff2',
  '/static/vendor/fonts/plus-jakarta-sans-latin-800-normal.woff2',
  '/static/vendor/fonts/jetbrains-mono-latin-400-normal.woff2',
  '/static/vendor/fonts/jetbrains-mono-latin-600-normal.woff2',
];

const PAGES = [
  '/', '/login', '/register',
  '/products', '/products/add', '/sales', '/sales/history',
  '/reports', '/settings', '/products/supply-history', '/app/',
];

// Tarmoq yo'q bo'lganda qaysi API javoblari keshdan berilishi mumkin
const API_CACHEABLE = [
  '/api/reports', '/api/products', '/api/customers', '/api/suppliers',
  '/api/employees', '/api/stores', '/api/auth/me', '/api/subscriptions',
  '/api/sales/history', '/api/superadmin',
];

// ─── INSTALL ─────────────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    Promise.all([
      caches.open(C_STATIC).then(c =>
        Promise.allSettled(STATIC_FILES.map(u => c.add(u)))
      ),
      caches.open(C_PAGES).then(c =>
        Promise.allSettled(PAGES.map(u => c.add(u)))
      ),
    ]).then(() => self.skipWaiting())
  );
});

// ─── ACTIVATE ────────────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => !ALL_C.includes(k)).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ─── FETCH ───────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);

  if (!url.protocol.startsWith('http')) return;
  if (req.method !== 'GET') return;            // POST/PUT — doim to'g'ridan-to'g'ri
  if (req.headers.get('range')) return;
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/ws/')) return;

  if (url.pathname.startsWith('/api/')) {
    e.respondWith(_apiNetworkFirst(req, url)); return;
  }
  if (url.pathname.startsWith('/static/')) {
    e.respondWith(_cacheFirst(req)); return;
  }
  if (req.mode === 'navigate' || req.headers.get('accept')?.includes('text/html')) {
    e.respondWith(_swrPage(req)); return;
  }
});

// ─── STRATEGIYALAR ───────────────────────────────────────────

function _offlineJson() {
  return new Response(JSON.stringify({ detail: "Internet aloqasi yo'q" }), {
    status: 503,
    headers: { 'Content-Type': 'application/json', 'X-SW-Offline': '1' },
  });
}

async function _apiNetworkFirst(req, url) {
  const cacheable = API_CACHEABLE.some(p => url.pathname.startsWith(p));
  try {
    const res = await fetch(req);
    if (cacheable && res.status === 200) {
      const cache = await caches.open(C_API);
      cache.put(req, res.clone());
    }
    return res;
  } catch {
    if (cacheable) {
      const cached = await caches.match(req, { cacheName: C_API });
      if (cached) {
        const h = new Headers(cached.headers); h.set('X-SW-Cache', '1');
        return new Response(await cached.blob(), { status: 200, headers: h });
      }
    }
    return _offlineJson();
  }
}

async function _cacheFirst(req) {
  const cached = await caches.match(req, { ignoreSearch: true });
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res && res.status === 200) {
      const cache = await caches.open(C_STATIC);
      cache.put(req, res.clone());
    }
    return res;
  } catch {
    return new Response('', { status: 503 });
  }
}

async function _swrPage(req) {
  const cache  = await caches.open(C_PAGES);
  const url    = new URL(req.url);
  // /products/edit/5 → bitta shablon (add_product) — keshdagi /products/add ni ishlatamiz.
  // React ilovasi (/app/...) — hamma manzil uchun bitta index.html → '/app/' kaliti.
  const key    = url.pathname.startsWith('/products/edit/') ? null
               : (url.pathname === '/app' || url.pathname.startsWith('/app/')) ? '/app/'
               : url.pathname;
  const cached = key ? await cache.match(key) : null;

  const net = fetch(req)
    .then(res => { if (res.ok && key) cache.put(key, res.clone()); return res; })
    .catch(() => null);

  if (cached) { net.catch(() => {}); return cached; }   // darhol ochiladi

  const res = await net;
  if (res) return res;

  if (url.pathname.startsWith('/products/edit/')) {
    const add = await cache.match('/products/add');
    if (add) return add;
  }
  const app = await cache.match('/app/');
  if (app) return app;
  return new Response(_offlinePage(), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

// ─── BACKGROUND SYNC ─────────────────────────────────────────
self.addEventListener('sync', e => {
  if (e.tag === 'sync-offline-sales') e.waitUntil(_syncSales());
  if (e.tag === 'sync-offline-ops')   e.waitUntil(_syncOps());
});

async function _syncSales() {
  let db;
  try { db = await _openDB(); } catch (err) {
    console.warn('[SW] IDB ochilmadi:', err); return;
  }

  // Token FAQAT IDB dan (localStorage yo'q SW da)
  const token = await _getToken(db);
  if (!token) { console.warn('[SW] Token yo\'q, sync bekor'); return; }

  const all   = await _dbGetAll(db, 'offline_sales');
  const items = all.filter(s => s.status === 'pending' || s.status === 'failed');

  console.log(`[SW] Sync: ${items.length} ta offline sotuv`);

  for (const item of items) {
    try {
      const res = await fetch('/api/sales/checkout', {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(item.data),
      });

      if (res.ok) {
        await _dbDel(db, 'offline_sales', item.local_id);
        // ✅ Sahifaga faqat signal — sahifa o'zi stock ni yangilaydi
        // SW hech qachon stock hisob qilmaydi!
        _notify({ type: 'SALE_SYNCED', localId: item.local_id });
        console.log(`[SW] Sotuv yuborildi: local_id=${item.local_id}`);
      } else {
        const errData = await res.json().catch(() => ({}));
        console.warn(`[SW] Checkout xato ${res.status}:`, errData);
        await _dbUpdateStatus(db, 'offline_sales', item.local_id, 'failed', item.retry_count);
      }
    } catch (err) {
      console.warn('[SW] Fetch xato:', err);
      await _dbUpdateStatus(db, 'offline_sales', item.local_id, 'failed', item.retry_count);
    }
  }
}

async function _syncOps() {
  let db;
  try { db = await _openDB(); } catch { return; }
  if (!db.objectStoreNames.contains('offline_queue')) return;

  const token = await _getToken(db);
  if (!token) return;

  const all   = await _dbGetAll(db, 'offline_queue');
  const items = all.filter(o => o.status === 'pending' || o.status === 'failed');

  for (const op of items) {
    try {
      const res = await fetch(op.endpoint, {
        method:  op.method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: op.method !== 'DELETE' ? JSON.stringify(op.data) : undefined,
      });

      if (res.ok) {
        await _dbDel(db, 'offline_queue', op.id);
        _notify({ type: 'OP_SYNCED', endpoint: op.endpoint });
      } else {
        await _dbUpdateStatus(db, 'offline_queue', op.id, 'failed', op.retry_count);
      }
    } catch {
      await _dbUpdateStatus(db, 'offline_queue', op.id, 'failed', op.retry_count);
    }
  }
}

// ─── MESSAGE ─────────────────────────────────────────────────
self.addEventListener('message', e => {
  const { type } = e.data || {};
  if (type === 'SKIP_WAITING') self.skipWaiting();
  if (type === 'CLEAR_API_CACHE')
    caches.delete(C_API)
      .then(() => e.source?.postMessage({ type: 'API_CACHE_CLEARED' }));
});

// ─── YORDAMCHI FUNKSIYALAR ────────────────────────────────────

async function _notify(msg) {
  const list = await clients.matchAll({ includeUncontrolled: true, type: 'window' });
  list.forEach(c => c.postMessage(msg));
}

// ─── IDB (SW ichida — localStorage yo'q!) ────────────────────
// MUHIM: offline-db.js bilan bir xil DB_NAME va DB_VERSION ishlatiladi!

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

const DB_NAME    = 'novapos_db';
const DB_VERSION = 6;  // ← offline-db.js va frontend/src/lib/db.ts bilan BIR XIL

function _openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror   = () => reject(req.error);
    req.onsuccess = () => { const db = req.result; db.onversionchange = () => db.close(); resolve(db); };

    req.onupgradeneeded = e => novaDbUpgrade(e.target.result, e.target.transaction);
  });
}

// Token FAQAT IDB auth store dan (localStorage YO'Q)
async function _getToken(db) {
  return new Promise(resolve => {
    try {
      const tx = db.transaction('auth', 'readonly');
      const r  = tx.objectStore('auth').get('access_token');
      r.onsuccess = () => resolve(r.result || null);
      r.onerror   = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function _dbGetAll(db, storeName) {
  return new Promise(resolve => {
    try {
      if (!db.objectStoreNames.contains(storeName)) { resolve([]); return; }
      const r = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror   = () => resolve([]);
    } catch { resolve([]); }
  });
}

function _dbDel(db, storeName, key) {
  return new Promise(resolve => {
    try {
      const r = db.transaction(storeName, 'readwrite').objectStore(storeName).delete(key);
      r.onsuccess = () => resolve(true);
      r.onerror   = () => resolve(false);
    } catch { resolve(false); }
  });
}

function _dbUpdateStatus(db, storeName, key, status, retryCount) {
  return new Promise(resolve => {
    try {
      const tx = db.transaction(storeName, 'readwrite');
      const os = tx.objectStore(storeName);
      const r  = os.get(key);
      r.onsuccess = () => {
        const item = r.result;
        if (item) {
          item.status      = status;
          item.retry_count = (retryCount || 0) + 1;
          item.updated_at  = new Date().toISOString();
          os.put(item);
        }
        resolve(true);
      };
      r.onerror = () => resolve(false);
    } catch { resolve(false); }
  });
}

// ─── OFFLINE PAGE ─────────────────────────────────────────────
function _offlinePage() {
  return `<!DOCTYPE html>
<html lang="uz">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,maximum-scale=1,user-scalable=no">
  <title>NovaPOS — Aloqa uzildi</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
  <style>
    :root {
        --bg: #f1f5f9;
        --surface: #ffffff;
        --text: #0f172a;
        --text-muted: #64748b;
        --primary: #2563eb;
        --border: #e2e8f0;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
    body { 
        min-height: 100dvh; display: flex; align-items: center; justify-content: center;
        background: var(--bg); font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
        padding: 24px; color: var(--text); overflow: hidden;
    }
    .card {
        max-width: 340px; width: 100%; text-align: center;
        animation: slideUp .5s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .icon-box {
        width: 96px; height: 96px; background: var(--surface);
        border: 1px solid var(--border); border-radius: 32px;
        display: flex; align-items: center; justify-content: center;
        margin: 0 auto 24px; box-shadow: 0 12px 32px rgba(0,0,0,0.06);
    }
    .icon-box i { font-size: 32px; color: var(--text-muted); }
    h1 { font-size: 1.5rem; font-weight: 800; margin-bottom: 12px; letter-spacing: -0.02em; }
    p { color: var(--text-muted); font-size: 0.95rem; line-height: 1.6; margin-bottom: 32px; }
    .btns { display: flex; flex-direction: column; gap: 12px; }
    
    .btn {
        border: none; padding: 16px; border-radius: 18px; font-size: 0.95rem; font-weight: 700;
        cursor: pointer; transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        display: flex; align-items: center; justify-content: center; gap: 10px;
        font-family: inherit; width: 100%; touch-action: manipulation;
    }
    .btn:active { transform: scale(0.96); }
    .btn-p { 
        background: var(--primary); color: #fff; 
        box-shadow: 0 8px 20px rgba(37,99,235,0.25);
    }
    .btn-p:hover { filter: brightness(1.1); }
    .btn-s { 
        background: var(--surface); color: var(--text); 
        border: 1.5px solid var(--border);
    }
    .btn-s:hover { background: var(--bg); }

    @keyframes slideUp {
        from { opacity: 0; transform: translateY(30px) scale(0.95); }
        to { opacity: 1; transform: translateY(0) scale(1); }
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon-box"><i class="fa-solid fa-wifi-slash"></i></div>
    <h1>Internet uzildi</h1>
    <p>Xavotir olmang! NovaPOS oflayn rejimda ishlay oladi. Internet tiklanganda sotuvlar avtomatik sinxronizatsiya qilinadi.</p>
    <div class="btns">
      <button class="btn btn-p" onclick="location.reload()">
        <i class="fa-solid fa-arrows-rotate"></i> Qayta urinish
      </button>
      <button class="btn btn-s" onclick="location.href='/pos'">
        <i class="fa-solid fa-cash-register"></i> Kassada davom etish
      </button>
    </div>
  </div>
</body>
</html>`;
}
