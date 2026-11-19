import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { dateTime, money } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import { EmptyState, Field, Skeleton } from '@/components/ui';
import { CustomerDetailModal } from '@/pages/customers/CustomerDetailModal';
import { hasDebt, type Customer } from '@/pages/customers/types';

export function Debtors() {
  const nav = useNavigate();
  const list = useAsync(() => api<Customer[]>('/api/reports/debtors'));
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const rows = useMemo(() => (list.data ?? []).filter(hasDebt)
    .filter((c) => !q.trim() || c.full_name.toLowerCase().includes(q.trim().toLowerCase()) || (c.phone ?? '').includes(q.trim()))
    .sort((a, b) => b.current_debt - a.current_debt), [list.data, q]);
  const total = (list.data ?? []).filter(hasDebt).reduce((s, c) => s + c.current_debt, 0);
  const opened = (list.data ?? []).find((c) => c.id === openId) ?? null;

  return (
    <div className="rp-section">
      <div className="rp-sumbar">
        <div><span>Mijozlar qarzi (jami)</span><b className="tone-warn">{money(total)}</b></div>
        <span className="rp-muted">{rows.length} ta qarzdor</span>
      </div>
      <Field icon="fa-magnifying-glass" type="search" placeholder="Ism yoki telefon" aria-label="Qarzdor qidirish" value={q} onChange={(e) => setQ(e.target.value)} />
      {list.loading && !list.data ? <Skeleton height={140} radius={14} /> : !rows.length ? (
        <EmptyState icon="fa-face-smile" title={q ? 'Topilmadi' : "Qarzdor yo'q"} text={q ? undefined : 'Hamma mijoz qarzini to\'lagan'} />
      ) : (
        <ul className="rp-list">
          {rows.map((c) => (
            <li key={c.id}>
              <button type="button" className="rp-row rp-row--btn" onClick={() => setOpenId(c.id)}>
                <span className="rp-row__ava">{c.full_name.trim().charAt(0).toUpperCase()}</span>
                <div className="rp-row__main"><b>{c.full_name}</b><small>{c.phone || "Telefon yo'q"}{c.last_purchase_date && ` · oxirgi xarid ${dateTime(c.last_purchase_date).slice(0, 10)}`}</small></div>
                <b className="tone-warn rp-row__sum">{money(c.current_debt, false)}</b>
              </button>
            </li>
          ))}
        </ul>
      )}
      <CustomerDetailModal customer={opened} onClose={() => setOpenId(null)} onChanged={list.reload}
                           onEdit={() => nav('/customers')} />
    </div>
  );
}
