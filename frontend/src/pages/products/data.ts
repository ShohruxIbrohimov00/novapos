import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { Category } from '@/lib/products';

export interface Supplier { id: number; name: string; phone?: string | null; current_debt?: number }

export interface SupplyRow {
  id: number;
  product_id: number;
  product_name: string;
  quantity_received: number;
  supply_price: number;
  total_cost: number;
  unit_type: string;
  is_paid: boolean;
  supply_type?: string;
  supplier_name: string | null;
  employee_name: string | null;
  created_at: string | null;
}

export const SUPPLY_TYPE: Record<string, { label: string; tone: 'blue' | 'green' | 'amber' | 'gray' }> = {
  initial: { label: 'Yangi tovar', tone: 'blue' },
  restock: { label: 'Kirim', tone: 'green' },
  adjust: { label: 'Tuzatish', tone: 'amber' },
  return: { label: 'Qaytgan', tone: 'gray' },
};

/** Kategoriyalar ro'yxati — bir nechta joyda kerak, shuning uchun alohida hook */
export function useCategories() {
  const [list, setList] = useState<Category[]>([]);
  const [loaded, setLoaded] = useState(false);
  const reload = useCallback(async () => {
    try {
      const r = await api<Category[]>('/api/products/categories');
      setList([...r].sort((a, b) => a.name.localeCompare(b.name)));
    } catch { /* oflayn — bo'sh qoladi */ }
    setLoaded(true);
  }, []);
  useEffect(() => { reload(); }, [reload]);
  return { categories: list, loaded, reload };
}

export function useSuppliers() {
  const [list, setList] = useState<Supplier[]>([]);
  useEffect(() => {
    api<Supplier[]>('/api/suppliers/').then((r) => setList(Array.isArray(r) ? r : [])).catch(() => {});
  }, []);
  return list;
}
