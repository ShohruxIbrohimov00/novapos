import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { dateTime, money } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import { Badge, Button, EmptyState, Modal, Page, Skeleton, Tabs, useConfirm, useToast } from '@/components/ui';
import './superadmin.css';

interface Req { id: number; amount: number; plan_months: number; tarif_name: string; store_id: number; store_name: string; admin_name: string; proof_url: string | null; status: 'pending' | 'approved' | 'rejected'; created_at: string | null }
type F = 'pending' | 'approved' | 'rejected' | 'all';
const ST: Record<string, { label: string; tone: 'amber' | 'green' | 'red' }> = {
  pending: { label: 'Kutilmoqda', tone: 'amber' }, approved: { label: 'Tasdiqlangan', tone: 'green' }, rejected: { label: 'Rad etilgan', tone: 'red' },
};

export function SuperRequests() {
  const toast = useToast();
  const confirm = useConfirm();
  const [f, setF] = useState<F>('pending');
  const all = useAsync(() => api<Req[]>('/api/superadmin/requests?status_filter=all'));
  const [img, setImg] = useState<Req | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const rows = (all.data ?? []).filter((r) => f === 'all' || r.status === f);
  const count = (s: F) => (all.data ?? []).filter((r) => s === 'all' || r.status === s).length;

  const act = async (r: Req, kind: 'approve' | 'reject') => {
    const ok = await confirm(kind === 'approve'
      ? { title: "To'lovni tasdiqlash", message: `${r.store_name}: ${money(r.amount)} — obuna ${r.plan_months} oyga uzaytiriladi.`, confirmText: 'Tasdiqlash' }
      : { title: "To'lovni rad etish", message: `${r.store_name}: ${money(r.amount)} rad etilsinmi? Do'kon qayta chek yuborishi mumkin.`, confirmText: 'Rad etish', danger: true });
    if (!ok) return;
    setBusy(r.id);
    try {
      const x = await api<{ message: string }>(`/api/superadmin/${kind}/${r.id}`, 'POST');
      toast.show(x.message, kind === 'approve' ? 'success' : 'warning');
      setImg(null); all.reload();
    } catch (e) { toast.show(e instanceof ApiError ? e.message : 'Xatolik', 'error'); }
    finally { setBusy(null); }
  };

  return (
    <Page title="To'lov so'rovlari"
          toolbar={<Tabs label="Holat" value={f} onChange={setF}
                         items={[{ value: 'pending', label: 'Kutilmoqda', count: count('pending') }, { value: 'approved', label: 'Tasdiqlangan', count: count('approved') }, { value: 'rejected', label: 'Rad etilgan', count: count('rejected') }, { value: 'all', label: 'Hammasi' }]} />}>
      {all.loading && !all.data ? <div className="sa-reqs">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} height={120} radius={18} />)}</div>
        : !rows.length ? <EmptyState icon={f === 'pending' ? 'fa-circle-check' : 'fa-inbox'} title={f === 'pending' ? "Kutilayotgan to'lov yo'q" : "Hech narsa yo'q"} />
        : (
          <ul className="sa-reqs">
            {rows.map((r) => (
              <li key={r.id} className="st-card sa-req">
                {r.proof_url ? (
                  <button type="button" className="sa-req__img" onClick={() => setImg(r)} aria-label={`${r.store_name} — chek rasmini kattalashtirish`}>
                    <img src={r.proof_url} alt="" loading="lazy" />
                  </button>
                ) : <div className="sa-req__img sa-req__img--none"><i className="fa-solid fa-image" aria-hidden="true" /></div>}
                <div className="sa-req__main">
                  <div className="sa-req__top"><b>{r.store_name}</b><Badge tone={ST[r.status]?.tone ?? 'amber'}>{ST[r.status]?.label ?? r.status}</Badge></div>
                  <div className="sa-req__sum">{money(r.amount)} <small>· {r.tarif_name} · {r.plan_months} oy</small></div>
                  <small className="st-muted">{r.admin_name} · {dateTime(r.created_at)}</small>
                  {r.status === 'pending' && (
                    <div className="sa-req__acts">
                      <Button size="sm" variant="success" icon="fa-check" loading={busy === r.id} onClick={() => act(r, 'approve')}>Tasdiqlash</Button>
                      <Button size="sm" variant="danger-soft" icon="fa-xmark" disabled={busy === r.id} onClick={() => act(r, 'reject')}>Rad etish</Button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      <Modal open={!!img} onClose={() => setImg(null)} title={img ? `${img.store_name} — ${money(img.amount)}` : ''} wide
             footer={img?.status === 'pending' ? <><Button variant="danger-soft" icon="fa-xmark" onClick={() => img && act(img, 'reject')}>Rad etish</Button><Button variant="success" icon="fa-check" onClick={() => img && act(img, 'approve')}>Tasdiqlash</Button></> : undefined}>
        {img?.proof_url && <img className="sa-proof" src={img.proof_url} alt="To'lov cheki" />}
      </Modal>
    </Page>
  );
}
