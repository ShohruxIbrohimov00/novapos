import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { newClientUid, pendingCount, queueOfflineSale, syncOfflineSales, type SalePayload } from '@/lib/offlineSales';
import { useToast } from '@/components/ui';
import { CameraScanner } from './CameraScanner';
import { CartPanel } from './CartPanel';
import { CheckoutModal, type CheckoutResult } from './CheckoutModal';
import { ProductGrid, QuickChips } from './ProductGrid';
import { ProductSearch, type SearchHandle } from './ProductSearch';
import { beep, type ReceiptData } from './receipt';
import { ReceiptModal } from './ReceiptModal';
import { isWeight, type CartItem, type Product } from './types';
import { useCart } from './useCart';
import { useProducts } from './useProducts';
import { useScanner } from './useScanner';
import { WeightModal } from './WeightModal';
import './pos.css';

type MobileView = 'cart' | 'products';

export function PosPage() {
  const toast = useToast();
  const { products, ready, synced, refresh, decreaseStock } = useProducts();
  const cart = useCart();
  const [weightId, setWeightId] = useState<number | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [camera, setCamera] = useState(false);
  const [view, setView] = useState<MobileView>('cart');
  const [pending, setPending] = useState(0);
  const search = useRef<SearchHandle>(null);

  // printer.js va boshqa eski modullar xabarlarini React bildirishnomasiga yo'naltirish
  useEffect(() => {
    const w = window as unknown as { showToast?: (m: string, t?: string) => void };
    w.showToast = (m, t) => toast.show(m, (t as 'success' | 'error' | 'warning' | 'info') ?? 'info');
    return () => { delete w.showToast; };
  }, [toast]);

  // ── Oflayn navbat: kirishda va internet qaytganda yuborish
  const flushOffline = useCallback(async () => {
    const sent = await syncOfflineSales();
    if (sent) { toast.show(`${sent} ta oflayn sotuv serverga yuborildi`, 'success'); refresh(); }
    setPending(await pendingCount());
  }, [toast, refresh]);
  useEffect(() => {
    flushOffline();
    window.addEventListener('online', flushOffline);
    return () => window.removeEventListener('online', flushOffline);
  }, [flushOffline]);

  // ── Tovar qo'shish
  const pick = useCallback((p: Product) => {
    if (p.quantity <= 0) { beep('err'); toast.show(`${p.name} — omborda qolmagan`, 'error'); return; }
    setReceipt(null);                        // oldingi chek ochiq bo'lsa — yangi sotuv boshlanadi
    cart.add(p);
    beep('ok');
    if (isWeight(p.unit_type)) setWeightId(p.id);
  }, [cart, toast]);

  const byCode = useCallback(async (code: string) => {
    const local = products.find((p) => p.barcode === code || p.short_code === code);
    if (local) { pick(local); return; }
    try {
      const p = await api<Product>(`/api/products/scan/${encodeURIComponent(code)}`);
      if (p?.id) { pick(p); return; }
    } catch { /* topilmadi yoki oflayn */ }
    beep('err');
    toast.show(`"${code}" kodli tovar topilmadi`, 'error');
  }, [products, pick, toast]);

  useScanner(byCode);

  // ── Tezkor tugmalar: F2 — qidiruv, F4 — to'lov
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2') { e.preventDefault(); setView('products'); search.current?.focus(); }
      if (e.key === 'F4' && !document.querySelector('.ui-modal')) { e.preventDefault(); openCheckout(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  function openCheckout() {
    if (!cart.items.length) return;
    if (cart.pendingWeight.length) {
      toast.show(`Miqdor kiritilmagan: ${cart.pendingWeight.map((i) => i.name).join(', ')}`, 'warning');
      setWeightId(cart.pendingWeight[0].id);
      return;
    }
    setCheckoutOpen(true);
  }

  // ── Sotuvni yakunlash
  const finish = async (r: CheckoutResult) => {
    const user = getUser();
    const items: CartItem[] = cart.items.map((i) => ({ ...i }));
    const payload: SalePayload = {
      store_id: user?.store_id ?? 0,
      customer_id: r.customer?.id ?? null,
      payment_method: r.method,
      paid_amount: r.paid,
      client_uid: newClientUid(),
      items: items.map((i) => ({ product_id: i.id, quantity: i.qty, price_out: i.price })),
    };
    const done = (data: ReceiptData) => {
      decreaseStock(items.map((i) => ({ id: i.id, qty: i.qty })));
      cart.clear();
      setCheckoutOpen(false);
      setReceipt(data);
      setView('cart');
      beep('ok');
    };
    const base = { items, paid: r.paid, method: r.method, customer: r.customer?.name ?? null };

    setBusy(true);
    try {
      const res = await api<{ receipt_number: string; created_at: string; total_amount: number }>('/api/sales/checkout', 'POST', payload);
      done({ ...base, number: res.receipt_number, date: res.created_at, total: res.total_amount });
    } catch (e) {
      if (e instanceof ApiError && e.offline) {
        // Faqat internet yo'q bo'lsa — navbatga. Server rad etsa (qoldiq yetmaydi va h.k.) — sotuv O'TMAGAN.
        await queueOfflineSale(payload);
        setPending(await pendingCount());
        done({ ...base, number: 'OFFLINE', date: new Date().toISOString(), total: cart.total, offline: true });
      } else {
        beep('err');
        toast.show((e as Error).message, 'error');
      }
    } finally { setBusy(false); }
  };

  const weightItem = cart.items.find((i) => i.id === weightId) ?? null;

  return (
    <div className="pos" data-view={view}>
      <div className="pos__left">
        <div className="pos__bar">
          <ProductSearch ref={search} products={products} onPick={pick} onCode={byCode} onCamera={() => setCamera(true)} />
          {pending > 0 && (
            <button type="button" className="pos__pending" onClick={flushOffline} title="Yuborilmagan oflayn sotuvlar — bosib yuborish">
              <i className="fa-solid fa-cloud-arrow-up" aria-hidden="true" /> {pending}
            </button>
          )}
        </div>
        <QuickChips products={products} onPick={pick} />
        <div className="pos__switch" role="tablist" aria-label="Ko'rinish">
          <button type="button" role="tab" aria-selected={view === 'cart'} onClick={() => setView('cart')}>
            Savat{cart.items.length > 0 && <span className="pos__switch-count">{cart.items.length}</span>}
          </button>
          <button type="button" role="tab" aria-selected={view === 'products'} onClick={() => setView('products')}>Mahsulotlar</button>
        </div>
        <div className="pos__products">
          <ProductGrid products={products} loading={!ready && !synced} onPick={pick} />
        </div>
      </div>

      <CartPanel items={cart.items} total={cart.total} onQty={cart.setQty} onWeight={setWeightId}
                 onRemove={cart.remove} onClear={cart.clear} onCheckout={openCheckout} />

      <WeightModal item={weightItem} onClose={() => {
        // Miqdor kiritilmagan vaznli tovar savatda qolmasin
        if (weightItem && weightItem.qty <= 0) cart.remove(weightItem.id);
        setWeightId(null);
      }} onApply={(id, mode, v) => { if (mode === 'qty') cart.setQty(id, v); else cart.setTotal(id, v); setWeightId(null); }} />
      <CheckoutModal open={checkoutOpen} total={cart.total} busy={busy} onClose={() => setCheckoutOpen(false)} onSubmit={finish} />
      <ReceiptModal receipt={receipt} onClose={() => { setReceipt(null); if (window.innerWidth >= 768) search.current?.focus(); }} />
      <CameraScanner open={camera} onClose={() => setCamera(false)} onScan={byCode} />
    </div>
  );
}
