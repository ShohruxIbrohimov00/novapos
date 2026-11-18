/**
 * NovaPOS — Service Worker v5.0
 * ==============================
 * v5.0 o'zgarishlar:
 *   ✅ IDB version = 5 (offline-db.js bilan mos)
 *   ✅ STATIC_FILES ga main.js, printer.js, scanner.js qo'shildi
 *   ✅ PAGES ga /register qo'shildi
 *   ✅ TTL endpointlar backend v2.2 ga moslashtirildi
 *   ✅ SW hech qachon stock kamaytirmaydi — faqat signal yuboradi
 *   ✅ 206 range request o'tkazilmaydi
 *   ✅ localStorage ishlatilmaydi — faqat IDB auth store
 */

const VER      = '5.0.62';
const C_STATIC = `nova-static-${VER}`;
const C_PAGES  = `nova-pages-${VER}`;
const C_API    = `nova-api-${VER}`;
const ALL_C    = [C_STATIC, C_PAGES, C_API];

const STATIC_FILES = [
  // '/static/css/fa.min.css', 
  '/static/js/offline-db.js',
  '/static/js/sync-manager.js',
  '/static/js/api.js',
  '/static/js/auth.js',
  '/static/js/main.js',
  '/static/js/cart.js',
  '/static/js/printer.js',
  '/static/js/scanner.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css',
];

const PAGES = [
  '/login', '/register',
  '/pos', '/products', '/sales/history',
  '/reports', '/settings', '/products/supply-history',
];

// API kesh muddatlari (soniya) — backend v2.2 endpointlari
const TTL = {
  // Hisobotlar — har doim yangi bo'lishi shart (0 - keshni chetlab o'tishga yaqin)
  '/api/reports':                       0,   // Doim tarmoqdan olishga urinadi (Network First)
  
  '/api/products/pos/':                 0,
  '/api/products':                      2,   // 2 sekunddan keyin eskirgan hisoblanadi
  
  // Mijoz va Ta'minotchilar — nisbatan kamroq o'zgaradi
  '/api/customers':                     5,   
  '/api/suppliers':                     5,   
  
  // Xodimlar va Do'kon sozlamalari
  '/api/employees':                    10,   
  '/api/stores':                       10,   

  // Profil ma'lumotlari — juda kam o'zgaradi
  '/api/auth/me':                      30,   

  // Superadmin qismi — sekundma-sekund yangilanish shart emas
  '/api/superadmin/tarifs':           120,   // 2 daqiqa
  '/api/superadmin/settings':         120,
  '/api/superadmin/stores':            60,
  '/api/superadmin/requests':          30,
};

