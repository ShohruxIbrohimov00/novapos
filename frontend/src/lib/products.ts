// Mahsulot turi — Kassa va Ombor uchun umumiy.

export type Unit = 'dona' | 'kg' | 'litr' | 'metr' | 'blok';

export interface Product {
  id: number;
  name: string;
  barcode: string | null;
  short_code: string | null;
  unit_type: Unit;
  price_in: number;
  price_out: number;
  quantity: number;
  min_stock_limit?: number;
  category_id: number | null;
  category_name?: string | null;
  description?: string | null;
  is_deleted?: boolean;
  updated_at?: string | null;
}

export interface Category { id: number; name: string }

export const UNITS: { value: Unit; label: string }[] = [
  { value: 'dona', label: 'Dona' },
  { value: 'kg', label: 'Kg' },
  { value: 'litr', label: 'Litr' },
  { value: 'metr', label: 'Metr' },
  { value: 'blok', label: 'Blok' },
];
export const WEIGHT_UNITS: Unit[] = ['kg', 'litr', 'metr'];
export const isWeight = (u: Unit) => WEIGHT_UNITS.includes(u);
export const UNIT_SHORT: Record<Unit, string> = { dona: 'dona', kg: 'kg', litr: 'l', metr: 'm', blok: 'blok' };

/** Kam qolgan: qoldiq minimal limitdan oshmaydi */
export const isLow = (p: Product) => p.quantity <= (p.min_stock_limit ?? 0);

export const NO_CATEGORY = 'Kategoriyasiz';
export const categoryOf = (p: Product) => p.category_name || NO_CATEGORY;
