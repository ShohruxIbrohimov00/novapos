import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { money } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import { Button, Field, IconButton, Page, Skeleton, useConfirm, useToast } from '@/components/ui';
import { NumField } from '@/pages/products/fields';
import './superadmin.css';

interface Stats { total_stores: number; active_stores: number; pending_requests: number; total_revenue: number }
interface Tarif { id: number; name: string; months: number; price: number }
interface PaySet { card_number: string; card_owner: string; support_phone: string }

export function SuperDashboard() {
  const stats = useAsync(() => api<Stats>('/api/superadmin/stats'));
  const s = stats.data;
  return (
    <Page title="Boshqaruv paneli" sub="NovaPOS SuperAdmin">
      <div className="sa-kpis">
        {!s ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} height={96} radius={18} />) : <>
          <Link to="/superadmin/stores" className="sa-kpi"><span><i className="fa-solid fa-shop" aria-hidden="true" /> Do'konlar</span><b>{s.total_stores}</b></Link>
          <Link to="/superadmin/stores" className="sa-kpi"><span><i className="fa-solid fa-circle-check" aria-hidden="true" /> Faol</span><b className="tone-success">{s.active_stores}</b></Link>
          <Link to="/superadmin/requests" className={`sa-kpi${s.pending_requests ? ' sa-kpi--alert' : ''}`}><span><i className="fa-solid fa-hourglass-half" aria-hidden="true" /> Kutilayotgan to'lovlar</span><b>{s.pending_requests}</b></Link>
          <div className="sa-kpi"><span><i className="fa-solid fa-sack-dollar" aria-hidden="true" /> Jami tushum</span><b>{money(s.total_revenue)}</b></div>
        </>}
      </div>
      <div className="sa-grid">
        <Tarifs />
        <PaymentSettings />
      </div>
    </Page>
  );
}

function Tarifs() {
  const toast = useToast();
  const confirm = useConfirm();
  const list = useAsync(() => api<Tarif[]>('/api/superadmin/tarifs'));
  const [f, setF] = useState({ name: '', months: '', price: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const add = async () => {
    const months = Number(f.months), price = Number(f.price);
    if (!f.name.trim() || !(months > 0) || !(price > 0)) { setErr('Nomi, oy soni va narxini yozing'); return; }
    setBusy(true); setErr(null);
    try {
      await api('/api/superadmin/tarifs', 'POST', { name: f.name.trim(), months, price });
      toast.show(`"${f.name.trim()}" tarifi qo'shildi`, 'success');
      setF({ name: '', months: '', price: '' }); list.reload();
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Saqlanmadi'); }
    finally { setBusy(false); }
  };
  const del = async (t: Tarif) => {
    if (!(await confirm({ title: 'Tarifni o\'chirish', message: `"${t.name}" o'chirilsinmi?`, confirmText: "O'chirish", danger: true }))) return;
    try { await api(`/api/superadmin/tarifs/${t.id}`, 'DELETE'); toast.show("O'chirildi", 'success'); list.reload(); }
    catch (e) { toast.show(e instanceof ApiError ? e.message : "O'chirilmadi", 'error'); }
  };

  return (
    <section className="st-card" aria-labelledby="sa-tarifs">
      <h2 id="sa-tarifs" className="st-card__title"><i className="fa-solid fa-tags" aria-hidden="true" /> Tariflar</h2>
      {list.loading && !list.data ? <Skeleton height={80} radius={12} /> : !list.data?.length ? <p className="st-muted">Tarif yo'q — do'konlar to'lov qila olmaydi. Birinchisini qo'shing.</p> : (
        <ul className="sa-list">
          {list.data.map((t) => (
            <li key={t.id}>
              <span><b>{t.name}</b><small>{t.months} oy · oyiga {money(t.price / t.months, false)}</small></span>
              <b>{money(t.price)}</b>
              <IconButton icon="fa-trash-can" label={`${t.name} — o'chirish`} className="inv-danger-icon" onClick={() => del(t)} />
            </li>
          ))}
        </ul>
      )}
      <form className="sa-tarif-form" onSubmit={(e) => { e.preventDefault(); add(); }} noValidate>
        <Field label="Nomi" placeholder="Masalan: 3 oy" value={f.name} onChange={(e) => { setF({ ...f, name: e.target.value }); setErr(null); }} maxLength={40} />
        <NumField label="Oy" decimals={false} value={f.months} onValue={(v) => { setF({ ...f, months: v }); setErr(null); }} placeholder="1" maxLength={3} />
        <NumField label="Narx" isMoney decimals={false} value={f.price} onValue={(v) => { setF({ ...f, price: v }); setErr(null); }} placeholder="99000" />
        <Button type="submit" icon="fa-plus" loading={busy}>Qo'shish</Button>
      </form>
      {err && <div className="au-err" role="alert">{err}</div>}
    </section>
  );
}

function PaymentSettings() {
  const toast = useToast();
  const data = useAsync(() => api<PaySet>('/api/superadmin/settings/payment'));
  const [f, setF] = useState<PaySet>({ card_number: '', card_owner: '', support_phone: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data.data) setF(data.data); }, [data.data]);

  const save = async () => {
    if (f.card_number.replace(/\D/g, '').length < 16) { toast.show('Karta raqami 16 ta raqam', 'error'); return; }
    setBusy(true);
    try { await api('/api/superadmin/settings/payment', 'PATCH', f); toast.show("To'lov ma'lumotlari saqlandi", 'success'); data.reload(); }
    catch (e) { toast.show(e instanceof ApiError ? e.message : 'Saqlanmadi', 'error'); }
    finally { setBusy(false); }
  };
  const fmtCard = (v: string) => v.replace(/\D/g, '').slice(0, 16).replace(/(\d{4})(?=\d)/g, '$1 ');

  return (
    <section className="st-card" aria-labelledby="sa-pay">
      <h2 id="sa-pay" className="st-card__title"><i className="fa-solid fa-credit-card" aria-hidden="true" /> To'lov qabul qilish</h2>
      <p className="st-muted">Do'konlar obuna uchun shu kartaga pul o'tkazadi va chek rasmini yuboradi.</p>
      <form className="pf-form" onSubmit={(e) => { e.preventDefault(); save(); }} noValidate>
        <Field label="Karta raqami" inputMode="numeric" className="pf-mono" value={f.card_number} onChange={(e) => setF({ ...f, card_number: fmtCard(e.target.value) })} />
        <Field label="Karta egasi" value={f.card_owner} onChange={(e) => setF({ ...f, card_owner: e.target.value.toUpperCase() })} maxLength={60} />
        <Field label="Yordam telefoni" type="tel" value={f.support_phone} onChange={(e) => setF({ ...f, support_phone: e.target.value })} maxLength={20} />
        <Button type="submit" icon="fa-check" loading={busy}>Saqlash</Button>
      </form>
    </section>
  );
}
