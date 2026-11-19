import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { dateTime, money, parseNum } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import { Button, EmptyState, Field, IconButton, Modal, Skeleton, useConfirm, useToast } from '@/components/ui';
import { NumField } from '@/pages/products/fields';
import { EXPENSE_CATS, expenseIcon, type Expense } from './types';

export function Expenses({ qs, label }: { qs: string; label: string }) {
  const toast = useToast();
  const confirm = useConfirm();
  const list = useAsync(() => api<Expense[]>(`/api/reports/expenses-list?${qs}`), [qs]);
  const [open, setOpen] = useState(false);
  const rows = list.data ?? [];
  const total = rows.reduce((s, e) => s + e.amount, 0);
  const byCat = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach((e) => m.set(e.category, (m.get(e.category) ?? 0) + e.amount));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const remove = async (e: Expense) => {
    const ok = await confirm({ title: "Chiqimni o'chirish", message: `${e.category} — ${money(e.amount)} o'chirilsinmi?`, confirmText: "O'chirish", danger: true });
    if (!ok) return;
    try { await api(`/api/reports/expenses/${e.id}`, 'DELETE'); toast.show("Chiqim o'chirildi", 'success'); list.reload(); }
    catch (err) { toast.show(err instanceof ApiError ? err.message : "O'chirilmadi", 'error'); }
  };

  return (
    <div className="rp-section">
      <div className="rp-sumbar">
        <div><span>Chiqimlar · {label}</span><b className="tone-danger">{money(total)}</b></div>
        <Button icon="fa-plus" onClick={() => setOpen(true)}>Chiqim qo'shish</Button>
      </div>
      {byCat.length > 1 && (
        <div className="rp-catsum">
          {byCat.map(([c, v]) => (
            <span key={c}><i className={`fa-solid ${expenseIcon(c)}`} aria-hidden="true" /> {c} <b>{money(v, false)}</b></span>
          ))}
        </div>
      )}
      {list.loading && !list.data ? <Skeleton height={140} radius={14} /> : !rows.length ? (
        <EmptyState icon="fa-receipt" title="Chiqim yo'q" text="Ijara, ish haqi, kommunal to'lovlarni yozib boring — sof foyda to'g'ri chiqadi"
                    action={<Button icon="fa-plus" onClick={() => setOpen(true)}>Chiqim qo'shish</Button>} />
      ) : (
        <ul className="rp-list">
          {rows.map((e) => (
            <li key={e.id} className="rp-row">
              <span className="rp-row__ico"><i className={`fa-solid ${expenseIcon(e.category)}`} aria-hidden="true" /></span>
              <div className="rp-row__main"><b>{e.category}</b><small>{dateTime(e.created_at)}{e.notes && ` · ${e.notes}`}</small></div>
              <b className="tone-danger rp-row__sum">−{money(e.amount, false)}</b>
              <IconButton icon="fa-trash-can" label={`${e.category} chiqimini o'chirish`} className="inv-danger-icon" onClick={() => remove(e)} />
            </li>
          ))}
        </ul>
      )}
      <ExpenseModal open={open} onClose={() => setOpen(false)} onSaved={list.reload} />
    </div>
  );
}

function ExpenseModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [cat, setCat] = useState('Boshqa');
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setAmount(''); setCat('Boshqa'); setNotes(''); setErr(null); } }, [open]);

  const save = async () => {
    const a = parseNum(amount);
    if (!(a > 0)) { setErr('Summani yozing'); return; }
    setBusy(true);
    try {
      await api('/api/reports/expenses', 'POST', { amount: a, category: cat, notes: notes.trim() || null });
      toast.show(`Chiqim saqlandi: ${money(a)}`, 'success');
      onSaved(); onClose();
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Saqlanmadi'); }
    finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Chiqim qo'shish"
           footer={<><Button variant="ghost" onClick={onClose}>Bekor</Button><Button icon="fa-check" loading={busy} onClick={save}>Saqlash</Button></>}>
      <form className="pf-form" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <button type="submit" className="sr-only" tabIndex={-1} aria-hidden="true" />
        <NumField label="Summa" isMoney required autoFocus value={amount} onValue={(v) => { setAmount(v); setErr(null); }} error={err} className="pf-big" placeholder="0" />
        <div className="ui-field">
          <span className="ui-field__label">Turi</span>
          <div className="sl-reasons">
            {EXPENSE_CATS.map((c) => (
              <button key={c.value} type="button" className="sl-reason" aria-pressed={cat === c.value} onClick={() => setCat(c.value)}>
                <i className={`fa-solid ${c.icon}`} aria-hidden="true" /> {c.value}
              </button>
            ))}
          </div>
        </div>
        <Field label="Izoh" placeholder="Ixtiyoriy" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={200} />
      </form>
    </Modal>
  );
}
