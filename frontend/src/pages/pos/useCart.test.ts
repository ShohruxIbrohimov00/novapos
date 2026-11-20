import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Product } from '@/lib/products';
import { lineTotal } from './types';
import { useCart } from './useCart';

const prod = (over: Partial<Product> = {}): Product => ({
  id: 1, name: 'Non', unit_type: 'dona', price_out: 4000, price_in: 3000, quantity: 10, ...over,
} as Product);

beforeEach(() => localStorage.clear());

describe('useCart', () => {
  it("dona tovar: qo'shish va takror qo'shish", () => {
    const { result } = renderHook(() => useCart());
    act(() => { result.current.add(prod()); result.current.add(prod()); });
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].qty).toBe(2);
    expect(result.current.total).toBe(8000);
  });

  it("vaznli tovar 0 miqdor bilan qo'shiladi va kutilayotganlar ro'yxatida", () => {
    const { result } = renderHook(() => useCart());
    act(() => result.current.add(prod({ id: 2, unit_type: 'kg', price_out: 50000 })));
    expect(result.current.items[0].qty).toBe(0);
    expect(result.current.pendingWeight).toHaveLength(1);
    act(() => result.current.add(prod({ id: 2, unit_type: 'kg', price_out: 50000 })));
    expect(result.current.items[0].qty).toBe(0);          // ikkinchi bosish miqdorni oshirmaydi
  });

  it('setQty: 3 xonagacha yaxlitlaydi, 0 bo\'lsa dona tovar o\'chadi', () => {
    const { result } = renderHook(() => useCart());
    act(() => result.current.add(prod()));
    act(() => result.current.setQty(1, 2.34567));
    expect(result.current.items[0].qty).toBe(2.346);
    act(() => result.current.setQty(1, 0));
    expect(result.current.items).toHaveLength(0);
  });

  it("vaznli tovar 0 ga tushsa ham savatda qoladi", () => {
    const { result } = renderHook(() => useCart());
    act(() => result.current.add(prod({ unit_type: 'kg' })));
    act(() => result.current.setQty(1, 0));
    expect(result.current.items).toHaveLength(1);
  });

  it("summa bo'yicha (10 000 so'mlik go'sht)", () => {
    const { result } = renderHook(() => useCart());
    act(() => result.current.add(prod({ unit_type: 'kg', price_out: 60000 })));
    act(() => result.current.setTotal(1, 10000));
    const it0 = result.current.items[0];
    expect(it0.qty).toBe(0.167);
    expect(lineTotal(it0)).toBe(10000);                   // aniq summa, yaxlitlash xatosisiz
    act(() => result.current.setQty(1, 0.5));
    expect(result.current.items[0].fixedTotal).toBeUndefined();
    expect(result.current.total).toBe(30000);
  });

  it("remove va clear", () => {
    const { result } = renderHook(() => useCart());
    act(() => { result.current.add(prod()); result.current.add(prod({ id: 2 })); });
    act(() => result.current.remove(1));
    expect(result.current.items.map((i) => i.id)).toEqual([2]);
    act(() => result.current.clear());
    expect(result.current.items).toEqual([]);
  });

  it('sahifa yangilansa ham saqlanadi', () => {
    const a = renderHook(() => useCart());
    act(() => a.result.current.add(prod()));
    a.unmount();
    const b = renderHook(() => useCart());
    expect(b.result.current.items).toHaveLength(1);
  });

  it("buzilgan saqlangan savat — bo'sh savat", () => {
    localStorage.setItem('pos_cart_v2', '{buzuq');
    const { result } = renderHook(() => useCart());
    expect(result.current.items).toEqual([]);
  });
});
