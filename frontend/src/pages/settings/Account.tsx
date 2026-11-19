import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { getUser, isAdmin } from '@/lib/auth';
import { cleanNumInput } from '@/lib/format';
import { logout } from '@/lib/session';
import { Badge, Button, Field, Modal, useConfirm, useToast } from '@/components/ui';
import type { Me, StoreInfo } from './types';

const ROLE: Record<string, string> = { admin: 'Administrator', sotuvchi: 'Kassir', cashier: 'Kassir', super_admin: 'SuperAdmin' };

export function Profile({ me }: { me: Me | null }) {
  const toast = useToast();
  const confirm = useConfirm();
  const u = me ?? getUser();
  const [pinOpen, setPinOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const name = (me?.full_name ?? getUser()?.full_name) || 'Foydalanuvchi';

  const out = async () => {
    if (!(await confirm({ title: 'Tizimdan chiqish', message: 'Kassadan chiqmoqchimisiz?', confirmText: 'Chiqish', danger: true }))) return;
    const r = await logout();
    if (!r.ok) toast.show(`${r.pending} ta oflayn sotuv hali serverga yuborilmagan. Internetga ulanib, yuborilishini kuting.`, 'error');
  };

  return (
    <section className="st-card" aria-labelledby="st-profile">
      <h2 id="st-profile" className="st-card__title"><i className="fa-solid fa-user" aria-hidden="true" /> Mening profilim</h2>
      <div className="st-profile">
        <div className="st-ava" aria-hidden="true">{name.charAt(0).toUpperCase()}</div>
        <div className="st-profile__main">
          <b>{name}</b>
          <span>@{u?.username}</span>
        </div>
        <Badge tone={isAdmin() ? 'blue' : 'gray'}>{ROLE[u?.role ?? ''] ?? u?.role}</Badge>
      </div>
      <div className="st-btns">
        <Button variant="outline" icon="fa-key" onClick={() => setPwOpen(true)}>Parolni o'zgartirish</Button>
        <Button variant="outline" icon="fa-hashtag" onClick={() => setPinOpen(true)}>PIN kodni o'zgartirish</Button>
        <Button variant="danger-soft" icon="fa-right-from-bracket" onClick={out}>Tizimdan chiqish</Button>
      </div>
      <SecretModal kind="pin" open={pinOpen} onClose={() => setPinOpen(false)} />
      <SecretModal kind="password" open={pwOpen} onClose={() => setPwOpen(false)} />
    </section>
  );
}

function SecretModal({ kind, open, onClose }: { kind: 'pin' | 'password'; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const pin = kind === 'pin';
  const [a, setA] = useState(''); const [b, setB] = useState(''); const [c, setC] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setA(''); setB(''); setC(''); setErr(null); } }, [open]);
  const clean = (v: string) => (pin ? cleanNumInput(v, false).slice(0, 8) : v);

  const save = async () => {
    if (!a) { setErr(pin ? 'Eski PIN ni yozing' : 'Eski parolni yozing'); return; }
    if (pin ? !/^\d{4,8}$/.test(b) : b.length < 4) { setErr(pin ? 'Yangi PIN 4–8 ta raqam bo\'lsin' : 'Yangi parol kamida 4 belgi'); return; }
    if (b !== c) { setErr('Yangisi ikki marta bir xil yozilmadi'); return; }
    setBusy(true);
    try {
      await api(pin ? '/api/auth/change-pin' : '/api/auth/change-password', 'POST', pin ? { old_pin: a, new_pin: b } : { old_password: a, new_password: b });
      toast.show(pin ? "PIN o'zgartirildi" : "Parol o'zgartirildi", 'success');
      onClose();
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Saqlanmadi'); }
    finally { setBusy(false); }
  };

  const common = { type: 'password', autoComplete: pin ? 'off' : 'new-password', inputMode: pin ? ('numeric' as const) : undefined };
  return (
    <Modal open={open} onClose={onClose} title={pin ? "PIN kodni o'zgartirish" : "Parolni o'zgartirish"}
           footer={<><Button variant="ghost" onClick={onClose}>Bekor</Button><Button icon="fa-check" loading={busy} onClick={save}>Saqlash</Button></>}>
      <form className="pf-form" onSubmit={(e) => { e.preventDefault(); save(); }} noValidate>
        <button type="submit" className="sr-only" tabIndex={-1} aria-hidden="true" />
        <Field label={pin ? 'Eski PIN' : 'Eski parol'} autoFocus {...common} autoComplete={pin ? 'off' : 'current-password'} value={a} onChange={(e) => { setA(clean(e.target.value)); setErr(null); }} />
        <Field label={pin ? 'Yangi PIN (4–8 raqam)' : 'Yangi parol'} {...common} value={b} onChange={(e) => { setB(clean(e.target.value)); setErr(null); }} />
        <Field label="Yangisini takrorlang" {...common} value={c} error={err} onChange={(e) => { setC(clean(e.target.value)); setErr(null); }} />
      </form>
    </Modal>
  );
}

