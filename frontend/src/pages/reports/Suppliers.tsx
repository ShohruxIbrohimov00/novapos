import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { dateTime, money, parseNum, qty as fmtQty } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import { Badge, Button, EmptyState, Field, Modal, Skeleton, Stat, Tabs, useConfirm, useToast } from '@/components/ui';
import { NumField } from '@/pages/products/fields';
import type { Supplier, SupplierHistoryRow } from './types';

export function Suppliers() {
  const list = useAsync(() => api<Supplier[]>('/api/suppliers/'));
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const [form, setForm] = useState<Supplier | 'new' | null>(null);
  const rows = useMemo(() => (list.data ?? [])
    .filter((s) => !q.trim() || s.name.toLowerCase().includes(q.trim().toLowerCase()) || (s.phone ?? '').includes(q.trim()))
    .sort((a, b) => b.current_debt - a.current_debt || a.name.localeCompare(b.name)), [list.data, q]);
  const total = (list.data ?? []).reduce((s, x) => s + x.current_debt, 0);
  const opened = (list.data ?? []).find((s) => s.id === openId) ?? null;

  return (
    <div className="rp-section">
      <div className="rp-sumbar">
        <div><span>Ta'minotchilarga qarzimiz</span><b className="tone-danger">{money(total)}</b></div>
        <Button icon="fa-plus" onClick={() => setForm('new')}>Ta'minotchi</Button>
      </div>
      <Field icon="fa-magnifying-glass" type="search" placeholder="Nomi yoki telefon" aria-label="Ta'minotchi qidirish" value={q} onChange={(e) => setQ(e.target.value)} />
      {list.loading && !list.data ? <Skeleton height={140} radius={14} /> : !rows.length ? (
        <EmptyState icon="fa-truck" title={q ? 'Topilmadi' : "Ta'minotchi yo'q"}
                    text={q ? undefined : "Tovar olib keladigan firmalarni qo'shing — qarzga olingan tovar shu yerda hisoblanadi"}
                    action={q ? undefined : <Button icon="fa-plus" onClick={() => setForm('new')}>Ta'minotchi qo'shish</Button>} />
      ) : (
        <ul className="rp-list">
          {rows.map((s) => (
            <li key={s.id}>
              <button type="button" className="rp-row rp-row--btn" onClick={() => setOpenId(s.id)}>
                <span className="rp-row__ava rp-row__ava--sup"><i className="fa-solid fa-truck" aria-hidden="true" /></span>
                <div className="rp-row__main"><b>{s.name}</b><small>{s.phone || "Telefon yo'q"} · jami {money(s.total_supplied, false)}</small></div>
                <b className={`rp-row__sum ${s.current_debt > 0.01 ? 'tone-danger' : 'rp-muted'}`}>{s.current_debt > 0.01 ? money(s.current_debt, false) : "Qarz yo'q"}</b>
              </button>
            </li>
          ))}
        </ul>
      )}
      <SupplierModal supplier={form ? null : opened} onClose={() => setOpenId(null)} onChanged={list.reload} onEdit={(s) => setForm(s)} />
      <SupplierForm value={form} onClose={() => setForm(null)} onSaved={(s) => { list.reload(); if (s) setOpenId(s.id); }} />
    </div>
  );
}

function SupplierForm({ value, onClose, onSaved }: { value: Supplier | 'new' | null; onClose: () => void; onSaved: (s?: Supplier) => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const editing = value && value !== 'new' ? value : null;
  useEffect(() => { if (value) { setName(editing?.name ?? ''); setPhone(editing?.phone ?? ''); setErr(null); } }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!name.trim()) { setErr('Nomini yozing'); return; }
    setBusy(true);
    try {
      const body = { name: name.trim(), phone: phone.trim() || null };
      const s = editing ? await api<Supplier>(`/api/suppliers/${editing.id}`, 'PATCH', body) : await api<Supplier>('/api/suppliers/', 'POST', body);
      toast.show(editing ? 'Saqlandi' : `"${s.name}" qo'shildi`, 'success');
      onClose(); onSaved(s);
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Saqlanmadi'); }
    finally { setBusy(false); }
  };

  return (
    <Modal open={!!value} onClose={onClose} title={editing ? "Ta'minotchini tahrirlash" : "Yangi ta'minotchi"}
           footer={<><Button variant="ghost" onClick={onClose}>Bekor</Button><Button icon="fa-check" loading={busy} onClick={save}>Saqlash</Button></>}>
      <form className="pf-form" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <button type="submit" className="sr-only" tabIndex={-1} aria-hidden="true" />
        <Field label="Nomi" required autoFocus placeholder="Masalan: Coca-Cola Uzbekistan" value={name} error={err} onChange={(e) => { setName(e.target.value); setErr(null); }} maxLength={100} />
        <Field label="Telefon" type="tel" inputMode="tel" placeholder="+998 90 123 45 67" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} />
      </form>
    </Modal>
  );
}

type Act = 'pay' | 'debt';

