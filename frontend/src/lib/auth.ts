// Sessiya — eski sahifalar bilan UMUMIY (bir xil localStorage kalitlari),
// shuning uchun eski va yangi sahifalar orasida qayta kirish shart emas.

export type Role = 'admin' | 'cashier' | 'super_admin';

export interface UserInfo {
  user_id: number;
  store_id: number | null;
  full_name: string;
  username: string;
  role: Role;
  store_name?: string;
  payment_status?: string;
  expires_at?: string | null;
}

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function getToken(): string | null {
  return read('access_token');
}

export function getUser(): UserInfo | null {
  try {
    const raw = read('user_info');
    if (!raw) return null;
    const u = JSON.parse(raw);
    return { ...u, role: (u.role?.value ?? u.role) as Role };
  } catch {
    return null;
  }
}

export function isAdmin(u: UserInfo | null = getUser()): boolean {
  return u?.role === 'admin' || u?.role === 'super_admin';
}

export function clearSession(): void {
  try {
    ['access_token', 'user_info', 'cart', 'store_id'].forEach((k) => localStorage.removeItem(k));
  } catch { /* brauzer xotirasi yopiq */ }
}
