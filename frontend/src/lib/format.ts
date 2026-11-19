// Pul va sana formatlari — butun ilovada bir xil ko'rinish uchun.

const nf = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });

/** 12500 → "12 500 so'm" */
export function money(v: number | null | undefined, withUnit = true): string {
  const s = nf.format(Math.round(v ?? 0)).replace(/ /g, ' ');
  return withUnit ? `${s} so'm` : s;
}

/** Miqdor: 2 → "2", 1.5 → "1.5", 0.333333 → "0.333" */
export function qty(v: number | null | undefined): string {
  return String(Math.round((v ?? 0) * 1000) / 1000);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO → "18.11.2026 14:05" (qurilmaning mahalliy vaqti) */
export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Mahalliy sana YYYY-MM-DD (UTC emas — Toshkentda tun yarmida sana siljimasin) */
export function localDate(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const PAYMENT_LABEL: Record<string, string> = {
  naqd: 'Naqd',
  plastik: 'Plastik karta',
  nasiya: 'Nasiya',
};
