import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { cleanNumInput, dateTime } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import { Badge, Button, Field, IconButton, Modal, Skeleton, useConfirm, useToast } from '@/components/ui';
import type { Employee } from './types';

const MAX_CASHIERS = 3;

export function Employees() {
  const toast = useToast();
  const confirm = useConfirm();
  const me = getUser();
  const list = useAsync(() => api<Employee[]>('/api/employees/'));
  const [addOpen, setAddOpen] = useState(false);
  const [reset, setReset] = useState<{ emp: Employee; kind: 'pin' | 'password' } | null>(null);
  const rows = (list.data ?? []).filter((e) => e.role !== 'super_admin');
  const activeCashiers = rows.filter((e) => e.is_active && e.role === 'sotuvchi').length;

  const toggle = async (e: Employee) => {
    if (e.is_active) {
      const ok = await confirm({ title: `${e.full_name} bloklansinmi?`, message: 'Tizimga kira olmaydi. Sotuvlar tarixi saqlanadi. Keyin qayta faollashtirish mumkin.', confirmText: 'Bloklash', danger: true });
      if (!ok) return;
    }
    try {
      const r = await api<{ message: string }>(`/api/employees/${e.id}/toggle`, 'PATCH');
      toast.show(r.message, e.is_active ? 'warning' : 'success'); list.reload();
    } catch (err) { toast.show(err instanceof ApiError ? err.message : 'Xatolik', 'error'); }
  };

  return (
    <section className="st-card" aria-labelledby="st-emp">
      <h2 id="st-emp" className="st-card__title"><i className="fa-solid fa-users-gear" aria-hidden="true" /> Xodimlar
        <span className="st-muted st-card__count">Kassir: {activeCashiers}/{MAX_CASHIERS}</span>
        <Button size="sm" icon="fa-plus" onClick={() => setAddOpen(true)} disabled={activeCashiers >= MAX_CASHIERS} className="st-card__act"
                title={activeCashiers >= MAX_CASHIERS ? "3 ta kassir — limit to'lgan" : undefined}>Qo'shish</Button>
      </h2>
      {list.loading && !list.data ? <Skeleton height={120} radius={14} /> : (
        <ul className="st-emps">
          {rows.map((e) => {
            const self = e.id === me?.user_id || e.username === me?.username;
            return (
              <li key={e.id} className={`st-emp${e.is_active ? '' : ' is-off'}`}>
                <div className={`st-emp__ava${e.role === 'admin' ? ' is-admin' : ''}`} aria-hidden="true">{e.full_name.charAt(0).toUpperCase()}</div>
                <div className="st-emp__main">
                  <b>{e.full_name}{self && <span className="st-muted"> (siz)</span>}</b>
                  <small>@{e.username} · {e.role === 'admin' ? 'Admin' : 'Kassir'}{e.last_seen_at && ` · oxirgi: ${dateTime(e.last_seen_at)}`}</small>
                </div>
                {!e.is_active && <Badge tone="red">Bloklangan</Badge>}
                {!self && (
                  <div className="st-emp__acts">
                    <IconButton icon="fa-hashtag" label={`${e.full_name}: PIN ni tiklash`} onClick={() => setReset({ emp: e, kind: 'pin' })} />
                    <IconButton icon="fa-key" label={`${e.full_name}: parolni tiklash`} onClick={() => setReset({ emp: e, kind: 'password' })} />
                    <IconButton icon={e.is_active ? 'fa-ban' : 'fa-check'} label={e.is_active ? `${e.full_name}: bloklash` : `${e.full_name}: faollashtirish`}
                                className={e.is_active ? 'inv-danger-icon' : 'st-ok-icon'} onClick={() => toggle(e)} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="st-muted">Do'konda 1 ta admin va {MAX_CASHIERS} tagacha kassir. Kassir kassada PIN bilan tez kiradi.</p>
      <AddEmployee open={addOpen} onClose={() => setAddOpen(false)} onSaved={list.reload} />
      <ResetModal value={reset} onClose={() => setReset(null)} />
    </section>
  );
}

function AddEmployee({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ full_name: '', username: '', password: '', pin: '' });
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setF({ full_name: '', username: '', password: '', pin: '' }); setErr({}); } }, [open]);
  const set = (k: keyof typeof f, v: string) => { setF({ ...f, [k]: v }); setErr({}); };

  const save = async () => {
    const e: Record<string, string> = {};
    if (!f.full_name.trim()) e.full_name = 'Ism-familiyani yozing';
    if (!/^[a-z0-9_.]{3,30}$/.test(f.username)) e.username = "3–30 ta lotin harf, raqam, _ yoki .";
    if (f.password.length < 4) e.password = 'Kamida 4 belgi';
    if (!/^\d{4,8}$/.test(f.pin)) e.pin = '4–8 ta raqam';
    setErr(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      await api('/api/employees/', 'POST', { full_name: f.full_name.trim(), username: f.username, password: f.password, pin_code: f.pin, role: 'sotuvchi' });
      toast.show(`${f.full_name.trim()} qo'shildi. Login: ${f.username}`, 'success');
      onSaved(); onClose();
    } catch (x) {
      const m = x instanceof ApiError ? x.message : 'Saqlanmadi';
      setErr(/username/i.test(m) ? { username: m } : { pin: m });
    } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Yangi kassir"
           footer={<><Button variant="ghost" onClick={onClose}>Bekor</Button><Button icon="fa-check" loading={busy} onClick={save}>Qo'shish</Button></>}>
      <form className="pf-form" onSubmit={(e) => { e.preventDefault(); save(); }} autoComplete="off" noValidate>
        <button type="submit" className="sr-only" tabIndex={-1} aria-hidden="true" />
        <Field label="Ism-familiya" required autoFocus value={f.full_name} error={err.full_name} maxLength={80} onChange={(e) => set('full_name', e.target.value)} />
        <Field label="Login (username)" required placeholder="masalan: kamol" value={f.username} error={err.username} autoCapitalize="none"
               onChange={(e) => set('username', e.target.value.toLowerCase().replace(/\s/g, ''))} />
        <div className="pf-grid2">
          <Field label="Parol" required type="password" autoComplete="new-password" value={f.password} error={err.password} onChange={(e) => set('password', e.target.value)} />
          <Field label="PIN (kassaga tez kirish)" required inputMode="numeric" type="password" autoComplete="off" value={f.pin} error={err.pin}
                 onChange={(e) => set('pin', cleanNumInput(e.target.value, false).slice(0, 8))} />
        </div>
      </form>
    </Modal>
  );
}

function ResetModal({ value, onClose }: { value: { emp: Employee; kind: 'pin' | 'password' } | null; onClose: () => void }) {
  const toast = useToast();
  const [v, setV] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setV(''); setErr(null); }, [value]);
  const pin = value?.kind === 'pin';

  const save = async () => {
    if (!value) return;
    if (pin ? !/^\d{4,8}$/.test(v) : v.length < 4) { setErr(pin ? '4–8 ta raqam' : 'Kamida 4 belgi'); return; }
    setBusy(true);
    try {
      await api(`/api/employees/${value.emp.id}/reset-${pin ? 'pin' : 'password'}`, 'POST', pin ? { new_pin: v } : { new_password: v });
      toast.show(`${value.emp.full_name}: ${pin ? 'PIN' : 'parol'} yangilandi`, 'success');
      onClose();
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Saqlanmadi'); }
    finally { setBusy(false); }
  };

  return (
    <Modal open={!!value} onClose={onClose} title={value ? `${value.emp.full_name}: ${pin ? 'yangi PIN' : 'yangi parol'}` : ''}
           footer={<><Button variant="ghost" onClick={onClose}>Bekor</Button><Button icon="fa-check" loading={busy} onClick={save}>Saqlash</Button></>}>
      <form className="pf-form" onSubmit={(e) => { e.preventDefault(); save(); }} noValidate>
        <Field label={pin ? 'Yangi PIN (4–8 raqam)' : 'Yangi parol'} autoFocus inputMode={pin ? 'numeric' : undefined} autoComplete="off"
               value={v} error={err} onChange={(e) => { setV(pin ? cleanNumInput(e.target.value, false).slice(0, 8) : e.target.value); setErr(null); }} />
        <p className="st-muted">Xodimga yangi {pin ? 'PIN' : 'parol'}ni ayting. U keyin o'zi Sozlamalarda o'zgartirishi mumkin.</p>
      </form>
    </Modal>
  );
}
