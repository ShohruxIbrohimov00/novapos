/**
 * NovaPOS — API Client v5.0
 * ==========================
 * Backend (/api/*) bilan to'liq mos:
 *   ✅ /api/auth      — login, pin, register, me, change-*
 *   ✅ /api/products  — CRUD, scan, adjust-stock, categories
 *   ✅ /api/sales     — checkout, history, cancel, return
 *   ✅ /api/customers — CRUD, debt, history
 *   ✅ /api/reports   — dashboard, top-products, expenses
 *   ✅ /api/employees — CRUD, toggle, reset-pin/password
 *   ✅ /api/suppliers — CRUD, receive-goods, payments
 *   ✅ /api/subscriptions — payment, upload-proof, requests
 *   ✅ /api/superadmin — stores, tarifs, settings
 *   ✅ /api/ai        — scan (Gemini)
 *   ✅ FormData (multipart) upload qo'llab-quvvatlaydi
 *   ✅ Offline: GET → IDB, POST checkout → offline queue
 *   ✅ 401 → /login redirect, 402 → paywall
 */

// ── Xabar ajratish ────────────────────────────────────────────
function _msg(detail) {
  if (!detail) return 'Xatolik yuz berdi';
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail.map(e => {
      const field = Array.isArray(e.loc) ? e.loc[e.loc.length - 1] : 'xato';
      return `${field}: ${e.msg}`;
    }).join(', ');
  }
  if (typeof detail === 'object')
    return detail.message || detail.detail || detail.msg || JSON.stringify(detail);
  return String(detail);
}

// ── Asosiy so'rov ─────────────────────────────────────────────
async function apiRequest(endpoint, method = 'GET', data = null, silent = false) {
  const token    = localStorage.getItem('access_token');
  const deviceId = localStorage.getItem('device_id') || 'pos_web';

  // /api prefix ikki marta bo'lib ketmasligi uchun
  const url = endpoint.startsWith('/api') ? endpoint : `/api${endpoint}`;

  // ── OFFLINE ───────────────────────────────────────────────
  if (!navigator.onLine) {
    if (method === 'GET') return _offlineGet(url);

    // Checkout offline uchun alohida handler
    if (url === '/api/sales/checkout' && method === 'POST')
      return _offlineSaveSale(data);

    // Boshqa mutatsiyalar → offline_queue
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && window.NovaPOS_DB) {
      await NovaPOS_DB.offlineOps.add(url, method, data).catch(() => {});
    }
    const err = Object.assign(new Error("Internet aloqasi yo'q"), { offline: true });
    throw err;
  }

  // ── ONLINE ────────────────────────────────────────────────
  const isFormData = data instanceof FormData;
  const headers    = { 'X-Device-Id': deviceId };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (!isFormData && data) headers['Content-Type'] = 'application/json';

  const cfg = { method, headers, cache: 'no-store' };
  if (data && ['POST', 'PUT', 'PATCH'].includes(method))
    cfg.body = isFormData ? data : JSON.stringify(data);

  try {
    const response = await fetch(url, cfg);

    // JSON javob olish
    let resData = null;
    const ct = response.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      resData = await response.json();
    }

    // 401 — token muddati tugagan yoki noto'g'ri
    if (response.status === 401) {
      _handleUnauthorized();
      return null;
    }

    // 402 — obuna tugagan
    if (response.status === 402) {
      const code = resData?.detail?.code || resData?.code || null;
      _handlePaywall(code);
      const err = new Error(_msg(resData?.detail) || 'Obuna muddati tugagan');
      err.status = 402;
      err.code   = code;
      throw err;
    }

    // Boshqa xatoliklar
    if (!response.ok) {
      const msg = _msg(resData?.detail) || resData?.message || 'Xatolik yuz berdi';
      if (!silent) showToast(msg, 'error');
      const err = new Error(msg);
      err.status = response.status;
      err.data   = resData;
      throw err;
    }

    // Muvaffaqiyatli — IDB ga kesh
    _cacheResponse(url, resData);

    return resData;

  } catch (error) {
    // Qayta ishlov berilgan xato (status bor)
    if (error.status) {
      if (!silent) console.error(`[API] ${method} ${url} → ${error.status}:`, error.message);
      throw error;
    }
    // Network xatosi (fetch throw qildi)
    console.warn('[API] Network xato, IDB fallback:', url, error.message);
    const cached = await _offlineGet(url);
    if (cached !== null) return cached;
    if (!silent) showToast("Internet aloqasi yo'q", 'warning');
    throw error;
  }
}

// ── FormData yuklash (fayl yuklash uchun) ─────────────────────
async function apiUpload(endpoint, formData, silent = false) {
  return apiRequest(endpoint, 'POST', formData, silent);
}

