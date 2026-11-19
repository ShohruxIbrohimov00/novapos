import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '@/lib/api';
import { dateTime, localDate, money, qty as fmtQty } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import { Badge, Button, EmptyState, Field, Modal, Page, Skeleton, Tabs } from '@/components/ui';
import { SaleDetail } from './SaleDetail';
import { METHOD, shortReceipt, type Method, type Sale, type SaleReturn, type Summary } from './types';
import '../products/products.css';
import './sales.css';

type View = 'sales' | 'returns';
type Period = 'today' | 'yesterday' | 'week' | 'month' | 'custom';
const STEP = 100;
const pad = (n: number) => String(n).padStart(2, '0');
const hm = (iso: string) => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

function range(p: Period, from: string, to: string): [string, string] {
  const t = new Date();
  const d = (days: number) => localDate(new Date(t.getFullYear(), t.getMonth(), t.getDate() - days));
  if (p === 'today') return [d(0), d(0)];
  if (p === 'yesterday') return [d(1), d(1)];
  if (p === 'week') return [d(6), d(0)];
  if (p === 'month') return [localDate(new Date(t.getFullYear(), t.getMonth(), 1)), d(0)];
  return [from || d(0), to || from || d(0)];
}

function useWide(q = '(min-width: 1100px)') {
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return m;
}

/** Chek raqamiga o'xshaydimi: "CH-AB12", "ab12cd34" (harf+raqam, 4–8 belgi) */
const looksLikeReceipt = (s: string) => /^(ch-)?[a-z0-9]{4,8}$/i.test(s) && /\d/.test(s) && /[a-z]/i.test(s.replace(/^ch-/i, ''));

