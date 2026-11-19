import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { isAdmin } from '@/lib/auth';
import { dateTime, money, PAYMENT_LABEL, qty } from '@/lib/format';
import { Badge, Button, EmptyState, Field, Modal, Skeleton, Stat, Tabs, useConfirm, useToast } from '@/components/ui';
import { hasDebt, type Customer, type HistoryRow } from './types';

interface Props {
  customer: Customer | null;
  onClose: () => void;
  onChanged: () => void;
  onEdit: (c: Customer) => void;
}

type Method = 'naqd' | 'plastik';

export function CustomerDetailModal({ customer, onClose, onChanged, onEdit }: Props) {
  const toast = useToast();
  const confirm = useConfirm();
  const [hist, setHist] = useState<HistoryRow[] | null>(null);
  const [histErr, setHistErr] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<Method>('naqd');
  const [paying, setPaying] = useState(false);
  const [amountErr, setAmountErr] = useState<string | null>(null);

  const loadHistory = async (id: number) => {
    setHist(null); setHistErr(null);
    try { setHist(await api<HistoryRow[]>(`/api/customers/${id}/history`)); }
    catch (e) { setHistErr((e as Error).message); }
  };

  useEffect(() => {
    if (!customer) return;
    setAmount(''); setMethod('naqd'); setAmountErr(null);
    loadHistory(customer.id);
  }, [customer?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!customer) return null;
  const debt = customer.current_debt ?? 0;

  const pay = async () => {
    const v = Math.round(Number(amount.replace(/\s/g, '')));
    if (!v || v <= 0) { setAmountErr("To'lov summasini kiriting"); return; }
    if (v > debt + 0.01) { setAmountErr(`Qarzdan ko'p: qarz ${money(debt)}`); return; }
    setAmountErr(null); setPaying(true);
    try {
      await api('/api/customers/payment', 'POST', { customer_id: customer.id, amount: v, payment_method: method });
      toast.show(`${money(v)} qabul qilindi`, 'success');
      setAmount('');
      onChanged();
      loadHistory(customer.id);
    } catch (e) {
      toast.show((e as Error).message, 'error');
    } finally { setPaying(false); }
  };

  const remove = async () => {
    const ok = await confirm({
      title: "Mijozni o'chirish", danger: true, confirmText: "O'chirish",
      message: `${customer.full_name} ro'yxatdan o'chiriladi. Xaridlar tarixi saqlanib qoladi.`,
    });
    if (!ok) return;
    try {
      await api(`/api/customers/${customer.id}`, 'DELETE');
      toast.show("Mijoz o'chirildi", 'success');
      onChanged(); onClose();
    } catch (e) { toast.show((e as Error).message, 'error'); }
  };

  return (
    <Modal open onClose={onClose} title={customer.full_name} wide>
      <div className="cust-meta">
        {customer.phone && <a href={`tel:${customer.phone}`} className="cust-meta__phone"><i className="fa-solid fa-phone" aria-hidden="true" /> {customer.phone}</a>}
        {customer.address && <span>{customer.address}</span>}
      </div>

      <div className="cust-stats">
        <Stat label="Joriy qarz" value={money(debt)} tone={debt > 0.01 ? 'danger' : 'success'} />
        <Stat label="Jami to'lagan" value={money(customer.total_debt_paid)} />
      </div>

      {hasDebt(customer) && (
        <section className="cust-pay" aria-label="Qarz to'lovi">
          <Field label="To'lov summasi" money inputMode="numeric" placeholder={money(debt, false)}
                 value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d\s]/g, ''))}
                 onKeyDown={(e) => { if (e.key === 'Enter') pay(); }} error={amountErr} />
          <div className="cust-pay__row">
            <Tabs label="To'lov turi" value={method} onChange={setMethod}
                  items={[{ value: 'naqd', label: 'Naqd' }, { value: 'plastik', label: 'Karta' }]} />
            <Button variant="ghost" size="sm" onClick={() => setAmount(String(Math.round(debt)))}>Hammasini</Button>
          </div>
          <Button variant="success" block size="lg" icon="fa-hand-holding-dollar" loading={paying} onClick={pay}>
            To'lovni qabul qilish
          </Button>
        </section>
      )}

      <div className="cust-actions">
        <Button variant="ghost" icon="fa-pen" onClick={() => onEdit(customer)}>Tahrirlash</Button>
        {isAdmin() && <Button variant="danger-soft" icon="fa-trash" onClick={remove}>O'chirish</Button>}
      </div>

      <h3 className="cust-h">Xaridlar va to'lovlar</h3>
      {histErr ? <EmptyState icon="fa-triangle-exclamation" title="Tarix yuklanmadi" text={histErr}
                             action={<Button variant="ghost" size="sm" onClick={() => loadHistory(customer.id)}>Qayta urinish</Button>} />
        : !hist ? <><Skeleton height={56} /><Skeleton height={56} /></>
        : !hist.length ? <EmptyState icon="fa-receipt" title="Hali xarid yo'q" />
        : (
          <ul className="cust-hist">
            {hist.map((r, i) => r.type === 'payment' ? (
              <li key={i} className="cust-hist__row">
                <div>
                  <b className="tone-success">To'lov</b>
                  <small>{dateTime(r.date)} · {PAYMENT_LABEL[r.method] ?? r.method}{r.note ? ` · ${r.note}` : ''}</small>
                </div>
                <b className="tone-success">+{money(r.amount)}</b>
              </li>
            ) : (
              <li key={i} className="cust-hist__row">
                <div className="cust-hist__main">
                  <b>Chek {r.receipt}</b>
                  <small>{dateTime(r.date)} · {r.items.map((it) => `${it.name} × ${qty(it.qty)}`).join(', ')}</small>
                </div>
                <div className="cust-hist__sum">
                  <b>{money(r.amount)}</b>
                  {r.debt > 0.01 && <Badge tone="red">qarz {money(r.debt)}</Badge>}
                </div>
              </li>
            ))}
          </ul>
        )}
    </Modal>
  );
}
