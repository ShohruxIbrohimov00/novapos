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
  is_deleted?: boolean;
}

export interface CartItem {
  id: number;            // product id
  name: string;
  unit: Unit;
  price: number;         // sotuv narxi (1 birlik)
  qty: number;           // vaznli tovarda 0 bo'lishi mumkin — miqdor kutilmoqda
  /** Vaznli tovar summa bo'yicha kiritilgan bo'lsa — aniq summa */
  fixedTotal?: number;
  stock: number;
}

export const WEIGHT_UNITS: Unit[] = ['kg', 'litr', 'metr'];
export const isWeight = (u: Unit) => WEIGHT_UNITS.includes(u);
export const UNIT_SHORT: Record<Unit, string> = { dona: 'dona', kg: 'kg', litr: 'l', metr: 'm', blok: 'blok' };

export const lineTotal = (i: CartItem) => Math.round(i.fixedTotal ?? i.qty * i.price);
