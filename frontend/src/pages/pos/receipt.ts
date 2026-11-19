import { getUser } from '@/lib/auth';
import { dateTime, money, qty as fmtQty } from '@/lib/format';
import { isWeight, lineTotal, UNIT_SHORT, type CartItem } from './types';

// ── Printer: eski /static/js/printer.js (RawBT, Bluetooth, QZ Tray, brauzer) qayta ishlatiladi ──
interface LegacyPrinter { print: (text: string) => unknown; paperWidth?: number }
declare const printer: LegacyPrinter | undefined;   // printer.js dagi global `const printer`

let loading: Promise<void> | null = null;
function loadPrinter(): Promise<void> {
  if (typeof printer !== 'undefined') return Promise.resolve();
  loading ??= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = '/static/js/printer.js';
    s.onload = () => res();
    s.onerror = () => { loading = null; rej(new Error('Printer moduli yuklanmadi')); };
    document.head.appendChild(s);
  });
  return loading;
}
loadPrinter().catch(() => {});

export async function printText(text: string): Promise<void> {
  await loadPrinter();
  if (typeof printer === 'undefined') throw new Error('Printer moduli yuklanmadi');
  await printer.print(text);
}

/** Sozlamalar saqlangach — yuklangan printer moduli yangi usul/qog'ozni darhol olsin */
export function reloadPrinterSettings(): void {
  try { if (typeof printer !== 'undefined') (printer as unknown as { _loadSettings?: () => void })._loadSettings?.(); } catch { /* yo'q */ }
}

function paperWidth(): number {
  return (typeof printer !== 'undefined' && printer.paperWidth) || 32;   // 58mm = 32, 80mm = 48 belgi
}

export interface ReceiptData {
  number: string;
  date: string;          // ISO
  items: CartItem[];
  total: number;
  paid: number;
  method: 'naqd' | 'plastik' | 'nasiya';
  customer?: string | null;
  offline?: boolean;
  /** Qayta chiqarilgan chek */
  copy?: boolean;
}

export function storeName(): string {
  try { return localStorage.getItem('receipt_store_name') || getUser()?.store_name || 'NovaPOS'; } catch { return 'NovaPOS'; }
}
export function receiptFooter(): string {
  try { return localStorage.getItem('receipt_footer') || 'Rahmat! Qaytib keling!'; } catch { return 'Rahmat! Qaytib keling!'; }
}

const METHOD = { naqd: 'Naqd', plastik: 'Plastik karta', nasiya: 'Nasiya (qarz)' } as const;

/** Termoprinter uchun matnli chek (58mm / 80mm) */
export function receiptText(r: ReceiptData): string {
  const W = paperWidth();
  const m = (n: number) => money(n, false);
  const center = (t: string) => { t = t.slice(0, W); return ' '.repeat(Math.max(0, Math.floor((W - t.length) / 2))) + t; };
  const lr = (l: string, rt: string) => {
    const sp = W - l.length - rt.length;
    return sp >= 1 ? l + ' '.repeat(sp) + rt : l.slice(0, Math.max(0, W - rt.length - 1)) + ' ' + rt;
  };
  const wrap = (t: string) => { const out: string[] = []; while (t.length > W) { out.push(t.slice(0, W)); t = t.slice(W); } out.push(t); return out; };
  const line = '-'.repeat(W);
  const L: string[] = [];
  wrap(storeName().toUpperCase()).forEach((x) => L.push(center(x)));
  L.push(center(dateTime(r.date)), center(`Chek #${r.number}`));
  if (r.offline) L.push(center('(internetsiz)'));
  if (r.copy) L.push(center('(nusxa)'));
  L.push(line);
  for (const i of r.items) {
    wrap(i.name).forEach((x) => L.push(x));
    const q = isWeight(i.unit) ? `${fmtQty(i.qty)} ${UNIT_SHORT[i.unit]}` : fmtQty(i.qty);
    L.push(lr(`  ${q} x ${m(i.price)}`, m(lineTotal(i))));
  }
  L.push(line, lr('JAMI:', `${m(r.total)} so'm`), lr("To'lov:", METHOD[r.method]));
  if (r.customer) L.push(lr('Mijoz:', r.customer));
  if (r.paid > 0) L.push(lr("To'landi:", m(r.paid)));
  if (r.method !== 'nasiya' && r.paid > r.total) L.push(lr('Qaytim:', m(r.paid - r.total)));
  if (r.method === 'nasiya' && r.total - r.paid > 0) L.push(lr('Qarz:', m(r.total - r.paid)));
  L.push(line);
  wrap(receiptFooter()).forEach((x) => L.push(center(x)));
  L.push('', '');
  return L.join('\n');
}

// ── Ovozlar ──
const sounds: Record<'ok' | 'err', HTMLAudioElement | null> = { ok: null, err: null };
export function beep(kind: 'ok' | 'err') {
  try {
    sounds[kind] ??= new Audio(kind === 'ok' ? '/static/sounds/success.wav' : '/static/sounds/error.wav');
    const a = sounds[kind]!;
    a.currentTime = 0;
    a.play().catch(() => {});
  } catch { /* ovoz yo'q */ }
}
