// Tizimdan chiqish — eski sahifalardagi doLogout() bilan bir xil qoidalar.
import { clearSession } from './auth';
import { openDb } from './db';
import { pendingCount, syncOfflineSales } from './offlineSales';

export type LogoutResult = { ok: true } | { ok: false; pending: number };

/**
 * Yuborilmagan oflayn sotuvlar bo'lsa — chiqilmaydi (ular boshqa foydalanuvchi
 * nomidan yuborilib qolmasin). Aks holda: API keshi, token va savat tozalanadi.
 */
export async function logout(): Promise<LogoutResult> {
  let n = 0;
  try { n = await pendingCount(); } catch { /* IDB yo'q */ }
  if (n > 0) {
    if (navigator.onLine) syncOfflineSales().catch(() => {});
    return { ok: false, pending: n };
  }

  // Superadmin do'konga "kirgan" bo'lsa — o'z hisobiga qaytadi
  try {
    const sup = localStorage.getItem('super_token');
    if (sup) {
      localStorage.setItem('access_token', sup);
      const su = localStorage.getItem('super_user_info');
      if (su) localStorage.setItem('user_info', su);
      ['super_token', 'super_user_info', 'pos_cart_v2'].forEach((k) => localStorage.removeItem(k));
      try { navigator.serviceWorker?.controller?.postMessage({ type: 'CLEAR_API_CACHE' }); } catch { /* SW yo'q */ }
      location.href = '/app/superadmin/stores';
      return { ok: true };
    }
  } catch { /* xotira yopiq */ }

  try { navigator.serviceWorker?.controller?.postMessage({ type: 'CLEAR_API_CACHE' }); } catch { /* SW yo'q */ }
  try {
    const db = await openDb();
    if (db.objectStoreNames.contains('auth')) {
      await new Promise<void>((res) => { const tx = db.transaction('auth', 'readwrite'); tx.objectStore('auth').clear(); tx.oncomplete = () => res(); tx.onerror = () => res(); });
    }
  } catch { /* IDB yo'q */ }
  clearSession();
  try { localStorage.removeItem('pos_cart_v2'); } catch { /* xotira yopiq */ }
  location.href = '/app/login';
  return { ok: true };
}

/** Superadmin do'kon nomidan kiradi (yordam berish uchun). Chiqishda o'z hisobiga qaytadi. */
export function impersonate(token: string, userInfo: unknown): void {
  try {
    if (!localStorage.getItem('super_token')) {
      localStorage.setItem('super_token', localStorage.getItem('access_token') || '');
      localStorage.setItem('super_user_info', localStorage.getItem('user_info') || '');
    }
    localStorage.setItem('access_token', token);
    localStorage.setItem('user_info', JSON.stringify(userInfo));
    localStorage.removeItem('pos_cart_v2');
  } catch { /* xotira yopiq */ }
  try { navigator.serviceWorker?.controller?.postMessage({ type: 'CLEAR_API_CACHE' }); } catch { /* SW yo'q */ }
  location.href = '/app/pos';
}

export function isImpersonating(): boolean {
  try { return !!localStorage.getItem('super_token'); } catch { return false; }
}
