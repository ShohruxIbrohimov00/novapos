/**
 * NovaPOS — Main Utilities v5.1 (Pure CSS, Tailwindsiz)
 * ======================================================
 * base.html v7.0 ga to'liq moslashtirilgan
 */

// ── Joriy foydalanuvchi ─────────────────────────────────────
const USER     = (() => { try { return JSON.parse(localStorage.getItem('user_info')||'{}'); } catch { return {}; } })();
const STORE_ID = USER?.store_id || null;

// ============================================================
// FORMAT FUNKSIYALAR
// ============================================================

function formatMoney(amount, currency = "so'm") {
  if (amount === null || amount === undefined) return `0 ${currency}`;
  const n = parseFloat(amount);
  if (isNaN(n)) return `0 ${currency}`;
  return n.toLocaleString('uz-UZ') + ' ' + currency;
}

function formatMoneyShort(amount) {
  const n = parseFloat(amount) || 0;
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + ' mln';
  if (n >= 1_000)     return (n / 1_000).toFixed(0) + ' ming';
  return String(Math.round(n));
}

function formatDate(dateString, withTime = true) {
  if (!dateString) return '—';
  try {
    const d = new Date(dateString);
    if (isNaN(d)) return dateString;
    const date = d.toLocaleDateString('uz-UZ');
    if (!withTime) return date;
    const time = d.toLocaleTimeString('uz-UZ', { hour:'2-digit', minute:'2-digit' });
    return `${date} ${time}`;
  } catch { return dateString; }
}

function formatDateShort(dateString) {
  if (!dateString) return '—';
  try {
    const d    = new Date(dateString);
    const diff = (Date.now() - d) / 1000;
    if (diff < 60)    return 'Hozir';
    if (diff < 3600)  return `${Math.floor(diff/60)} daqiqa oldin`;
    if (diff < 86400) return `${Math.floor(diff/3600)} soat oldin`;
    return d.toLocaleDateString('uz-UZ');
  } catch { return dateString; }
}

function formatPhone(phone) {
  if (!phone) return '—';
  const clean = phone.replace(/\D/g, '');
  if (clean.startsWith('998') && clean.length === 12)
    return `+998 ${clean.slice(3,5)} ${clean.slice(5,8)} ${clean.slice(8,10)} ${clean.slice(10)}`;
  return phone;
}

function formatQty(qty, unitType = 'dona') {
  const n = parseFloat(qty) || 0;
  if (unitType === 'kg' || unitType === 'litr') return n.toFixed(3);
  return n % 1 === 0 ? String(n) : n.toFixed(2);
}

// ============================================================
// TOAST
// ============================================================

function showToast(message, type = 'info') {
  const wrap = document.getElementById('toast-wrap');
  const icon = document.getElementById('toast-icon');
  const msg  = document.getElementById('toast-msg');

  /* base.html ichida #toast-wrap yo'q bo'lsa — fallback */
  if (!wrap) {
    const colors = { error:'#ef4444', success:'#10b981', warning:'#f59e0b', info:'#3b82f6' };
    const t = document.createElement('div');
    t.textContent = message;
    t.style.cssText = `
      position: fixed; bottom: 5rem; left: 50%; transform: translateX(-50%);
      background: ${colors[type] || colors.info};
      color: #fff; padding: .75rem 1.5rem; border-radius: 1rem;
      font-size: .875rem; font-weight: 700; z-index: 99999; pointer-events: none;
    `;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3200);
    return;
  }

  /* Toast rangi va ikonkasi — sof CSS klasslari bilan */
  const cfg = {
    success: { cls: 'toast-success', ic: 'fa-circle-check'         },
    warning: { cls: 'toast-warning', ic: 'fa-triangle-exclamation'  },
    error:   { cls: 'toast-error',   ic: 'fa-circle-exclamation'    },
    info:    { cls: 'toast-info',    ic: 'fa-circle-info'           },
  }[type] || { cls: 'toast-info', ic: 'fa-circle-info' };

  /* Eski type klassini olib, yangisini qo'shamiz */
  wrap.classList.remove('toast-success', 'toast-warning', 'toast-error', 'toast-info');
  wrap.classList.add(cfg.cls, 'show');

  if (icon) icon.className = `fa-solid ${cfg.ic} toast-icon-el`;
  if (msg)  msg.textContent = message;

  if (window._toastTimer) clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => wrap.classList.remove('show'), 3200);
}