// ─── INSTALL ─────────────────────────────────────────────────
self.addEventListener('install', e => {
  console.log(`[SW ${VER}] Install`);
  e.waitUntil(
    Promise.all([
      caches.open(C_STATIC).then(c =>
        Promise.allSettled(STATIC_FILES.map(u => c.add(u).catch(() => {})))
      ),
      caches.open(C_PAGES).then(c =>
        Promise.allSettled(PAGES.map(u => c.add(u).catch(() => {})))
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
  const { request: req } = e;
  const url = new URL(req.url);

  // 1. API FRAGMENTLARINI SW DAN MUSTASNO QILISH
  if (url.pathname.startsWith('/api/products/')) {
    e.respondWith(fetch(req)); 
    return;
  }
  const isFont = req.destination === 'font' || 
                 url.pathname.includes('webfonts') || 
                 url.pathname.endsWith('.woff2') || 
                 url.pathname.endsWith('.woff');

  if (isFont) {
    e.respondWith(_cacheFirst(req));
    return;
  }
  if (!url.protocol.startsWith('http')) return;
  if (req.headers.get('range')) return;
  if (req.method !== 'GET') return;

  if (url.pathname.startsWith('/api/')) {
    e.respondWith(_apiStrategy(req, url)); return;
  }

  // 2. Statik fayllar (CDN ham)
  if (
    url.pathname.startsWith('/static/') ||
    url.hostname.includes('cdnjs.cloudflare.com') ||
    url.hostname.includes('cdn.tailwindcss.com') ||
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com') ||
    url.hostname.includes('unpkg.com') ||
    url.hostname.includes('cdn.jsdelivr.net')
  ) {
    e.respondWith(_cacheFirst(req)); return;
  }

  // 3. HTML sahifalar — stale-while-revalidate
  if (req.headers.get('accept')?.includes('text/html')) {
    e.respondWith(_swrPage(req)); return;
  }
});

// ─── STRATEGIYALAR ───────────────────────────────────────────

async function _apiStrategy(req, url) {
  const cache  = await caches.open(C_API);
  const cached = await cache.match(req);

  if (cached) {
    // ✅ QO'SHILDI: Agar keshda 403 yoki 401 bo'lsa, uni o'chirib yuboramiz
    if (cached.status === 403 || cached.status === 401) {
      await cache.delete(req);
    } else {
      const at  = parseInt(cached.headers.get('x-sw-at') || '0');
      const ttl = _getTTL(url.pathname) * 1000;
      if (Date.now() - at < ttl) return cached;
    }
  }

  try {
    // ✅ req.clone() ishlatamiz, headerlar (Authorization) yo'qolmasligi uchun
    return await _fetchAndCache(req.clone(), cache, url.pathname);
  } catch {
    if (cached) return cached;
    return new Response('[]', { headers: { 'Content-Type': 'application/json', 'X-SW-Offline': '1' } });
  }
}

async function _fetchAndCache(req, cache, pathname) {
  // ✅ clone() orqali barcha headerlarni serverga yetkazamiz
  const res = await fetch(req); 
  
  // ✅ FAQAT status 200 bo'lsagina saqlaymiz. 403/404/500 hech qachon keshga kirmaydi!
  if (res.status === 200 && _shouldCache(pathname)) {
    const resClone = res.clone();
    const body = await resClone.blob();
    const headers = new Headers(resClone.headers);
    headers.set('x-sw-at', String(Date.now()));
    
    cache.put(req, new Response(body, {
      status: resClone.status,
      statusText: resClone.statusText,
      headers: headers
    }));
  }
  return res;
}

async function _cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;

  try {
    // Agar tashqi manba bo'lsa (CDN), uni keshga olish uchun maxsus request yuboramiz
    const fetchRequest = req.clone();
    const res = await fetch(fetchRequest);

    // Faqat to'g'ri kelgan javoblarni keshga olamiz
    if (res && (res.status === 200 || res.status === 0)) {
      const cache = await caches.open(C_STATIC);
      cache.put(req, res.clone());
      return res;
    }
    return res;
  } catch (err) {
    console.error("[SW] Fetch failed for:", req.url);
    return new Response('', { status: 503 });
  }
}
async function _swrPage(req) {
  const cache = await caches.open(C_PAGES);
  const cached = await cache.match(req);

  const netPromise = fetch(req.clone())
    .then(res => { if (res.ok) cache.put(req, res.clone()); return res; })
    .catch(() => null);

  // Keshda bor — darhol qaytaramiz, background da yangilanadi
  if (cached) {
    netPromise.catch(() => {});
    return cached; 
  }

  // Keshda yo'q — tarmoqdan olamiz
  const res = await netPromise;
  if (res) return res;

  // Tarmoq ham yo'q — login sahifasini qaytaramiz
  const login = await cache.match('/login');
  if (login) return login;

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

function _getTTL(path) {
  for (const [k, v] of Object.entries(TTL)) {
    if (path.startsWith(k)) return v;
  }
  return 30; // default 30 soniya
}

function _shouldCache(path) {
  return Object.keys(TTL).some(k => path.startsWith(k));
}

async function _notify(msg) {
  const list = await clients.matchAll({ includeUncontrolled: true, type: 'window' });
  list.forEach(c => c.postMessage(msg));
}

// ─── IDB (SW ichida — localStorage yo'q!) ────────────────────
// MUHIM: offline-db.js bilan bir xil DB_NAME va DB_VERSION ishlatiladi!

const DB_NAME    = 'novapos_db';
const DB_VERSION = 5;  // ← offline-db.js bilan MOS bo'lishi SHART

function _openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror   = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);

    req.onupgradeneeded = e => {
      const db = e.target.result;

      if (!db.objectStoreNames.contains('offline_sales')) {
        const s = db.createObjectStore('offline_sales', { keyPath: 'local_id', autoIncrement: true });
        s.createIndex('status',     'status');
        s.createIndex('created_at', 'created_at');
        s.createIndex('store_id',   'store_id');
      }
      if (!db.objectStoreNames.contains('auth'))
        db.createObjectStore('auth');

      if (!db.objectStoreNames.contains('offline_queue')) {
        const s = db.createObjectStore('offline_queue', { keyPath: 'id', autoIncrement: true });
        s.createIndex('status',   'status');
        s.createIndex('endpoint', 'endpoint');
      }
      if (!db.objectStoreNames.contains('products_cache')) {
        const s = db.createObjectStore('products_cache', { keyPath: 'id' });
        s.createIndex('barcode',    'barcode');
        s.createIndex('short_code', 'short_code');
      }
      if (!db.objectStoreNames.contains('customers_cache')) {
        const s = db.createObjectStore('customers_cache', { keyPath: 'id' });
        s.createIndex('phone', 'phone');
      }
      if (!db.objectStoreNames.contains('reports_cache'))
        db.createObjectStore('reports_cache');
      if (!db.objectStoreNames.contains('meta'))
        db.createObjectStore('meta');
    };
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
