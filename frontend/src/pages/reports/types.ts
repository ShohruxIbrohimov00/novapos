export interface Dashboard {
  total_sales: number;
  total_profit: number;
  sales_count: number;
  cash: number;
  card: number;
  debt: number;
  returns: number;
  inventory_cost: number;
  potential_profit: number;
  expenses: number;
  supplier_debt: number;
  customer_debt: number;
  net_profit: number;
}

export interface TopProduct { name: string; quantity: number; total_amount: number; total_profit: number }

export interface Expense { id: number; amount: number; category: string; notes: string | null; created_at: string | null }

export interface Supplier {
  id: number;
  name: string;
  phone: string | null;
  address: string | null;
  notes: string | null;
  current_debt: number;
  total_supplied: number;
  total_paid: number;
}

export interface SupplierHistoryRow {
  id: number;
  type: 'payment' | 'supply';
  amount: number;
  date: string;
  note: string;
  method: string;
  quantity?: number;
  product_name?: string | null;
  unit_type?: string;
  unit_price?: number;
  is_paid?: boolean;
}

export const EXPENSE_CATS: { value: string; icon: string }[] = [
  { value: 'Ijara', icon: 'fa-house' },
  { value: 'Ish haqi', icon: 'fa-user-tie' },
  { value: 'Kommunal', icon: 'fa-bolt' },
  { value: 'Soliq', icon: 'fa-landmark' },
  { value: 'Transport', icon: 'fa-truck' },
  { value: 'Tushlik', icon: 'fa-utensils' },
  { value: "Xo'jalik", icon: 'fa-broom' },
  { value: 'Boshqa', icon: 'fa-wallet' },
];
export const expenseIcon = (c: string) => EXPENSE_CATS.find((x) => x.value.toLowerCase() === c.toLowerCase())?.icon ?? 'fa-wallet';
