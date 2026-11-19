// Oflayn sotuvlar navbati — eski offline-db.js dagi offlineSales bilan BIR XIL yozuv shakli,
// shuning uchun eski sahifalar va Service Worker ham shu navbatni yubora oladi.
// Server client_uid bo'yicha takrorni rad etadi — bir sotuv ikki marta yozilmaydi.
import { api, ApiError } from './api';
import { del, getAll, put } from './db';

export interface SalePayload {
  store_id: number;
  customer_id: number | null;
  payment_method: 'naqd' | 'plastik' | 'nasiya';
  paid_amount: number;
  client_uid: string;
  items: { product_id: number; quantity: number; price_out: number }[];
  is_offline?: boolean;
  offline_created_at?: string;
}

interface OfflineRecord {
  local_id?: number;
  data: SalePayload;
  store_id: number;
  created_at: string;
  status: 'pending' | 'failed' | 'syncing';
  retry_count: number;
  local_receipt: string;
  error?: string;
}

export function newClientUid(): string {
  try { if (crypto.randomUUID) return crypto.randomUUID(); } catch { /* eski brauzer */ }
  return 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
}

export async function queueOfflineSale(sale: SalePayload): Promise<void> {
  const now = new Date().toISOString();
  const rec: OfflineRecord = {
    data: { ...sale, is_offline: true, offline_created_at: sale.offline_created_at ?? now },
    store_id: sale.store_id,
    created_at: now,
    status: 'pending',
    retry_count: 0,
    local_receipt: 'OFFLINE-' + Date.now(),
  };
  await put('offline_sales', rec);
  // Brauzer qo'llasa — Service Worker internet qaytganda o'zi yuboradi
  try {
    const reg = await navigator.serviceWorker?.ready;
    await (reg as ServiceWorkerRegistration & { sync?: { register: (t: string) => Promise<void> } })?.sync?.register('sync-offline-sales');
  } catch { /* qo'llamaydi — syncOfflineSales() yuboradi */ }
}

export async function pendingCount(): Promise<number> {
  const all = await getAll<OfflineRecord>('offline_sales');
  return all.filter((r) => r.status === 'pending' || r.status === 'failed').length;
}

let syncing = false;

/** Navbatdagi sotuvlarni serverga yuboradi. Qaytaradi: yuborilganlar soni */
export async function syncOfflineSales(): Promise<number> {
  if (syncing || !navigator.onLine) return 0;
  syncing = true;
  let sent = 0;
  try {
    const all = await getAll<OfflineRecord>('offline_sales');
    for (const r of all.filter((x) => x.status === 'pending' || x.status === 'failed')) {
      try {
        await api('/api/sales/checkout', 'POST', r.data);
        await del('offline_sales', r.local_id!);
        sent++;
      } catch (e) {
        if (e instanceof ApiError && e.offline) break;     // internet yana uzildi
        await put('offline_sales', { ...r, status: 'failed', retry_count: r.retry_count + 1, error: (e as Error).message });
      }
    }
  } finally { syncing = false; }
  return sent;
}
