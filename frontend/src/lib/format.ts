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

/** Foydalanuvchi yozgan sonni o'qish: "12 500", "1,5" → 12500, 1.5. Bo'sh/xato → NaN */
export function parseNum(s: string | number | null | undefined): number {
  if (typeof s === 'number') return s;
  const t = String(s ?? '').replace(/[\s ]/g, '').replace(',', '.');
  if (!t) return NaN;
  return /^-?\d*\.?\d+$/.test(t) || /^-?\d+\.$/.test(t) ? Number(t) : NaN;
}

/** Raqam maydoni uchun: faqat raqam va bitta nuqta/vergul qoldiradi */
export function cleanNumInput(s: string, decimals = true): string {
  let t = s.replace(/[^\d.,]/g, '').replace(',', '.');
  if (!decimals) return t.replace(/\./g, '');
  const i = t.indexOf('.');
  if (i >= 0) t = t.slice(0, i + 1) + t.slice(i + 1).replace(/\./g, '');
  return t;
}
