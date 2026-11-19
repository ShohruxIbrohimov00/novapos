import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { getAll, replaceAll } from '@/lib/db';
import type { Product } from './types';

/**
 * Mahsulotlar: avval qurilma keshidan (darhol, oflayn ham), keyin serverdan.
 * Server ro'yxati faqat o'zgargan bo'lsa qayta chiziladi — lip-lip qilmaydi.
 */
export function useProducts() {
  const [products, setProducts] = useState<Product[]>([]);
  const [ready, setReady] = useState(false);       // keshdan yoki serverdan nimadir keldi
  const [synced, setSynced] = useState(false);     // serverdan yangi ro'yxat olindi
  const sigRef = useRef('');

  const apply = useCallback((list: Product[]) => {
    const alive = list.filter((p) => !p.is_deleted);
    const sig = alive.map((p) => `${p.id}|${p.name}|${p.quantity}|${p.price_out}|${p.barcode}|${p.short_code}`).join(';');
    if (sig !== sigRef.current) { sigRef.current = sig; setProducts(alive); }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const list = await api<Product[]>('/api/products/');
      if (Array.isArray(list)) {
        apply(list);
        setSynced(true); setReady(true);
        replaceAll('products_cache', list).catch(() => {});
      }
    } catch { /* oflayn — keshdagi ro'yxat qoladi */ }
  }, [apply]);

  useEffect(() => {
    let cancelled = false;
    getAll<Product>('products_cache').then((cached) => {
      if (cancelled) return;
      if (cached.length) { apply(cached); setReady(true); }
    });
    refresh();
    // Boshqa kassada sotuv bo'lsa ham qoldiq yangilanib tursin
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onFocus);
    return () => { cancelled = true; window.removeEventListener('focus', onFocus); window.removeEventListener('online', onFocus); };
  }, [apply, refresh]);

  /** Sotuvdan keyin qoldiqni darhol kamaytirish (ekranda ham, keshda ham) */
  const decreaseStock = useCallback((sold: { id: number; qty: number }[]) => {
    setProducts((list) => {
      const next = list.map((p) => {
        const s = sold.find((x) => x.id === p.id);
        return s ? { ...p, quantity: Math.max(0, Math.round((p.quantity - s.qty) * 1000) / 1000) } : p;
      });
      replaceAll('products_cache', next).catch(() => {});
      return next;
    });
  }, []);

  return { products, ready, synced, refresh, decreaseStock };
}