// ============================================================
// VIBRO / BEEP
// ============================================================

function playBeep(isError = false) {
  navigator.vibrate?.(isError ? [100, 50, 100] : 80);
}

// ============================================================
// CONFIRM MODAL  (sof CSS, Tailwindsiz)
// ============================================================

/**
 * showConfirmModal(options)
 *
 * options = {
 *   title:       'Sarlavha',
 *   message:     'Matn',
 *   confirmText: 'Ha',
 *   cancelText:  'Bekor',
 *   type:        'danger' | 'warning' | 'info',
 *   onConfirm:   () => {},
 * }
 */
function showConfirmModal({
  title       = 'Tasdiqlang',
  message     = '',
  confirmText = 'Ha',
  cancelText  = 'Bekor',
  type        = 'danger',
  onConfirm   = () => {},
} = {}) {

  document.getElementById('__confirm-modal')?.remove();

  const colors = {
    danger:  { icon:'fa-arrow-right-from-bracket', iconBg:'#fee2e2', iconColor:'#ef4444', btnBg:'#ef4444', btnHover:'#dc2626' },
    warning: { icon:'fa-triangle-exclamation',     iconBg:'#fef3c7', iconColor:'#f59e0b', btnBg:'#f59e0b', btnHover:'#d97706' },
    info:    { icon:'fa-circle-info',              iconBg:'#dbeafe', iconColor:'#3b82f6', btnBg:'#3b82f6', btnHover:'#2563eb' },
  };
  const c = colors[type] || colors.danger;

  const modal = document.createElement('div');
  modal.id = '__confirm-modal';
  modal.style.cssText = `
    position: fixed; inset: 0; z-index: 99998;
    background: rgba(15,23,42,.55);
    backdrop-filter: blur(6px);
    display: flex; align-items: center; justify-content: center;
    padding: 1rem;
    animation: __cfadeIn .18s ease;
  `;

  modal.innerHTML = `
    <style>
      @keyframes __cfadeIn  { from{opacity:0} to{opacity:1} }
      @keyframes __cslideUp {
        from { transform: translateY(20px) scale(.97); opacity: 0; }
        to   { transform: translateY(0) scale(1);     opacity: 1; }
      }
      #__confirm-sheet {
        background: var(--surface, #fff);
        border-radius: 24px;
        padding: 32px 28px 24px;
        width: 100%; max-width: 360px;
        box-shadow: 0 24px 60px rgba(0,0,0,.18);
        animation: __cslideUp .22s cubic-bezier(.4,0,.2,1);
        text-align: center;
        font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
      }
      [data-theme="dark"] #__confirm-sheet {
        background: #1e293b;
        box-shadow: 0 24px 60px rgba(0,0,0,.5);
      }
      #__confirm-icon-wrap {
        width: 64px; height: 64px; border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        margin: 0 auto 18px;
        background: ${c.iconBg};
      }
      #__confirm-icon-wrap i { font-size: 26px; color: ${c.iconColor}; }
      #__confirm-title {
        font-size: 18px; font-weight: 900;
        color: var(--text, #0f172a); margin-bottom: 8px;
      }
      #__confirm-msg {
        font-size: 14px; color: var(--text2, #64748b);
        line-height: 1.5; margin-bottom: 24px;
      }
      #__confirm-btns { display: flex; gap: 10px; }
      #__confirm-cancel {
        flex: 1; height: 48px; border-radius: 14px;
        border: 1.5px solid var(--border, #e2e8f0);
        background: var(--surface2, #f8fafc);
        color: var(--text2, #475569);
        font-size: 14px; font-weight: 800;
        cursor: pointer; transition: all .15s;
        font-family: inherit;
      }
      #__confirm-cancel:hover {
        background: var(--bg, #f1f5f9);
        border-color: var(--border2, #cbd5e1);
      }
      #__confirm-ok {
        flex: 1; height: 48px; border-radius: 14px;
        border: none;
        background: ${c.btnBg}; color: #fff;
        font-size: 14px; font-weight: 900;
        cursor: pointer; transition: all .15s;
        font-family: inherit;
        box-shadow: 0 4px 14px ${c.iconBg};
      }
      #__confirm-ok:hover  { background: ${c.btnHover}; transform: translateY(-1px); }
      #__confirm-ok:active { transform: scale(.97); }
    </style>

    <div id="__confirm-sheet">
      <div id="__confirm-icon-wrap">
        <i class="fa-solid ${c.icon}"></i>
      </div>
      <div id="__confirm-title">${title}</div>
      <div id="__confirm-msg">${message}</div>
      <div id="__confirm-btns">
        <button id="__confirm-cancel">${cancelText}</button>
        <button id="__confirm-ok">${confirmText}</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  modal.querySelector('#__confirm-cancel').onclick = () => modal.remove();
  modal.querySelector('#__confirm-ok').onclick = () => { modal.remove(); onConfirm(); };
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

  const onKey = e => {
    if (e.key === 'Escape') { modal.remove(); document.removeEventListener('keydown', onKey); }
  };
  document.addEventListener('keydown', onKey);
  setTimeout(() => modal.querySelector('#__confirm-cancel')?.focus(), 50);
}

// ── Logout ──────────────────────────────────────────────────
function _doLogout() {
  localStorage.removeItem('access_token');
  localStorage.removeItem('user_info');
  localStorage.removeItem('cart');
  window.location.href = '/login';
}

// ── Offline badge ────────────────────────────────────────────
function _updateOfflineBadge(count) {
  const badge   = document.getElementById('offline-badge');
  const countEl = document.getElementById('offline-count');
  if (!badge) return;
  if (count > 0) {
    if (countEl) countEl.textContent = count;
    badge.classList.add('visible');
    navigator.setAppBadge?.(count).catch(() => {});
  } else {
    badge.classList.remove('visible');
    navigator.clearAppBadge?.().catch(() => {});
  }
}

// ── Offline bar ──────────────────────────────────────────────
function _setOfflineBar(visible) {
  const bar = document.getElementById('offline-bar');
  if (bar) bar.classList.toggle('visible', visible);

  /* WS dot rangini ham yangilash */
  const dot = document.getElementById('ws-dot');
  if (visible && dot) {
    dot.style.background  = 'var(--warning, #f59e0b)';
    dot.style.boxShadow   = '0 0 6px var(--warning, #f59e0b)';
  }
}

// ============================================================
// SERVICE WORKER
// ============================================================

let _pendingSW = null;

async function _registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js', {
      scope: '/', updateViaCache: 'none',
    });

    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw?.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
          _pendingSW = nw;
          document.getElementById('sw-update-banner')?.classList.add('visible');
        }
      });
    });

    navigator.serviceWorker.addEventListener('message', ({ data }) => {
      if (data?.type === 'SALE_SYNCED') {
        showToast('Offline sotuv serverga yuborildi ✓', 'success');
        window.NovaPOS_DB?.offlineSales?.getCount().then(_updateOfflineBadge).catch(() => {});
      }
    });
  } catch(e) { console.warn('[SW]', e); }
}

function _applySwUpdate() {
  _pendingSW?.postMessage({ type: 'SKIP_WAITING' });
  document.getElementById('sw-update-banner')?.classList.remove('visible');
  setTimeout(() => location.reload(), 300);
}

// ============================================================
// NAVIGATION
// ============================================================

function renderNavigation() {
  let u = {};
  try { u = JSON.parse(localStorage.getItem('user_info') || '{}'); } catch {}

  const role      = u.role?.value || u.role || 'cashier';
  const path      = location.pathname;
  const storeName = u.store_name || u.store?.name || 'NovaPOS';
  const fullName  = u.full_name  || u.username    || '—';
  const roleLabel = { admin:'Administrator', cashier:'Kassir', super_admin:'SuperAdmin' }[role] || role;

  const elStore = document.getElementById('sidebar-store');
  const elUser  = document.getElementById('sidebar-user');
  const elRole  = document.getElementById('sidebar-role');
  if (elStore) elStore.textContent = storeName;
  if (elUser)  elUser.textContent  = fullName;
  if (elRole)  elRole.textContent  = roleLabel;

  let links = [];
  if (role === 'super_admin') {
    links = [
      { href:'/superadmin',          icon:'fa-chart-pie',           label:'Dashboard'  },
      { href:'/superadmin/stores',   icon:'fa-shop',                label:"Do'konlar"  },
      { href:'/superadmin/requests', icon:'fa-hand-holding-dollar', label:"To'lovlar"  },
    ];
  } else {
    links = [
      { href:'/pos',           icon:'fa-cash-register', label:'Kassa'   },
      { href:'/sales/history', icon:'fa-receipt',       label:'Tarix'   },
      { href:'/products',      icon:'fa-box-archive',   label:'Ombor'   },
      ...(role === 'admin' ? [{ href:'/reports', icon:'fa-chart-column', label:'Hisobot' }] : []),
      { href:'/settings',      icon:'fa-gears',         label:'Sozlama' },
    ];
  }

  const isActive = href =>
    (href === '/superadmin' || href === '/pos') ? path === href : path.startsWith(href);

  /* Desktop sidebar */
  const side = document.getElementById('nav-sidebar');
  if (side) {
    side.innerHTML = links.map(l => `
      <a href="${l.href}"
         class="nav-link${isActive(l.href) ? ' active' : ''}"
         hx-get="${l.href}"
         hx-target="#page-content"
         hx-select="#page-content"
         hx-push-url="true"
         title="${l.label}">
        <i class="fa-solid ${l.icon} nl-icon"></i>
      </a>`).join('');
      
    if (typeof htmx !== 'undefined') htmx.process(side);
  }

  /* Mobil bottom nav */
  const mob = document.getElementById('nav-mobile');
  if (mob) {
    mob.innerHTML = links.map(l => `
      <a href="${l.href}"
         class="nav-link nav-link--mobile${isActive(l.href) ? ' active' : ''}"
         hx-get="${l.href}"
         hx-target="#page-content"
         hx-select="#page-content"
         hx-push-url="true"
         title="${l.label}">
        <i class="fa-solid ${l.icon} nl-icon"></i>
      </a>`).join('');
      
    // HTMX yangi qo'shilgan linklarni tanishi uchun "process" qilamiz
    if (typeof htmx !== 'undefined') htmx.process(mob);
  }
}

// ============================================================
// PAYWALL YORDAMCHILARI
// ============================================================

async function _loadPaywallData() {
  try {
    const tarifs = await apiRequest('/api/superadmin/tarifs', 'GET', null, true);
    const sel = document.getElementById('paywall-tarif-id');
    if (sel && tarifs?.length) {
      sel.innerHTML = '<option value="">Tarif tanlang...</option>' +
        tarifs.map(t =>
          `<option value="${t.id}">${t.name} — ${parseInt(t.price).toLocaleString()} so'm (${t.months} oy)</option>`
        ).join('');
    }
  } catch {}

  try {
    const s = await apiRequest('/api/superadmin/settings/payment', 'GET', null, true);
    if (s) {
      const cn = document.getElementById('paywall-card-number');
      const co = document.getElementById('paywall-card-owner');
      if (cn) cn.innerText = s.card_number || '•••• •••• •••• ••••';
      if (co) co.innerText = (s.card_owner || 'NOVAPOS').toUpperCase();
    }
  } catch {}
}

