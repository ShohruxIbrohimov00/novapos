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
      localStorage.removeItem('super_token');
      location.href = '/superadmin/stores';
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
  location.href = '/login';
  return { ok: true };
}
