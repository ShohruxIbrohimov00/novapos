import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAll } from './db';
import { newClientUid, pendingCount, queueOfflineSale, syncOfflineSales, type SalePayload } from './offlineSales';

const sale = (over: Partial<SalePayload> = {}): SalePayload => ({
  store_id: 1, customer_id: null, payment_method: 'naqd', paid_amount: 1500, client_uid: newClientUid(),
  items: [{ product_id: 1, quantity: 1, price_out: 1500 }], ...over,
});

async function clearQueue() {
  const { del } = await import('./db');
  for (const r of await getAll<{ local_id: number }>('offline_sales')) await del('offline_sales', r.local_id);
}

beforeEach(async () => {
  await clearQueue();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  localStorage.setItem('access_token', 't');
});

describe('newClientUid', () => {
  it('har safar har xil', () => {
    const s = new Set(Array.from({ length: 200 }, newClientUid));
    expect(s.size).toBe(200);
  });
});

describe('oflayn navbat', () => {
  it("navbatga qo'shadi: is_offline va asl vaqt bilan", async () => {
    await queueOfflineSale(sale());
    const [r] = await getAll<{ data: SalePayload; status: string }>('offline_sales');
    expect(r.status).toBe('pending');
    expect(r.data.is_offline).toBe(true);
    expect(r.data.offline_created_at).toMatch(/Z$/);         // UTC — server Toshkentga o'giradi
    expect(await pendingCount()).toBe(1);
  });

  it('internet qaytganda yuboradi va navbatdan o\'chiradi', async () => {
    await queueOfflineSale(sale());
    await queueOfflineSale(sale());
    const f = vi.fn().mockImplementation(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', f);
    expect(await syncOfflineSales()).toBe(2);
    expect(await pendingCount()).toBe(0);
    const body = JSON.parse(f.mock.calls[0][1].body);
    expect(body.client_uid).toBeTruthy();                    // server takrorni shu bo'yicha rad etadi
    vi.unstubAllGlobals();
  });

  it("server rad etsa — 'failed' bo'lib qoladi, yo'qolmaydi", async () => {
    await queueOfflineSale(sale());
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () =>
      new Response('{"detail":"Mahsulot topilmadi"}', { status: 400, headers: { 'content-type': 'application/json' } })));
    expect(await syncOfflineSales()).toBe(0);
    const [r] = await getAll<{ status: string; retry_count: number; error: string }>('offline_sales');
    expect(r.status).toBe('failed');
    expect(r.retry_count).toBe(1);
    expect(r.error).toBe('Mahsulot topilmadi');
    expect(await pendingCount()).toBe(1);                    // keyinroq qayta urinadi
    vi.unstubAllGlobals();
  });

  it("yuborish o'rtasida internet uzilsa — to'xtaydi, qolganlar navbatda", async () => {
    await queueOfflineSale(sale());
    await queueOfflineSale(sale());
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    expect(await syncOfflineSales()).toBe(0);
    const all = await getAll<{ status: string }>('offline_sales');
    expect(all.map((r) => r.status)).toEqual(['pending', 'pending']);
    vi.unstubAllGlobals();
  });

  it('oflayn — umuman urinmaydi', async () => {
    await queueOfflineSale(sale());
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    expect(await syncOfflineSales()).toBe(0);
    expect(f).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
