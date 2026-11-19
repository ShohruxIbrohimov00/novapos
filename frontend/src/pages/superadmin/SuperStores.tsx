import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { impersonate } from '@/lib/session';
import { useAsync } from '@/lib/useAsync';
import { Badge, Button, EmptyState, Field, Modal, Page, Skeleton, Tabs, useConfirm, useToast } from '@/components/ui';
import './superadmin.css';

interface Store { id: number; name: string; phone: string | null; address: string | null; is_active: boolean; emp_count: number; payment_status: string; expires_at: string | null; days_left: number | null; created_at: string | null }
interface Emp { id: number; full_name: string; username: string; role: string; is_active: boolean }
type F = 'all' | 'soon' | 'expired' | 'pending' | 'blocked';

function state(s: Store): { key: F | 'ok'; label: string; tone: 'green' | 'amber' | 'red' | 'gray' } {
  if (!s.is_active) return { key: 'blocked', label: 'Bloklangan', tone: 'gray' };
  if (s.payment_status === 'pending') return { key: 'pending', label: "To'lov kutilmoqda", tone: 'amber' };
  if (s.days_left !== null && s.days_left < 0) return { key: 'expired', label: 'Muddati tugagan', tone: 'red' };
  if (s.days_left !== null && s.days_left <= 5) return { key: 'soon', label: `${s.days_left} kun qoldi`, tone: 'amber' };
  return { key: 'ok', label: s.days_left !== null ? `${s.days_left} kun` : 'Faol', tone: 'green' };
}

