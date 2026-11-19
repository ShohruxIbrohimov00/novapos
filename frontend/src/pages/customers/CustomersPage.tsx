import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { money } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import { Button, Card, EmptyState, Field, Page, Skeleton, Stat, Tabs } from '@/components/ui';
import { CustomerDetailModal } from './CustomerDetailModal';
import { CustomerFormModal } from './CustomerFormModal';
import { hasDebt, type Customer } from './types';
import './customers.css';

type Filter = 'all' | 'debt';

export function CustomersPage() {
  const { data, loading, error, reload } = useAsync(() => api<Customer[]>('/api/customers/'));
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);

  const active = useMemo(() => (data ?? []).filter((c) => c.is_active !== false), [data]);
  const debtors = useMemo(() => active.filter(hasDebt), [active]);
  const totalDebt = useMemo(() => debtors.reduce((s, c) => s + c.current_debt, 0), [debtors]);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (filter === 'debt' ? debtors : active)
      .filter((c) => !term || c.full_name.toLowerCase().includes(term) || (c.phone ?? '').includes(term))
      .sort((a, b) => b.current_debt - a.current_debt || a.full_name.localeCompare(b.full_name));
  }, [active, debtors, filter, q]);

  const opened = active.find((c) => c.id === openId) ?? null;

  const openNew = () => { setEditing(null); setFormOpen(true); };

  return (
    <Page
      title="Mijozlar"
      actions={<Button icon="fa-plus" onClick={openNew}>Mijoz qo'shish</Button>}
      toolbar={<>
        <Field icon="fa-magnifying-glass" placeholder="Ism yoki telefon" value={q} onChange={(e) => setQ(e.target.value)}
               aria-label="Mijoz qidirish" type="search" />
        <div className="cust-toolbar">
          <Tabs label="Filtr" value={filter} onChange={setFilter}
                items={[{ value: 'all', label: 'Hammasi', count: active.length }, { value: 'debt', label: 'Qarzdorlar', count: debtors.length }]} />
          <div className="cust-total">
            <Stat label="Jami qarz" value={money(totalDebt)} tone={totalDebt > 0 ? 'danger' : undefined} />
          </div>
        </div>
      </>}
    >
      {error && !data ? (
        <EmptyState icon={error.offline ? 'fa-wifi' : 'fa-triangle-exclamation'}
                    title={error.offline ? "Internet yo'q" : "Mijozlar yuklanmadi"} text={error.message}
                    action={<Button variant="ghost" onClick={reload}>Qayta urinish</Button>} />
      ) : loading && !data ? (
        <div className="cust-grid">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} height={76} radius={18} />)}</div>
      ) : !shown.length ? (
        q || filter === 'debt'
          ? <EmptyState icon="fa-magnifying-glass" title="Hech narsa topilmadi" text={filter === 'debt' && !q ? "Qarzdor mijoz yo'q" : `"${q}" bo'yicha mijoz yo'q`} />
          : <EmptyState icon="fa-users" title="Hali mijoz yo'q" text="Nasiya savdo uchun mijozlarni shu yerda qo'shasiz"
                        action={<Button icon="fa-plus" onClick={openNew}>Mijoz qo'shish</Button>} />
      ) : (
        <ul className="cust-grid" aria-label="Mijozlar ro'yxati">
          {shown.map((c) => (
            <li key={c.id}>
              <Card interactive className="cust-row" role="button" tabIndex={0}
                    onClick={() => setOpenId(c.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenId(c.id); } }}>
                <div className="cust-row__ava" aria-hidden="true">{c.full_name.trim().charAt(0).toUpperCase() || '?'}</div>
                <div className="cust-row__main">
                  <div className="cust-row__name">{c.full_name}</div>
                  <div className="cust-row__phone">{c.phone || 'Telefon yo\'q'}</div>
                </div>
                <div className={`cust-row__debt${hasDebt(c) ? ' is-debt' : ''}`}>
                  {hasDebt(c) ? money(c.current_debt) : "Qarzi yo'q"}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <CustomerFormModal open={formOpen} customer={editing} onClose={() => setFormOpen(false)} onSaved={() => reload()} />
      <CustomerDetailModal customer={formOpen ? null : opened} onClose={() => setOpenId(null)} onChanged={reload}
                           onEdit={(c) => { setEditing(c); setFormOpen(true); }} />
    </Page>
  );
}
