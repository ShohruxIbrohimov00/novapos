import type { Role } from '@/lib/auth';

export interface Me {
  id: number;
  username: string;
  full_name: string;
  role: Role;
  store: { id: number | null; name: string | null; payment_status: string; expires_at: string | null; days_left: number | null };
}

export interface StoreInfo {
  id: number;
  name: string;
  phone: string | null;
  address: string | null;
  payment_status: string;
  subscription_expires_at: string | null;
  days_left: number | null;
}

export interface Tarif { id: number; name: string; price: number; months: number; description?: string | null }
export interface PaymentSettings { card_number: string; card_owner: string; support_phone: string }

export interface Employee {
  id: number;
  full_name: string;
  username: string;
  role: 'admin' | 'sotuvchi' | 'super_admin';
  is_active: boolean;
  last_seen_at: string | null;
}