function SupplierModal({ supplier, onClose, onChanged, onEdit }: { supplier: Supplier | null; onClose: () => void; onChanged: () => void; onEdit: (s: Supplier) => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [hist, setHist] = useState<SupplierHistoryRow[] | null>(null);
  const [act, setAct] = useState<Act>('pay');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'naqd' | 'plastik'>('naqd');
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = supplier?.id;

  const load = () => { if (id) api<SupplierHistoryRow[]>(`/api/suppliers/${id}/history`).then(setHist).catch(() => setHist([])); };
  useEffect(() => { setHist(null); setAmount(''); setNote(''); setErr(null); setAct('pay'); load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!supplier) return <Modal open={false} onClose={onClose} title="">{null}</Modal>;
  const debt = supplier.current_debt;

  const submit = async () => {
    const a = parseNum(amount);
    if (!(a > 0)) { setErr('Summani yozing'); return; }
    if (act === 'pay' && a > debt + 0.01) { setErr(`Qarzdan ko'p: qarz ${money(debt)}`); return; }
    setBusy(true);
    try {
      if (act === 'pay') await api('/api/suppliers/payment', 'POST', { supplier_id: supplier.id, amount: a, payment_method: method, comment: note.trim() || null });
      else await api('/api/suppliers/receive-goods', 'POST', { supplier_id: supplier.id, amount: a, notes: note.trim() || null });
      toast.show(act === 'pay' ? `${money(a)} to'landi` : `Qarz ${money(a)}ga oshdi`, 'success');
      setAmount(''); setNote(''); onChanged(); load();
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Saqlanmadi'); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    const ok = await confirm({ title: "Ta'minotchini o'chirish", message: `"${supplier.name}" o'chirilsinmi? Kirim tarixi saqlanib qoladi.`, confirmText: "O'chirish", danger: true });
    if (!ok) return;
    try { await api(`/api/suppliers/${supplier.id}`, 'DELETE'); toast.show("O'chirildi", 'success'); onClose(); onChanged(); }
    catch (e) { toast.show(e instanceof ApiError ? e.message : "O'chirilmadi", 'error'); }
  };

  return (
    <Modal open onClose={onClose} title={supplier.name} wide>
      <div className="rp-sup">
        {supplier.phone && <a className="cust-meta__phone" href={`tel:${supplier.phone}`}><i className="fa-solid fa-phone" aria-hidden="true" /> {supplier.phone}</a>}
        <div className="cust-stats rp-sup__stats">
          <Stat label="Hozirgi qarz" value={money(debt)} tone={debt > 0.01 ? 'danger' : undefined} />
          <Stat label="Jami olingan" value={money(supplier.total_supplied)} />
          <Stat label="Jami to'langan" value={money(supplier.total_paid)} tone="success" />
        </div>

        <form className="cust-pay" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <Tabs label="Amal" value={act} onChange={(v) => { setAct(v); setErr(null); }}
                items={[{ value: 'pay', label: "To'lov qilish" }, { value: 'debt', label: "Qarzni qo'lda yozish" }]} />
          {act === 'debt' && <p className="rp-hint">Tovar omborga kiritilmagan bo'lsa ham qarzni yozib qo'yish uchun. Tovar bilan birga qarz — Ombor → tovar → Kirim → "Qarzga".</p>}
          <NumField label="Summa" isMoney value={amount} onValue={(v) => { setAmount(v); setErr(null); }} error={err} placeholder="0" className="pf-big" />
          {act === 'pay' && debt > 0.01 && (
            <div className="rp-quick"><button type="button" className="sl-reason" onClick={() => setAmount(String(Math.round(debt)))}>Hammasi: {money(debt)}</button></div>
          )}
          {act === 'pay' && (
            <div className="pf-seg" role="radiogroup" aria-label="To'lov usuli">
              <button type="button" role="radio" aria-checked={method === 'naqd'} onClick={() => setMethod('naqd')}>Naqd</button>
              <button type="button" role="radio" aria-checked={method === 'plastik'} onClick={() => setMethod('plastik')} className="rp-seg-plain">Plastik</button>
            </div>
          )}
          <Field placeholder="Izoh (ixtiyoriy)" aria-label="Izoh" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
          <Button type="submit" block loading={busy} variant={act === 'pay' ? 'success' : 'primary'} icon={act === 'pay' ? 'fa-check' : 'fa-plus'}
                  disabled={act === 'pay' && debt <= 0.01}>
            {act === 'pay' ? (debt > 0.01 ? "To'lovni saqlash" : "Qarz yo'q") : 'Qarzni yozish'}
          </Button>
        </form>

        <div className="cust-h">Tarix</div>
        {hist === null ? <Skeleton height={80} radius={12} /> : !hist.length ? <p className="rp-hint">Hali hech narsa yo'q</p> : (
          <ul className="cust-hist">
            {hist.map((h) => (
              <li key={`${h.type}-${h.id}`} className="cust-hist__row">
                <div className="cust-hist__main">
                  <b>{h.type === 'payment' ? "To'lov" : h.product_name || 'Tovar olindi'}</b>
                  <small>{dateTime(h.date)} · {h.type === 'payment' ? (h.method === 'plastik' ? 'Plastik' : 'Naqd') : h.product_name ? `${fmtQty(h.quantity ?? 0)} ${h.unit_type ?? ''} × ${money(h.unit_price ?? 0, false)}` : h.note}
                    {h.type === 'payment' && h.note && h.note !== "To'lov" && ` · ${h.note}`}</small>
                </div>
                <div className="cust-hist__sum">
                  <b className={h.type === 'payment' ? 'tone-success' : ''}>{h.type === 'payment' ? '−' : '+'}{money(h.amount, false)}</b>
                  {h.type === 'supply' && h.is_paid === true && <Badge tone="gray">Darhol to'langan</Badge>}
                  {h.type === 'supply' && h.is_paid !== true && <Badge tone="red">Qarzga</Badge>}
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="cust-actions">
          <Button variant="ghost" icon="fa-pen" onClick={() => onEdit(supplier)}>Tahrirlash</Button>
          <Button variant="danger-soft" icon="fa-trash-can" onClick={remove} disabled={debt > 0.01} title={debt > 0.01 ? "Qarzi bor — avval to'lang" : undefined}>O'chirish</Button>
        </div>
      </div>
    </Modal>
  );
}
