import type { Unit } from '@/lib/products';

export { isWeight, UNIT_SHORT, WEIGHT_UNITS } from '@/lib/products';
export type { Product, Unit } from '@/lib/products';

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

export const lineTotal = (i: CartItem) => Math.round(i.fixedTotal ?? i.qty * i.price);
