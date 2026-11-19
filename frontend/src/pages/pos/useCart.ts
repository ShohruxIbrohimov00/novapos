import { useCallback, useEffect, useMemo, useState } from 'react';
import { isWeight, lineTotal, type CartItem, type Product } from './types';

const KEY = 'pos_cart_v2';

function load(): CartItem[] {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}

/** Savat — sahifa yangilansa ham saqlanadi */
export function useCart() {
  const [items, setItems] = useState<CartItem[]>(load);

  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* yopiq */ } }, [items]);

  /** Qo'shadi. Vaznli tovar 0 miqdor bilan qo'shiladi (miqdor oynasi ochiladi). */
  const add = useCallback((p: Product) => {
    setItems((list) => {
      const ex = list.find((i) => i.id === p.id);
      if (ex) {
        if (isWeight(ex.unit)) return list;                      // vazn — oynada o'zgartiriladi
        return list.map((i) => (i.id === p.id ? { ...i, qty: i.qty + 1, stock: p.quantity } : i));
      }
      return [...list, { id: p.id, name: p.name, unit: p.unit_type, price: p.price_out, qty: isWeight(p.unit_type) ? 0 : 1, stock: p.quantity }];
    });
  }, []);

  const setQty = useCallback((id: number, qty: number) => {
    setItems((list) => list
      .map((i) => (i.id === id ? { ...i, qty: Math.max(0, Math.round(qty * 1000) / 1000), fixedTotal: undefined } : i))
      .filter((i) => i.qty > 0 || isWeight(i.unit)));
  }, []);

  /** Vaznli tovar: summa bo'yicha (masalan "10 000 so'mlik go'sht") */
  const setTotal = useCallback((id: number, total: number) => {
    setItems((list) => list.map((i) => (i.id === id && i.price > 0
      ? { ...i, qty: Math.round((total / i.price) * 1000) / 1000, fixedTotal: Math.round(total) } : i)));
  }, []);

  const remove = useCallback((id: number) => setItems((l) => l.filter((i) => i.id !== id)), []);
  const clear = useCallback(() => setItems([]), []);

  const total = useMemo(() => items.reduce((s, i) => s + lineTotal(i), 0), [items]);
  const pendingWeight = useMemo(() => items.filter((i) => isWeight(i.unit) && i.qty <= 0), [items]);

  return { items, add, setQty, setTotal, remove, clear, total, pendingWeight };
}