// ── Offline GET: IDB dan fallback ─────────────────────────────
async function _offlineGet(url) {
  if (!window.NovaPOS_DB) return null;
  try {
    // Mahsulotlar ro'yxati
    if (/^\/api\/products\/?(\?.*)?$/.test(url))
      return NovaPOS_DB.products.getAll();

    // Mahsulot barcode/short_code skan
    const scanMatch = url.match(/^\/api\/products\/scan\/([^?]+)/);
    if (scanMatch)
      return NovaPOS_DB.products.getByCode(scanMatch[1]);

    // Mahsulot qidirish
    const searchMatch = url.match(/^\/api\/products\/search\?.*q=([^&]+)/);
    if (searchMatch)
      return NovaPOS_DB.products.search(decodeURIComponent(searchMatch[1]));

    // Bitta mahsulot
    const productMatch = url.match(/^\/api\/products\/(\d+)$/);
    if (productMatch)
      return NovaPOS_DB.products.getById(parseInt(productMatch[1]));

    // Mijozlar ro'yxati
    if (/^\/api\/customers\/?(\?.*)?$/.test(url))
      return NovaPOS_DB.customers.getAll();

    // Bitta mijoz
    const customerMatch = url.match(/^\/api\/customers\/(\d+)$/);
    if (customerMatch)
      return NovaPOS_DB.customers.getById(parseInt(customerMatch[1]));

    // Joriy foydalanuvchi ma'lumotlari
    if (url.includes('/api/auth/me'))
      return JSON.parse(localStorage.getItem('user_info') || 'null');

    // Tariflar (superadmin)
    if (url.includes('/api/superadmin/tarifs'))
      return JSON.parse(localStorage.getItem('cached_tarifs') || '[]');

    // Dashboard
    if (url.includes('/api/reports/dashboard'))
      return NovaPOS_DB.reportsCache.get('dashboard').catch(() => null);

    return null;
  } catch (e) {
    console.warn('[API] IDB fallback xato:', e);
    return null;
  }
}

// ── Offline checkout saqlash ───────────────────────────────────
async function _offlineSaveSale(saleData) {
  if (!window.NovaPOS_DB) {
    showToast('Offline rejim ishlamayapti', 'error');
    return null;
  }
  try {
    const saved = await NovaPOS_DB.offlineSales.add(saleData);

    // Mahsulot stokini darhol IDB da kamaytir (Optimistic UI)
    if (saleData.items?.length) {
      await NovaPOS_DB.products.batchDecreaseStock(
        saleData.items.map(i => ({ product_id: i.product_id, quantity: i.quantity }))
      ).catch(() => {});
    }

    // Chek ma'lumotlari qaytarish (real server javobiga o'xshash)
    const total = saleData.items?.reduce((s, i) =>
      s + i.quantity * (i.price_out || 0), 0) || 0;

    return {
      offline:        true,
      local_id:       saved.local_id,
      receipt_number: saved.local_receipt,
      total_amount:   total,
      paid_amount:    saleData.paid_amount || 0,
      change_amount:  Math.max(0, (saleData.paid_amount || 0) - total),
      payment_method: saleData.payment_method,
      is_cancelled:   false,
      created_at:     saved.created_at,
    };
  } catch (e) {
    console.error('[API] Offline sotuv saqlashda xato:', e);
    showToast('Offline saqlashda xato', 'error');
    return null;
  }
}

// ── IDB kesh yangilash ─────────────────────────────────────────
function _cacheResponse(url, data) {
  if (!window.NovaPOS_DB || !data) return;

  // Token ni ham IDB ga saqlash (SW uchun)
  const token = localStorage.getItem('access_token');
  if (token) NovaPOS_DB.auth.saveToken(token).catch(() => {});

  // Faqat root list endpointlari uchun (scan, /{id} EMAS)
  if (/^\/api\/products\/?(\?.*)?$/.test(url) && Array.isArray(data)) {
    NovaPOS_DB.products.saveAll(data).catch(() => {});
    return;
  }

  if (/^\/api\/customers\/?(\?.*)?$/.test(url) && Array.isArray(data)) {
    NovaPOS_DB.customers.saveAll(data).catch(() => {});
    return;
  }

  // Tariflar (superadmin)
  if (/^\/api\/superadmin\/tarifs/.test(url) && Array.isArray(data)) {
    localStorage.setItem('cached_tarifs', JSON.stringify(data));
    return;
  }

  // Dashboard kesh
  if (/^\/api\/reports\/dashboard/.test(url) && data) {
    NovaPOS_DB.reportsCache.save('dashboard', data).catch(() => {});
    return;
  }

  // Foydalanuvchi ma'lumotlari
  if (url === '/api/auth/me' && data) {
    localStorage.setItem('user_info', JSON.stringify(data));
    return;
  }
}

// ── Auth: 401 ─────────────────────────────────────────────────
function _handleUnauthorized() {
  const path = window.location.pathname;
  if (path === '/login' || path === '/register') return;

  // SuperAdmin do'kon sessiyasidan chiqish
  const superToken = localStorage.getItem('super_token');
  if (superToken) {
    localStorage.setItem('access_token', superToken);
    localStorage.removeItem('super_token');
    window.location.href = '/superadmin/stores';
    return;
  }

  localStorage.removeItem('access_token');
  window.location.href = '/login';
}

// ── Auth: 402 (paywall) ───────────────────────────────────────
function _handlePaywall(code) {
  const pw = document.getElementById('paywall-screen');
  if (pw) pw.classList.remove('hidden');
}

// ── Device ID (har qurilma uchun yagona) ──────────────────────
(function _initDeviceId() {
  if (!localStorage.getItem('device_id')) {
    const id = 'pos_' + Date.now().toString(36) + '_' +
               Math.random().toString(36).slice(2, 8);
    localStorage.setItem('device_id', id);
  }
})();

// ── Toast fallback (base.html da aniqlanmagan bo'lsa) ──────────
// base.html dagi showToast override qiladi, bu faqat fallback
if (typeof window.showToast !== 'function') {
  window.showToast = function(message, type = 'info') {
    const colors = {
      success: '#10b981', error: '#ef4444',
      warning: '#f59e0b', info:  '#3b82f6',
    };
    const el = document.createElement('div');
    el.style.cssText = `
      position:fixed;bottom:6rem;left:50%;
      transform:translateX(-50%);
      background:${colors[type] || colors.info};
      color:#fff;padding:.75rem 1.5rem;
      border-radius:1rem;font-size:.875rem;
      font-weight:700;z-index:99999;
      max-width:90vw;text-align:center;
      box-shadow:0 4px 20px rgba(0,0,0,.25);
      pointer-events:none;
    `;
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  };
}
