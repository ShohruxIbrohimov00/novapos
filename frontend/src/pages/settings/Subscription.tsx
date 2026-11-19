import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { isAdmin } from '@/lib/auth';
import { money } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import { Button, Skeleton, useToast } from '@/components/ui';
import type { Me, PaymentSettings, Tarif } from './types';

const fmtDate = (iso: string) => { const d = new Date(iso); return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`; };

export function Subscription({ me, onChanged }: { me: Me | null; onChanged: () => void }) {
  const toast = useToast();
  const admin = isAdmin();
  const tarifs = useAsync(() => api<Tarif[]>('/api/subscriptions/tarifs'));
  const pay = useAsync(() => api<PaymentSettings>('/api/subscriptions/payment-settings'));
  const [tarif, setTarif] = useState<number | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const st = me?.store;
  const exp = st?.expires_at ? new Date(st.expires_at) : null;
  const days = exp ? Math.ceil((exp.getTime() - Date.now()) / 864e5) : null;
  const state = st?.payment_status === 'pending' ? 'pending' : days !== null && days <= 0 ? 'expired' : days !== null && days <= 5 ? 'soon' : 'active';
  const STATE = {
    active: { tone: 'ok', icon: 'fa-circle-check', title: days !== null ? `Faol — ${days} kun qoldi` : 'Faol', sub: exp ? `Muddat: ${fmtDate(exp.toISOString())}` : 'Muddatsiz' },
    soon: { tone: 'warn', icon: 'fa-hourglass-half', title: `${days} kun qoldi`, sub: `Muddat: ${exp ? fmtDate(exp.toISOString()) : ''} — oldindan to'lab qo'ying` },
    expired: { tone: 'bad', icon: 'fa-circle-xmark', title: 'Obuna tugagan', sub: "Kassa ishlashi uchun to'lov qiling" },
    pending: { tone: 'warn', icon: 'fa-clock', title: "To'lov tekshirilmoqda", sub: 'Chek yuborilgan, tasdiqlanishini kuting' },
  }[state];

  const pick = (f: File | undefined) => {
    if (!f) return;
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) { toast.show('Faqat JPG, PNG yoki WEBP rasm', 'error'); return; }
    if (f.size > 5 * 1024 * 1024) { toast.show("Rasm 5 MB dan kichik bo'lsin", 'error'); return; }
    if (preview) URL.revokeObjectURL(preview);
    setFile(f); setPreview(URL.createObjectURL(f));
  };

  const send = async () => {
    if (!tarif || !file) return;
    setBusy(true);
    try {
      const fd = new FormData(); fd.append('tarif_id', String(tarif)); fd.append('file', file);
      await api('/api/subscriptions/upload-proof', 'POST', fd);
      toast.show("Chek yuborildi. Tasdiqlangach obuna uzayadi.", 'success');
      setFile(null); setPreview(null); setTarif(null); if (fileRef.current) fileRef.current.value = '';
      onChanged();
    } catch (e) { toast.show(e instanceof ApiError ? e.message : 'Yuborilmadi', 'error'); }
    finally { setBusy(false); }
  };

  const copy = () => {
    const n = (pay.data?.card_number ?? '').replace(/\s/g, '');
    navigator.clipboard?.writeText(n).then(() => toast.show('Karta raqami nusxalandi', 'success'), () => toast.show(n, 'info'));
  };

  return (
    <section className="st-card" id="obuna" aria-labelledby="st-sub">
      <h2 id="st-sub" className="st-card__title"><i className="fa-solid fa-crown" aria-hidden="true" /> Obuna va to'lov</h2>
      {!me ? <Skeleton height={64} radius={14} /> : (
        <div className={`st-sub st-sub--${STATE.tone}`} role="status">
          <i className={`fa-solid ${STATE.icon}`} aria-hidden="true" />
          <div><b>{STATE.title}</b><span>{STATE.sub}</span></div>
        </div>
      )}

      {admin && state !== 'pending' && (
        <div className="st-pay">
          <div className="st-step"><span>1</span> Tarifni tanlang</div>
          {tarifs.loading && !tarifs.data ? <Skeleton height={80} radius={14} /> : !tarifs.data?.length ? (
            <p className="st-muted">Tariflar hali qo'shilmagan</p>
          ) : (
            <div className="st-tarifs" role="radiogroup" aria-label="Tarif">
              {tarifs.data.map((t) => (
                <button key={t.id} type="button" role="radio" aria-checked={tarif === t.id} className="st-tarif" onClick={() => setTarif(t.id)}>
                  <span className="st-tarif__name">{t.name}</span>
                  <b>{money(t.price)}</b>
                  <small>{t.months} oy · oyiga {money(t.price / Math.max(1, t.months), false)}</small>
                </button>
              ))}
            </div>
          )}

          <div className="st-step"><span>2</span> Shu kartaga o'tkazing</div>
          {pay.data && (
            <button type="button" className="st-cardno" onClick={copy} title="Nusxalash">
              <span><b>{pay.data.card_number}</b><small>{pay.data.card_owner}</small></span>
              <i className="fa-regular fa-copy" aria-hidden="true" />
            </button>
          )}

          <div className="st-step"><span>3</span> To'lov chekining rasmini yuklang</div>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" id="st-proof"
                 onChange={(e) => pick(e.target.files?.[0])} />
          {preview ? (
            <div className="st-proof">
              <img src={preview} alt="To'lov cheki" />
              <Button variant="ghost" size="sm" icon="fa-xmark" onClick={() => { setFile(null); setPreview(null); if (fileRef.current) fileRef.current.value = ''; }}>Boshqa rasm</Button>
            </div>
          ) : (
            <label htmlFor="st-proof" className="st-upload"><i className="fa-solid fa-camera" aria-hidden="true" /> Rasm tanlash yoki suratga olish<small>JPG, PNG · 5 MB gacha</small></label>
          )}
          <Button block size="lg" icon="fa-paper-plane" loading={busy} disabled={!tarif || !file} onClick={send}>
            {!tarif ? 'Avval tarifni tanlang' : !file ? 'Chek rasmini yuklang' : 'Yuborish'}
          </Button>
          {pay.data?.support_phone && <p className="st-muted">Savol bo'lsa: <a href={`tel:${pay.data.support_phone}`}>{pay.data.support_phone}</a></p>}
        </div>
      )}
      {!admin && state !== 'active' && <p className="st-muted">To'lovni do'kon egasi (administrator) qiladi.</p>}
    </section>
  );
}
