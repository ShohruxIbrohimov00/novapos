export interface Customer {
  id: number;
  full_name: string;
  phone: string | null;
  address: string | null;
  notes: string | null;
  current_debt: number;
  total_debt_given: number;
  total_debt_paid: number;
  is_active: boolean;
  created_at: string | null;
  last_purchase_date: string | null;
}

export type HistoryRow =
  | { type: 'sale'; date: string; amount: number; paid: number; debt: number; receipt: string; method: string;
      items: { name: string; qty: number; price: number }[] }
  | { type: 'payment'; date: string; amount: number; method: string; note: string | null };

export const hasDebt = (c: Customer) => (c.current_debt ?? 0) > 0.01;