export function SuperStores() {
  const list = useAsync(() => api<Store[]>('/api/superadmin/stores'));
  const [q, setQ] = useState('');
  const [f, setF] = useState<F>('all');
  const [openId, setOpenId] = useState<number | null>(null);
  const all = list.data ?? [];
  const cnt = (k: F) => all.filter((s) => state(s).key === k).length;
  const rows = useMemo(() => all
    .filter((s) => f === 'all' || state(s).key === f)
    .filter((s) => !q.trim() || s.name.toLowerCase().includes(q.trim().toLowerCase()) || (s.phone ?? '').includes(q.trim())), [all, f, q]);
  const opened = all.find((s) => s.id === openId) ?? null;

  return (
    <Page title="Do'konlar" sub={`${all.length} ta do'kon`}
          toolbar={<>
            <Field icon="fa-magnifying-glass" type="search" placeholder="Nomi yoki telefon" aria-label="Do'kon qidirish" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="period-tabs"><Tabs label="Holat" value={f} onChange={setF}
              items={[{ value: 'all', label: 'Hammasi', count: all.length }, { value: 'soon', label: 'Tugayapti', count: cnt('soon') }, { value: 'expired', label: 'Tugagan', count: cnt('expired') }, { value: 'pending', label: "To'lov kutilmoqda", count: cnt('pending') }, { value: 'blocked', label: 'Bloklangan', count: cnt('blocked') }]} /></div>
          </>}>
      {list.loading && !list.data ? <div className="sa-stores">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} height={84} radius={16} />)}</div>
        : !rows.length ? <EmptyState icon="fa-shop" title="Do'kon topilmadi" />
        : (
          <ul className="sa-stores">
            {rows.map((s) => {
              const st = state(s);
              return (
                <li key={s.id}>
                  <button type="button" className={`rp-row rp-row--btn${s.is_active ? '' : ' is-off'}`} onClick={() => setOpenId(s.id)}>
                    <span className="rp-row__ava rp-row__ava--sup">{s.name.charAt(0).toUpperCase()}</span>
                    <div className="rp-row__main"><b>{s.name}</b><small>{s.phone || "Telefon yo'q"} · {s.emp_count} xodim · {dateTime(s.created_at).slice(0, 10)}</small></div>
                    <Badge tone={st.tone}>{st.label}</Badge>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      <StoreModal store={opened} onClose={() => setOpenId(null)} onChanged={list.reload} />
    </Page>
  );
}

function StoreModal({ store, onClose, onChanged }: { store: Store | null; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [emps, setEmps] = useState<Emp[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [delOpen, setDelOpen] = useState(false);
  const [delName, setDelName] = useState('');
  const id = store?.id;
  useEffect(() => { setEmps(null); setDelOpen(false); setDelName(''); if (id) api<Emp[]>(`/api/superadmin/stores/${id}/employees`).then(setEmps).catch(() => setEmps([])); }, [id]);
  if (!store) return <Modal open={false} onClose={onClose} title="">{null}</Modal>;
  const st = state(store);

  const run = async (key: string, fn: () => Promise<string | void>) => {
    setBusy(key);
    try { const m = await fn(); if (m) toast.show(m, 'success'); onChanged(); }
    catch (e) { toast.show(e instanceof ApiError ? e.message : 'Xatolik', 'error'); }
    finally { setBusy(null); }
  };
  const extend = (months: number) => run(`ext${months}`, async () => {
    const r = await api<{ expires_at: string }>(`/api/superadmin/stores/${store.id}/extend`, 'POST', { months, reason: 'superadmin' });
    return `${store.name}: +${months} oy (${dateTime(r.expires_at).slice(0, 10)} gacha)`;
  });
  const toggle = async () => {
    if (store.is_active && !(await confirm({ title: "Do'konni bloklash", message: `"${store.name}" xodimlari tizimga kira olmaydi.`, confirmText: 'Bloklash', danger: true }))) return;
    run('toggle', async () => (await api<{ message: string }>(`/api/superadmin/stores/${store.id}/toggle`, 'PATCH')).message);
  };
  const loginAs = async () => {
    if (!(await confirm({ title: "Do'kon nomidan kirish", message: `"${store.name}" admini sifatida kirasiz (yordam berish uchun). Chiqqanda o'z hisobingizga qaytasiz.`, confirmText: 'Kirish' }))) return;
    setBusy('login');
    try {
      const r = await api<{ access_token: string; user_info: unknown }>(`/api/superadmin/login-as-store/${store.id}`, 'POST');
      impersonate(r.access_token, r.user_info);
    } catch (e) { toast.show(e instanceof ApiError ? e.message : 'Kirib bo\'lmadi', 'error'); setBusy(null); }
  };
  const del = () => run('del', async () => {
    const r = await api<{ message: string }>(`/api/superadmin/stores/${store.id}`, 'DELETE');
    onClose(); return r.message;
  });

  return (
    <Modal open onClose={onClose} title={store.name} wide>
      <div className="rp-sup">
        <div className="sa-store-head"><Badge tone={st.tone}>{st.label}</Badge>
          <span className="st-muted">{store.expires_at ? `Obuna: ${dateTime(store.expires_at).slice(0, 10)} gacha` : 'Muddatsiz'}</span></div>
        <dl className="st-dl">
          <div><dt>Telefon</dt><dd>{store.phone ? <a href={`tel:${store.phone}`}>{store.phone}</a> : '—'}</dd></div>
          <div><dt>Manzil</dt><dd>{store.address || '—'}</dd></div>
          <div><dt>Ro'yxatdan o'tgan</dt><dd>{dateTime(store.created_at)}</dd></div>
        </dl>
        <div className="cust-h">Obunani uzaytirish</div>
        <div className="sa-extend">
          {[1, 3, 6, 12].map((m) => <Button key={m} variant="outline" size="sm" loading={busy === `ext${m}`} onClick={() => extend(m)}>+{m} oy</Button>)}
        </div>
        <div className="cust-h">Xodimlar</div>
        {emps === null ? <Skeleton height={60} radius={12} /> : !emps.length ? <p className="st-muted">Xodim yo'q</p> : (
          <ul className="st-emps">
            {emps.map((e) => (
              <li key={e.id} className={`st-emp${e.is_active ? '' : ' is-off'}`}>
                <div className={`st-emp__ava${e.role === 'admin' ? ' is-admin' : ''}`} aria-hidden="true">{e.full_name.charAt(0).toUpperCase()}</div>
                <div className="st-emp__main"><b>{e.full_name}</b><small>@{e.username} · {e.role === 'admin' ? 'Admin' : 'Kassir'}</small></div>
                {!e.is_active && <Badge tone="red">Bloklangan</Badge>}
              </li>
            ))}
          </ul>
        )}
        <div className="sa-actions">
          <Button icon="fa-right-to-bracket" loading={busy === 'login'} onClick={loginAs} disabled={!store.is_active}>Do'kon nomidan kirish</Button>
          <Button variant={store.is_active ? 'danger-soft' : 'success'} icon={store.is_active ? 'fa-ban' : 'fa-check'} loading={busy === 'toggle'} onClick={toggle}>
            {store.is_active ? 'Bloklash' : 'Blokdan chiqarish'}</Button>
          <Button variant="ghost" icon="fa-trash-can" onClick={() => setDelOpen((v) => !v)}>O'chirish…</Button>
        </div>
        {delOpen && (
          <div className="sa-danger">
            <p><b>Diqqat:</b> do'kon, uning xodimlari va to'lov so'rovlari butunlay o'chiriladi. Buni qaytarib bo'lmaydi. Tasdiqlash uchun do'kon nomini yozing: <b>{store.name}</b></p>
            <Field aria-label="Do'kon nomi" value={delName} onChange={(e) => setDelName(e.target.value)} />
            <Button variant="danger" icon="fa-trash-can" disabled={delName.trim() !== store.name} loading={busy === 'del'} onClick={del}>Butunlay o'chirish</Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
