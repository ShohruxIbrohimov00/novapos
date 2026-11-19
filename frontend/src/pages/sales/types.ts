import type { Unit } from '@/lib/products';
import { localDate } from '@/lib/format';
import { getUser, isAdmin } from '@/lib/auth';

export type Method = 'naqd' | 'plastik' | 'nasiya';

export interface SaleItem {
  id: number;
  product_id: number;
  product_name: string;
  barcode: string | null;
  quantity: number;            // qaytarilganlardan keyin qolgani
  sold_quantity: number;
  returned_quantity: number;
  unit_price: number;
  final_amount: number;        // qolgan miqdor uchun (chegirma bilan)
  unit_type: Unit;
}

export interface Sale {
  id: number;
  receipt_number: string;
  total_amount: number;
  paid_amount: number;
  change_amount: number;
  payment_method: Method;
  customer_id: number | null;
  customer_name: string | null;
  employee_name: string | null;
  notes: string | null;
  is_cancelled: boolean;
  cancelled_by_name: string | null;
  refunded_amount: number;
  returns_count: number;
  fully_returned: boolean;
  created_at: string;
  items: SaleItem[];
}

export interface SaleReturn {
  id: number;
  sale_id?: number;
  receipt_number?: string;
  product_id: number;
  product_name: string;
  quantity: number;
  refund_amount: number;
  reason: string | null;
  employee_name: string;
  created_at: string;
}

export interface Summary {
  count: number;
  total: number;
  by_method: Record<Method, number>;
  returns_count: number;
  returns_amount: number;
  cancelled_count: number;
}

export const METHOD: Record<Method, { label: string; icon: string; tone: 'green' | 'blue' | 'amber' }> = {
  naqd: { label: 'Naqd', icon: 'fa-money-bill-wave', tone: 'green' },
  plastik: { label: 'Plastik', icon: 'fa-credit-card', tone: 'blue' },
  nasiya: { label: 'Nasiya', icon: 'fa-hand-holding-dollar', tone: 'amber' },
};

/** Kassir faqat bugungi chekdan qaytara oladi (backend ham shunday tekshiradi) */
export function canReturn(s: Sale): boolean {
  if (s.is_cancelled || !s.items.length) return false;
  return isAdmin(getUser()) || localDate(new Date(s.created_at)) === localDate();
}

/** Chek raqami ko'rinishi: "CH-AB12CD34" → "AB12CD34" */
export const shortReceipt = (r: string) => r.replace(/^CH-/, '');