export function StoreSection({ store, onSaved }: { store: StoreInfo | null; onSaved: (s: StoreInfo) => void }) {
  const toast = useToast();
  const admin = isAdmin();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', phone: '', address: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const edit = () => { setF({ name: store?.name ?? '', phone: store?.phone ?? '', address: store?.address ?? '' }); setErr(null); setOpen(true); };
  const save = async () => {
    if (!f.name.trim()) { setErr("Do'kon nomini yozing"); return; }
    setBusy(true);
    try {
      const s = await api<StoreInfo>('/api/stores/me', 'PATCH', { name: f.name.trim(), phone: f.phone.trim() || null, address: f.address.trim() || null });
      // Menyu va chekdagi nom ham yangilansin
      try {
        const ui = JSON.parse(localStorage.getItem('user_info') || '{}');
        ui.store_name = s.name; if (ui.store) ui.store.name = s.name;
        localStorage.setItem('user_info', JSON.stringify(ui));
      } catch { /* xotira yopiq */ }
      toast.show('Saqlandi', 'success');
      onSaved(s); setOpen(false);
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Saqlanmadi'); }
    finally { setBusy(false); }
  };

  return (
    <section className="st-card" aria-labelledby="st-store">
      <h2 id="st-store" className="st-card__title"><i className="fa-solid fa-shop" aria-hidden="true" /> Do'kon ma'lumotlari
        {admin && <Button size="sm" variant="ghost" icon="fa-pen" onClick={edit} className="st-card__act">Tahrirlash</Button>}
      </h2>
      <dl className="st-dl">
        <div><dt>Nomi</dt><dd>{store?.name || '—'}</dd></div>
        <div><dt>Telefon</dt><dd>{store?.phone || <span className="st-muted">Kiritilmagan</span>}</dd></div>
        <div><dt>Manzil</dt><dd>{store?.address || <span className="st-muted">Kiritilmagan</span>}</dd></div>
      </dl>
      <Modal open={open} onClose={() => setOpen(false)} title="Do'kon ma'lumotlari"
             footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Bekor</Button><Button icon="fa-check" loading={busy} onClick={save}>Saqlash</Button></>}>
        <form className="pf-form" onSubmit={(e) => { e.preventDefault(); save(); }} noValidate>
          <button type="submit" className="sr-only" tabIndex={-1} aria-hidden="true" />
          <Field label="Do'kon nomi" required autoFocus value={f.name} error={err} maxLength={100} onChange={(e) => { setF({ ...f, name: e.target.value }); setErr(null); }} />
          <Field label="Telefon" type="tel" inputMode="tel" placeholder="+998 90 123 45 67" value={f.phone} maxLength={20} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          <Field label="Manzil" placeholder="Shahar, ko'cha" value={f.address} maxLength={200} onChange={(e) => setF({ ...f, address: e.target.value })} />
        </form>
      </Modal>
    </section>
  );
}
