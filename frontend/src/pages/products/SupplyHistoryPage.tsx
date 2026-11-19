import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { localDate, money, qty as fmtQty } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import { Badge, Button, EmptyState, Field, Page, Skeleton, Stat, Tabs } from '@/components/ui';
import { SUPPLY_TYPE, type SupplyRow } from './data';
import './products.css';

type Period = 'today' | 'week' | 'month' | 'custom';
const pad = (n: number) => String(n).padStart(2, '0');

function range(period: Period, from: string, to: string): [string, string] {
  const t = new Date();
  if (period === 'today') return [localDate(t), localDate(t)];
  if (period === 'week') return [localDate(new Date(t.getFullYear(), t.getMonth(), t.getDate() - 6)), localDate(t)];
  if (period === 'month') return [localDate(new Date(t.getFullYear(), t.getMonth(), 1)), localDate(t)];
  return [from || localDate(t), to || from || localDate(t)];
}

const dayLabel = (iso: string) => {
  const d = new Date(iso);
  const today = localDate(), key = localDate(d);
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (key === today) return 'Bugun';
  if (key === localDate(y)) return 'Kecha';
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
};
const time = (iso: string | null) => { if (!iso) return ''; const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

export function SupplyHistoryPage() {
  const nav = useNavigate();
  const [period, setPeriod] = useState<Period>('today');
  const [from, setFrom] = useState(localDate());
  const [to, setTo] = useState(localDate());
  const [q, setQ] = useState('');
  const [start, end] = range(period, from, to);

  const { data, loading, error, reload } = useAsync(
    () => api<SupplyRow[]>(`/api/products/supply-history?limit=1000&start_date=${start}&end_date=${end}`),
    [start, end],
  );

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data ?? []).filter((r) => !term || r.product_name.toLowerCase().includes(term) || (r.supplier_name ?? '').toLowerCase().includes(term));
  }, [data, q]);

  const total = rows.reduce((s, r) => s + r.total_cost, 0);
  const unpaid = rows.filter((r) => !r.is_paid).reduce((s, r) => s + r.total_cost, 0);

  const groups = useMemo(() => {
    const m = new Map<string, { label: string; items: SupplyRow[]; sum: number }>();
    rows.forEach((r) => {
      const k = r.created_at ? localDate(new Date(r.created_at)) : '—';
      const g = m.get(k) ?? { label: r.created_at ? dayLabel(r.created_at) : '—', items: [], sum: 0 };
      g.items.push(r); g.sum += r.total_cost; m.set(k, g);
    });
    return [...m.values()];
  }, [rows]);

  const top = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach((r) => m.set(r.product_name, (m.get(r.product_name) ?? 0) + r.total_cost));
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [rows]);

  return (
    <Page title="Kirim tarixi" back={() => nav('/products')}
          toolbar={<>
            <Tabs label="Davr" value={period} onChange={setPeriod}
                  items={[{ value: 'today', label: 'Bugun' }, { value: 'week', label: '7 kun' }, { value: 'month', label: 'Shu oy' }, { value: 'custom', label: 'Sana' }]} />
            {period === 'custom' && (
              <div className="sh-dates">
                <Field type="date" label="Dan" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
                <Field type="date" label="Gacha" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
              </div>
            )}
            <Field icon="fa-magnifying-glass" type="search" placeholder="Tovar yoki ta'minotchi" aria-label="Qidirish"
                   value={q} onChange={(e) => setQ(e.target.value)} />
          </>}>
      <div className="sh-stats">
        <Stat label="Jami kirim" value={money(total)} />
        <Stat label="Kirimlar soni" value={`${rows.length} ta`} />
        <Stat label="Qarzga olingan" value={money(unpaid)} tone={unpaid > 0 ? 'danger' : undefined} />
      </div>

      <div className="sh-layout">
        <section aria-label="Kirimlar">
          {error && !data ? (
            <EmptyState icon={error.offline ? 'fa-wifi' : 'fa-triangle-exclamation'} title={error.offline ? "Internet yo'q" : 'Yuklanmadi'}
                        text={error.message} action={<Button variant="ghost" onClick={reload}>Qayta urinish</Button>} />
          ) : loading && !data ? (
            <div className="sh-list">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} height={68} radius={14} />)}</div>
          ) : !rows.length ? (
            <EmptyState icon="fa-truck-ramp-box" title="Bu davrda kirim yo'q" text={q ? `"${q}" bo'yicha topilmadi` : 'Tovar qabul qilinganda shu yerda ko\'rinadi'} />
          ) : (
            groups.map((g) => (
              <div key={g.label} className="sh-group">
                <div className="sh-group__head"><h2>{g.label}</h2><span>{money(g.sum)}</span></div>
                <ul className="sh-list">
                  {g.items.map((r) => {
                    const t = SUPPLY_TYPE[r.supply_type ?? ''] ?? SUPPLY_TYPE.restock;
                    return (
                      <li key={r.id}>
                        <Link to={`/products/${r.product_id}`} className="sh-row">
                          <div className="sh-row__main">
                            <div className="sh-row__name">{r.product_name}</div>
                            <div className="sh-row__meta">
                              <span>{fmtQty(r.quantity_received)} {r.unit_type} × {money(r.supply_price, false)}</span>
                              <span><i className="fa-regular fa-clock" aria-hidden="true" /> {time(r.created_at)}</span>
                              {r.supplier_name && <span><i className="fa-solid fa-truck" aria-hidden="true" /> {r.supplier_name}</span>}
                              {r.employee_name && <span><i className="fa-solid fa-user" aria-hidden="true" /> {r.employee_name}</span>}
                            </div>
                          </div>
                          <div className="sh-row__r">
                            <b>{money(r.total_cost)}</b>
                            <span className="sh-row__badges">
                              <Badge tone={t.tone}>{t.label}</Badge>
                              {!r.is_paid && <Badge tone="red">Qarzga</Badge>}
                            </span>
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </section>

        {top.length > 0 && (
          <aside className="sh-side pf-card" aria-label="Eng ko'p kirim">
            <div className="pf-card__head"><span>Eng ko'p kirim qilingan</span></div>
            <ul className="sh-top">
              {top.map(([name, sum]) => (
                <li key={name}>
                  <div className="sh-top__row"><span>{name}</span><b>{money(sum, false)}</b></div>
                  <div className="sh-top__bar"><i style={{ width: `${Math.max(4, (sum / top[0][1]) * 100)}%` }} /></div>
                </li>
              ))}
            </ul>
          </aside>
        )}
      </div>
    </Page>
  );
}
