import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { money } from '@/lib/format';
import { Button, Field, Modal, Tabs, useToast } from '@/components/ui';
import { applyKey, Numpad } from './Numpad';

export type PayMethod = 'naqd' | 'plastik' | 'nasiya';
interface Cust { id: number; full_name: string; phone: string | null; current_debt: number; is_active?: boolean }

export interface CheckoutResult { method: PayMethod; paid: number; customer: { id: number; name: string } | null }

interface Props {
  open: boolean;
  total: number;
  busy: boolean;
  onClose: () => void;
  onSubmit: (r: CheckoutResult) => void;
}

/** Yaxlit tez summalar: 38 500 → 40 000, 50 000, 100 000 */
function quickAmounts(total: number): number[] {
  const out = new Set<number>();
  for (const step of [1000, 5000, 10000, 50000, 100000]) {
    const v = Math.ceil(total / step) * step;
    if (v > total) out.add(v);
  }
  return [...out].sort((a, b) => a - b).slice(0, 3);
}

export function CheckoutModal({ open, total, busy, onClose, onSubmit }: Props) {
  const toast = useToast();
  const [method, setMethod] = useState<PayMethod>('naqd');
  const [paid, setPaid] = useState('');
  const [customers, setCustomers] = useState<Cust[] | null>(null);
  const [q, setQ] = useState('');
  const [customer, setCustomer] = useState<{ id: number; name: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const paidRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setMethod('naqd'); setPaid(String(Math.round(total))); setCustomer(null); setQ(''); setAdding(false); setError(null);
    setTimeout(() => paidRef.current?.select(), 50);
  }, [open, total]);

  // Nasiya tanlanganda mijozlar ro'yxati (oflayn bo'lsa — keshdan)
  useEffect(() => {
    if (!open || method !== 'nasiya' || customers) return;
    api<Cust[]>('/api/customers/').then((l) => setCustomers(l.filter((c) => c.is_active !== false))).catch(() => setCustomers([]));
  }, [open, method, customers]);

  const found = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t || !customers) return [];
    return customers.filter((c) => c.full_name.toLowerCase().includes(t) || (c.phone ?? '').includes(t)).slice(0, 6);
  }, [q, customers]);

  const paidNum = Math.round(parseFloat(paid) || 0);
  const change = method === 'naqd' ? paidNum - Math.round(total) : 0;

  const chooseMethod = (m: PayMethod) => {
    setMethod(m); setError(null);
    setPaid(m === 'nasiya' ? '0' : String(Math.round(total)));
  };

  const submit = () => {
    if (busy) return;
    if (method === 'nasiya' && !customer) { setError('Qarzga yozish uchun mijozni tanlang'); return; }
    if (method === 'naqd' && paidNum < Math.round(total)) { setError(`Yetmaydi: yana ${money(Math.round(total) - paidNum)} kerak`); return; }
    if (method === 'nasiya' && paidNum > total) { setError("Oldindan to'lov jamidan ko'p bo'lmasin"); return; }
    setError(null);
    onSubmit({ method, paid: method === 'plastik' ? Math.round(total) : paidNum, customer });
  };

  const addCustomer = async () => {
    if (!newName.trim()) { toast.show('Mijoz ismini kiriting', 'error'); return; }
    try {
      const c = await api<Cust>('/api/customers/', 'POST', { full_name: newName.trim(), phone: newPhone.trim() || null });
      setCustomers((l) => [c, ...(l ?? [])]);
      setCustomer({ id: c.id, name: c.full_name });
      setAdding(false); setNewName(''); setNewPhone(''); setError(null);
      toast.show("Mijoz qo'shildi", 'success');
    } catch (e) { toast.show((e as Error).message, 'error'); }
  };

  return (
    <Modal open={open} onClose={onClose} title="To'lov" wide persistent={busy}
      footer={<>
        <Button variant="ghost" onClick={onClose} disabled={busy}>Orqaga</Button>
        <Button variant="success" size="lg" icon="fa-check" loading={busy} onClick={submit}>
          {method === 'nasiya' ? 'Qarzga yozish' : 'Sotuvni yakunlash'}
        </Button>
      </>}>
      <div className="co-total">
        <span>Jami</span>
        <b>{money(total)}</b>
      </div>

      <Tabs label="To'lov turi" value={method} onChange={chooseMethod}
            items={[{ value: 'naqd', label: 'Naqd' }, { value: 'plastik', label: 'Plastik karta' }, { value: 'nasiya', label: 'Nasiya' }]} />

      {method === 'nasiya' && (
        <section className="co-cust" aria-label="Mijoz">
          {customer ? (
            <div className="co-cust__chosen">
              <i className="fa-solid fa-user" aria-hidden="true" />
              <b>{customer.name}</b>
              <Button variant="ghost" size="sm" onClick={() => { setCustomer(null); setQ(''); }}>O'zgartirish</Button>
            </div>
          ) : adding ? (
            <div className="co-cust__new">
              <Field label="Yangi mijoz ismi" required value={newName} onChange={(e) => setNewName(e.target.value)}
                     onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); addCustomer(); } }} />
              <Field label="Telefon" type="tel" inputMode="tel" value={newPhone} onChange={(e) => setNewPhone(e.target.value)}
                     onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); addCustomer(); } }} />
              <div className="co-cust__row">
                <Button variant="ghost" onClick={() => setAdding(false)}>Bekor qilish</Button>
                <Button onClick={addCustomer} icon="fa-user-plus">Mijozni qo'shish</Button>
              </div>
            </div>
          ) : (
            <>
              <div className="co-cust__row">
                <Field icon="fa-magnifying-glass" placeholder="Mijoz ismi yoki telefoni" aria-label="Mijoz qidirish"
                       value={q} onChange={(e) => setQ(e.target.value)} autoFocus
                       onKeyDown={(e) => { if (e.key === 'Enter' && found[0]) { e.preventDefault(); e.stopPropagation(); setCustomer({ id: found[0].id, name: found[0].full_name }); } }} />
                <Button variant="outline" icon="fa-user-plus" onClick={() => { setAdding(true); setNewName(q); }}>Yangi</Button>
              </div>
              {found.length > 0 && (
                <ul className="co-cust__list">
                  {found.map((c) => (
                    <li key={c.id}>
                      <button type="button" onClick={() => setCustomer({ id: c.id, name: c.full_name })}>
                        <b>{c.full_name}</b>
                        <small>{c.phone || '—'}</small>
                        {c.current_debt > 0 && <span className="ui-badge ui-badge--red">qarz {money(c.current_debt, false)}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {q && customers && !found.length && <p className="co-hint">Topilmadi — "Yangi" tugmasi bilan qo'shing</p>}
            </>
          )}
        </section>
      )}

      {method !== 'plastik' && (
        <div className="co-pay">
          <div className="co-pay__input">
            <Field ref={paidRef} label={method === 'nasiya' ? "Oldindan to'lagan (ixtiyoriy)" : 'Mijoz bergan pul'} money inputMode="numeric"
                   value={paid} onChange={(e) => setPaid(e.target.value.replace(/\D/g, ''))}
                   onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }} />
            {method === 'naqd' && (
              <div className="co-quick">
                <button type="button" onClick={() => setPaid(String(Math.round(total)))}>Aniq</button>
                {quickAmounts(total).map((a) => <button key={a} type="button" onClick={() => setPaid(String(a))}>{money(a, false)}</button>)}
              </div>
            )}
            {method === 'naqd' && (
              <div className={`co-change${change < 0 ? ' is-short' : ''}`} aria-live="polite">
                <span>{change < 0 ? 'Yetmaydi' : 'Qaytim'}</span>
                <b>{money(Math.abs(change))}</b>
              </div>
            )}
          </div>
          <div className="co-pay__pad">
            <Numpad decimal={false} onKey={(k) => setPaid((b) => applyKey(b, k, 0))} />
          </div>
        </div>
      )}

      {error && <p className="co-error" role="alert">{error}</p>}
    </Modal>
  );
}
