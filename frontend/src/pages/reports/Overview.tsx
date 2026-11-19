import { useState } from 'react';
import { api } from '@/lib/api';
import { money, qty as fmtQty } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import { Button, EmptyState, Skeleton, Tabs } from '@/components/ui';
import type { Dashboard, TopProduct } from './types';

type Sort = 'quantity' | 'total_amount' | 'total_profit';

function Kpi({ label, value, sub, tone, icon }: { label: string; value: string; sub?: string; tone?: 'good' | 'bad' | 'main'; icon: string }) {
  return (
    <div className={`rp-kpi${tone ? ` rp-kpi--${tone}` : ''}`}>
      <div className="rp-kpi__label"><i className={`fa-solid ${icon}`} aria-hidden="true" /> {label}</div>
      <div className="rp-kpi__value">{value}</div>
      {sub && <div className="rp-kpi__sub">{sub}</div>}
    </div>
  );
}

export function Overview({ qs, onGo }: { qs: string; onGo: (tab: 'debtors' | 'suppliers' | 'expenses') => void }) {
  const dash = useAsync(() => api<Dashboard>(`/api/reports/dashboard?${qs}`), [qs]);
  const top = useAsync(() => api<TopProduct[]>(`/api/reports/top-products?${qs}&limit=50`), [qs]);
  const [sort, setSort] = useState<Sort>('total_amount');
  const [showAll, setShowAll] = useState(false);
  const d = dash.data;

  if (dash.error && !d) {
    return <EmptyState icon={dash.error.offline ? 'fa-wifi' : 'fa-triangle-exclamation'} title={dash.error.offline ? "Internet yo'q" : 'Hisobot yuklanmadi'}
                       text={dash.error.message} action={<Button variant="ghost" onClick={dash.reload}>Qayta urinish</Button>} />;
  }
  if (!d) return <div className="rp-kpis">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} height={104} radius={18} />)}</div>;

  const margin = d.total_sales > 0 ? Math.round((d.total_profit / d.total_sales) * 1000) / 10 : 0;
  const sorted = [...(top.data ?? [])].sort((a, b) => b[sort] - a[sort]);
  const shown = showAll ? sorted : sorted.slice(0, 10);
  const max = Math.max(1, ...shown.map((p) => Math.abs(p[sort])));

  return (
    <div className="rp-overview">
      <section aria-label="Asosiy ko'rsatkichlar" className="rp-kpis rp-kpis--main">
        <Kpi tone="main" icon="fa-sack-dollar" label="Savdo" value={money(d.total_sales)} sub={`${d.sales_count} ta chek${d.returns > 0 ? ` · qaytarilgan ${money(d.returns)}` : ''}`} />
        <Kpi icon="fa-chart-line" label="Yalpi foyda" value={money(d.total_profit)} sub={d.total_sales > 0 ? `Savdodan ${margin}%` : 'Sotuvdan tushgan foyda'} tone={d.total_profit < 0 ? 'bad' : undefined} />
        <Kpi icon="fa-scale-balanced" label="Sof foyda" value={money(d.net_profit)} sub={`Foyda − chiqimlar (${money(d.expenses)})`} tone={d.net_profit < 0 ? 'bad' : 'good'} />
      </section>

      <section className="rp-card" aria-label="Pul qayerdan keldi">
        <div className="rp-card__head"><h2>Kassaga tushgan pul</h2></div>
        <div className="rp-money">
          <div className="rp-money__row"><span><i className="fa-solid fa-money-bill-wave tone-success" aria-hidden="true" /> Naqd</span><b>{money(d.cash)}</b></div>
          <div className="rp-money__row"><span><i className="fa-solid fa-credit-card tone-primary" aria-hidden="true" /> Plastik</span><b>{money(d.card)}</b></div>
          <div className="rp-money__row"><span><i className="fa-solid fa-hand-holding-dollar tone-warn" aria-hidden="true" /> Nasiyaga berildi</span><b>{money(d.debt)}</b></div>
          <div className="rp-money__row"><span><i className="fa-solid fa-receipt tone-danger" aria-hidden="true" /> Chiqimlar</span><b className="tone-danger">−{money(d.expenses)}</b></div>
        </div>
        <p className="rp-hint">Naqd: naqd sotuvlar, nasiyada oldindan berilgan pul va mijozlarning naqd qarz to'lovlari.</p>
      </section>

      <section className="rp-card" aria-label="Hozirgi holat">
        <div className="rp-card__head"><h2>Hozirgi holat</h2><span className="rp-muted">davrga bog'liq emas</span></div>
        <div className="rp-state">
          <div><span>Ombordagi tovar (tannarxda)</span><b>{money(d.inventory_cost)}</b><small>Sotilsa foyda: +{money(d.potential_profit)}</small></div>
          <button type="button" onClick={() => onGo('debtors')}><span>Mijozlar bizga qarz</span><b className="tone-warn">{money(d.customer_debt)}</b><small>Qarzdorlar →</small></button>
          <button type="button" onClick={() => onGo('suppliers')}><span>Biz ta'minotchilarga qarz</span><b className="tone-danger">{money(d.supplier_debt)}</b><small>Ta'minotchilar →</small></button>
        </div>
      </section>

      <section className="rp-card rp-top" aria-label="Eng ko'p sotilgan tovarlar">
        <div className="rp-card__head">
          <h2>Eng ko'p sotilganlar</h2>
          <Tabs label="Saralash" value={sort} onChange={setSort}
                items={[{ value: 'total_amount', label: 'Summa' }, { value: 'quantity', label: 'Soni' }, { value: 'total_profit', label: 'Foyda' }]} />
        </div>
        {top.loading && !top.data ? <Skeleton height={160} radius={12} /> : !sorted.length ? (
          <p className="rp-empty">Bu davrda sotuv yo'q</p>
        ) : (
          <>
            <ol className="rp-toplist">
              {shown.map((p, i) => (
                <li key={p.name + i}>
                  <span className="rp-rank">{i + 1}</span>
                  <div className="rp-toplist__main">
                    <div className="rp-toplist__row"><b>{p.name}</b><span>{sort === 'quantity' ? `${fmtQty(p.quantity)} ta` : money(p[sort], false)}</span></div>
                    <div className="rp-bar"><i style={{ width: `${Math.max(3, (Math.abs(p[sort]) / max) * 100)}%` }} className={p[sort] < 0 ? 'is-neg' : ''} /></div>
                    <div className="rp-toplist__meta">{fmtQty(p.quantity)} ta · {money(p.total_amount, false)} so'm · foyda {money(p.total_profit, false)}</div>
                  </div>
                </li>
              ))}
            </ol>
            {sorted.length > 10 && <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>{showAll ? 'Kamroq' : `Hammasi (${sorted.length})`}</Button>}
          </>
        )}
      </section>
      <button type="button" className="rp-link" onClick={() => onGo('expenses')}><i className="fa-solid fa-receipt" aria-hidden="true" /> Chiqimlar ro'yxati va qo'shish →</button>
    </div>
  );
}