function _copyPaywallCard() {
  const num = (document.getElementById('paywall-card-number')?.innerText || '').replace(/\s/g, '');
  navigator.clipboard?.writeText(num)
    .then(()  => showToast('Karta raqami nusxalandi!', 'success'))
    .catch(()  => showToast('Nusxalashda xato', 'error'));
}

async function handleAutoProofUpload(input) {
  if (!input.files?.[0]) return;

  const tarifId = document.getElementById('paywall-tarif-id')?.value;
  if (!tarifId) { showToast('Avval tarifni tanlang!', 'error'); input.value = ''; return; }

  const file = input.files[0];
  if (file.size > 5 * 1024 * 1024) { showToast("Fayl 5MB dan kichik bo'lsin", 'error'); input.value = ''; return; }

  const statusDiv = document.getElementById('paywall-status');
  const statusCon = document.getElementById('paywall-status-content');
  const label     = document.getElementById('paywall-upload-label');

  statusDiv?.classList.remove('hidden');
  if (statusCon) statusCon.innerHTML = '<div class="spinner spinner-sm" style="margin-right:8px"></div><span>Yuklanmoqda...</span>';
  if (label) label.style.cssText = 'pointer-events:none; opacity:.6';

  const fd = new FormData();
  fd.append('file', file);
  fd.append('tarif_id', tarifId);

  try {
    const res  = await fetch('/api/subscriptions/upload-proof', {
      method: 'POST',
      headers: { Authorization: `Bearer ${localStorage.getItem('access_token')}` },
      body: fd,
    });
    const data = await res.json();

    if (res.ok) {
      /* Muvaffaqiyat holati — sof CSS klasslari */
      if (statusDiv) {
        statusDiv.style.cssText = 'background:#f0fdf4; border-color:#bbf7d0; border-radius:16px; padding:16px';
      }
      if (statusCon) {
        statusCon.style.cssText = 'display:flex; align-items:center; justify-content:center; gap:12px; color:#15803d; font-weight:700; font-size:14px';
        statusCon.innerHTML = '<i class="fa-solid fa-circle-check" style="font-size:20px"></i><span>Yuborildi!</span>';
      }
      showToast('Chek yuborildi!', 'success');
    } else {
      throw new Error(data?.detail?.message || data?.detail || 'Xato');
    }
  } catch(e) {
    /* Xato holati */
    if (statusDiv) {
      statusDiv.style.cssText = 'background:#fff1f2; border-color:#fecdd3; border-radius:16px; padding:16px';
    }
    if (statusCon) {
      statusCon.style.cssText = 'display:flex; align-items:center; justify-content:center; gap:12px; color:#be123c; font-weight:700; font-size:14px';
      statusCon.innerHTML = `<i class="fa-solid fa-circle-xmark" style="font-size:20px"></i><span>${e.message}</span>`;
    }
    if (label) label.style.cssText = '';
    input.value = '';
    showToast('Xatolik: ' + e.message, 'error');
  }
}

