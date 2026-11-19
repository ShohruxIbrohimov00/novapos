// Barcha server so'rovlari shu yerdan o'tadi.
// - Token qo'shiladi (eski sahifalar bilan bir xil localStorage kaliti)
// - 401 → /login, 402 → Sozlamalar → Obuna
// - Internet yo'qligi alohida xato turi (ApiError.offline)
import { clearSession, getToken } from './auth';

export class ApiError extends Error {
  status: number;
  offline: boolean;
  constructor(message: string, status = 0, offline = false) {
    super(message);
    this.status = status;
    this.offline = offline;
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

function detailToMessage(detail: unknown): string {
  if (!detail) return 'Xatolik yuz berdi';
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) return detail.map((e) => e?.msg ?? String(e)).join(', ');
  if (typeof detail === 'object') {
    const d = detail as Record<string, unknown>;
    return String(d.message ?? d.detail ?? d.msg ?? JSON.stringify(d));
  }
  return String(detail);
}

const AUTH_CALL = /^\/api\/auth\/(login|login-pin|register-store)/;

export async function api<T = unknown>(path: string, method: Method = 'GET', body?: unknown): Promise<T> {
  const url = path.startsWith('/api') ? path : `/api${path}`;
  // O'zgartirish so'rovlari internetsiz darhol rad etiladi.
  // O'qish (GET) esa baribir yuboriladi — Service Worker javobni keshdan beradi.
  if (method !== 'GET' && !navigator.onLine) throw new ApiError("Internet aloqasi yo'q", 0, true);

  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      cache: 'no-store',
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Internet aloqasi yo'q", 0, true);
  }
  // Service Worker: tarmoq yo'q va keshda ham yo'q
  if (res.headers.get('X-SW-Offline')) throw new ApiError("Internet aloqasi yo'q", 0, true);

  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const data = isJson ? await res.json().catch(() => null) : null;

  if (res.status === 401 && !AUTH_CALL.test(url)) {
    clearSession();
    location.replace('/login');
    throw new ApiError('Sessiya tugagan', 401);
  }
  if (res.status === 402) {
    if (!location.pathname.startsWith('/settings')) location.href = '/settings#obuna';
    throw new ApiError("Obuna muddati tugagan. To'lov qiling.", 402);
  }
  if (!res.ok) throw new ApiError(detailToMessage(data?.detail ?? data), res.status);
  return data as T;
}