export function SalesPage() {
  const wide = useWide();
  const [params, setParams] = useSearchParams();
  const view = (params.get('v') as View) || 'sales';
  const [period, setPeriod] = useState<Period>('today');
  const [from, setFrom] = useState(localDate());
  const [to, setTo] = useState(localDate());
  const [method, setMethod] = useState<Method | 'all' | 'cancelled'>('all');
  const [q, setQ] = useState('');
  const [debQ, setDebQ] = useState('');
  const [limit, setLimit] = useState(STEP);
  const [openId, setOpenId] = useState<number | null>(null);
  const [start, end] = range(period, from, to);

  useEffect(() => { const t = setTimeout(() => setDebQ(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => { setLimit(STEP); }, [start, end, method, view]);

  const receiptQ = looksLikeReceipt(debQ) ? debQ : '';
  const salesUrl = receiptQ
    ? `/api/sales/history?receipt=${encodeURIComponent(receiptQ)}`
    : `/api/sales/history?start_date=${start}&end_date=${end}&limit=${limit}`
      + (method === 'cancelled' ? '&include_cancelled=true' : method !== 'all' ? `&payment_method=${method}` : '');

  const sales = useAsync(() => (view === 'sales' ? api<Sale[]>(salesUrl) : Promise.resolve([] as Sale[])), [salesUrl, view]);
  const summary = useAsync(() => api<Summary>(`/api/sales/summary?start_date=${start}&end_date=${end}`), [start, end]);
  const rets = useAsync(() => (view === 'returns' ? api<SaleReturn[]>(`/api/sales/returns?start_date=${start}&end_date=${end}&limit=500`) : Promise.resolve([] as SaleReturn[])), [start, end, view]);

  // Ochilgan chek — har doim serverdan yangisi (qaytarish/bekor qilishdan keyin ham)
  const detail = useAsync(() => (openId ? api<Sale>(`/api/sales/${openId}`) : Promise.resolve(null)), [openId]);

  const list = useMemo(() => {
    let l = sales.data ?? [];
    if (method === 'cancelled' && !receiptQ) l = l.filter((s) => s.is_cancelled);
    const term = receiptQ ? '' : debQ.toLowerCase();
    if (term) {
      l = l.filter((s) => (s.customer_name ?? '').toLowerCase().includes(term)
        || (s.employee_name ?? '').toLowerCase().includes(term)
        || s.receipt_number.toLowerCase().includes(term)
        || s.items.some((i) => i.product_name.toLowerCase().includes(term)));
    }
    return l;
  }, [sales.data, method, debQ, receiptQ]);

  const retList = useMemo(() => {
    const term = debQ.toLowerCase();
    return (rets.data ?? []).filter((r) => !term || r.product_name.toLowerCase().includes(term) || (r.receipt_number ?? '').toLowerCase().includes(term) || (r.reason ?? '').toLowerCase().includes(term));
  }, [rets.data, debQ]);

  const changed = () => { sales.reload(); summary.reload(); detail.reload(); if (view === 'returns') rets.reload(); };
  const opened = detail.data && detail.data.id === openId ? detail.data : (sales.data ?? []).find((s) => s.id === openId) ?? null;
  const S = summary.data;
  const setView = (v: View) => { setOpenId(null); setParams(v === 'sales' ? {} : { v }, { replace: true }); };

  const methodChips: { key: Method | 'all' | 'cancelled'; label: string; n?: number }[] = [
    { key: 'all', label: 'Hammasi', n: S?.count },
    { key: 'naqd', label: 'Naqd' }, { key: 'plastik', label: 'Plastik' }, { key: 'nasiya', label: 'Nasiya' },
    { key: 'cancelled', label: 'Bekor qilingan', n: S?.cancelled_count },
  ];

  const listBody = view === 'returns' ? (
    rets.loading && !rets.data ? <div className="sl-list">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} height={64} radius={14} />)}</div>
      : !retList.length ? <EmptyState icon="fa-rotate-left" title="Qaytarish yo'q" text="Bu davrda tovar qaytarilmagan" />
      : (
        <ul className="sl-list">
          {retList.map((r) => (
            <li key={r.id}>
              <button type="button" className="sl-row" onClick={() => r.sale_id && setOpenId(r.sale_id)} aria-current={openId === r.sale_id || undefined}>
                <div className="sl-row__main">
                  <div className="sl-row__top"><b>{r.product_name}</b> <span>× {fmtQty(r.quantity)}</span></div>
                  <div className="sl-row__meta">{dateTime(r.created_at)} · #{shortReceipt(r.receipt_number ?? '')} · {r.employee_name}{r.reason && ` · ${r.reason}`}</div>
                </div>
                <div className="sl-row__sum tone-danger">−{money(r.refund_amount, false)}</div>
              </button>
            </li>
          ))}
        </ul>
      )
  ) : sales.error && !sales.data ? (
    <EmptyState icon={sales.error.offline ? 'fa-wifi' : 'fa-triangle-exclamation'} title={sales.error.offline ? "Internet yo'q" : 'Yuklanmadi'}
                text={sales.error.message} action={<Button variant="ghost" onClick={sales.reload}>Qayta urinish</Button>} />
  ) : sales.loading && !sales.data ? (
    <div className="sl-list">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} height={68} radius={14} />)}</div>
  ) : !list.length ? (
    <EmptyState icon="fa-receipt" title={receiptQ ? 'Chek topilmadi' : debQ ? 'Hech narsa topilmadi' : 'Bu davrda sotuv yo\'q'}
                text={receiptQ ? `"${receiptQ}" raqamli chek yo'q` : undefined} />
  ) : (
    <>
      <ul className="sl-list">
        {list.map((s) => {
          const m = METHOD[s.payment_method] ?? METHOD.naqd;
          const names = s.items.map((i) => i.product_name);
          return (
            <li key={s.id}>
              <button type="button" className={`sl-row${s.is_cancelled ? ' is-cancelled' : ''}`} onClick={() => setOpenId(s.id)}
                      aria-current={openId === s.id || undefined}>
                <div className="sl-row__time">{hm(s.created_at)}{period !== 'today' && period !== 'yesterday' && !receiptQ ? <small>{dateTime(s.created_at).slice(0, 5)}</small> : receiptQ ? <small>{dateTime(s.created_at).slice(0, 10)}</small> : null}</div>
                <div className="sl-row__main">
                  <div className="sl-row__top">
                    <span className="sl-row__no">#{shortReceipt(s.receipt_number)}</span>
                    <i className={`fa-solid ${m.icon} sl-m sl-m--${s.payment_method}`} aria-label={m.label} />
                    {s.customer_name && <span className="sl-row__cust">{s.customer_name}</span>}
                  </div>
                  <div className="sl-row__meta">
                    {names.length ? `${names.slice(0, 3).join(', ')}${names.length > 3 ? ` +${names.length - 3}` : ''}` : s.is_cancelled ? '—' : 'Hammasi qaytarilgan'}
                  </div>
                </div>
                <div className="sl-row__r">
                  <div className="sl-row__sum">{money(s.total_amount, false)}</div>
                  {s.is_cancelled ? <Badge tone="red">Bekor</Badge> : s.returns_count > 0 ? <Badge tone="amber">Qaytarish</Badge> : null}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
      {!receiptQ && (sales.data?.length ?? 0) >= limit && limit < 500 && (
        <div className="inv-more"><Button variant="ghost" loading={sales.loading} onClick={() => setLimit((l) => Math.min(500, l + STEP))}>Yana yuklash</Button></div>
      )}
    </>
  );

  return (
    <Page title="Sotuv tarixi"
          toolbar={<>
            <div className="sl-toprow">
              <Tabs label="Ko'rinish" value={view} onChange={setView}
                    items={[{ value: 'sales', label: 'Cheklar' }, { value: 'returns', label: 'Qaytarishlar', count: S?.returns_count }]} />
              <div className="sl-period">
                <Tabs label="Davr" value={period} onChange={(p) => { setPeriod(p); setOpenId(null); }}
                      items={[{ value: 'today', label: 'Bugun' }, { value: 'yesterday', label: 'Kecha' }, { value: 'week', label: '7 kun' }, { value: 'month', label: 'Oy' }, { value: 'custom', label: 'Sana' }]} />
              </div>
            </div>
            {period === 'custom' && (
              <div className="sh-dates">
                <Field type="date" label="Dan" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
                <Field type="date" label="Gacha" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
              </div>
            )}
            <Field icon="fa-magnifying-glass" type="search" aria-label="Qidirish" value={q} onChange={(e) => setQ(e.target.value)}
                   placeholder={view === 'sales' ? 'Chek raqami, mijoz, tovar' : 'Tovar, chek, sabab'} />
          </>}>
      {view === 'sales' && (
        <div className="sl-stats">
          <div className="sl-stat sl-stat--main"><span>Jami savdo</span><b>{S ? money(S.total) : '…'}</b><small>{S ? `${S.count} ta chek` : ''}</small></div>
          {(['naqd', 'plastik', 'nasiya'] as Method[]).map((k) => (
            <div key={k} className={`sl-stat sl-stat--${k}`}><span><i className={`fa-solid ${METHOD[k].icon}`} aria-hidden="true" /> {METHOD[k].label}</span><b>{S ? money(S.by_method[k] ?? 0, false) : '…'}</b></div>
          ))}
          <div className="sl-stat sl-stat--ret"><span><i className="fa-solid fa-rotate-left" aria-hidden="true" /> Qaytarilgan</span><b>{S ? money(S.returns_amount, false) : '…'}</b></div>
        </div>
      )}
      {view === 'sales' && !receiptQ && (
        <div className="inv-chips sl-chips" role="tablist" aria-label="To'lov turi">
          {methodChips.map((c) => (
            <button key={c.key} type="button" role="tab" aria-selected={method === c.key}
                    className={`inv-chip${c.key === 'cancelled' ? ' inv-chip--danger' : ''}`} onClick={() => { setMethod(c.key); setOpenId(null); }}>
              {c.label}{c.n !== undefined && <span className="inv-chip__n">{c.n}</span>}
            </button>
          ))}
        </div>
      )}

      <div className="sl-layout">
        <section aria-label={view === 'sales' ? 'Cheklar' : 'Qaytarishlar'}>{listBody}</section>
        {wide && (
          <aside className="sl-pane" aria-label="Chek tafsiloti">
            {opened ? <SaleDetail sale={opened} onChanged={changed} />
              : <EmptyState icon="fa-hand-pointer" title="Chekni tanlang" text="Tafsilot, qaytarish va qayta chop etish shu yerda" />}
          </aside>
        )}
      </div>

      {!wide && (
        <Modal open={!!opened} onClose={() => setOpenId(null)} title={opened ? `Chek #${shortReceipt(opened.receipt_number)}` : ''} wide>
          {opened && <SaleDetail sale={opened} onChanged={changed} />}
        </Modal>
      )}
    </Page>
  );
}