// ============================================================
// WS DOT HOLATI — sof CSS bilan
// ============================================================

function _wsSetState(state) {
  /* state: 'online' | 'connecting' | 'offline' */
  const dot = document.getElementById('ws-dot');
  const lbl = document.getElementById('ws-label');
  if (!dot) return;

  const cfg = {
    online:     { bg: 'var(--success, #22c55e)', shadow: '0 0 8px var(--success, #22c55e)', label: 'Ulangan'    },
    connecting: { bg: 'var(--warning, #f59e0b)', shadow: 'none',                             label: 'Ulanmoqda'  },
    offline:    { bg: 'var(--warning, #f59e0b)', shadow: '0 0 6px var(--warning, #f59e0b)', label: 'Offline'    },
  }[state] || { bg: 'var(--border2)', shadow: 'none', label: '' };

  dot.style.background = cfg.bg;
  dot.style.boxShadow  = cfg.shadow;
  if (lbl) lbl.textContent = cfg.label;
}

// ============================================================
// DOMContentLoaded
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
  const path        = location.pathname;
  const publicPaths = ['/login', '/register'];
  const isPublic    = publicPaths.includes(path);

  /* Offline holat */
  _setOfflineBar(!navigator.onLine);
  window.addEventListener('online',  () => { _setOfflineBar(false); _wsSetState('online'); });
  window.addEventListener('offline', () => { _setOfflineBar(true);  _wsSetState('offline'); });

  document.addEventListener('offline-count-changed', e => _updateOfflineBadge(e.detail?.count || 0));

  if (window.NovaPOS_DB) {
    const n = await NovaPOS_DB.offlineSales?.getCount().catch(() => 0) || 0;
    _updateOfflineBadge(n);
  }

  await _registerSW();
  if (isPublic) return;

  /* Token tekshiruvi */
  const token = localStorage.getItem('access_token');
  if (!token) { window.location.href = '/login'; return; }

  let ui = {};
  try { ui = JSON.parse(localStorage.getItem('user_info') || '{}'); } catch {}
  const role = ui.role?.value || ui.role || '';

  /* Paywall */
  if (role !== 'super_admin') {
    const ps = ui.store?.payment_status || ui.payment_status || '';
    if (ps === 'pending' || ps === 'expired') {
      document.getElementById('paywall-screen')?.classList.add('show');
      _loadPaywallData();
    }
  }

  /* Navigatsiya */
  renderNavigation();

  /* WS hodisalari */
  document.addEventListener('novapos:ws-connected',    () => _wsSetState('online'));
  document.addEventListener('novapos:ws-disconnected', () => _wsSetState('connecting'));

  /* Auto-sync */
  if (window.SyncManager) SyncManager.startAutoSync();
});