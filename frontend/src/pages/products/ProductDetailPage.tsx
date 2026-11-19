import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { isAdmin } from '@/lib/auth';
import { dateTime, money, parseNum, qty as fmtQty } from '@/lib/format';
import { categoryOf, isLow, UNIT_SHORT, type Product, type Unit } from '@/lib/products';
import { useProducts } from '@/lib/useProducts';
import { useScanner } from '@/lib/useScanner';
import { Badge, Button, EmptyState, Field, IconButton, Modal, Page, Skeleton, useConfirm, useToast } from '@/components/ui';
import { SUPPLY_TYPE, useCategories, useSuppliers, type SupplyRow } from './data';
import { BarcodeField, CategorySelect, Margin, NumField, QtyInput, UnitPills } from './fields';
import './products.css';

// Qiymatlar backend'dagi AdjustmentReason bilan bir xil
const ADJUST_REASONS: { value: string; label: string }[] = [
  { value: 'inventarizatsiya', label: 'Sanoq (inventarizatsiya)' },
  { value: 'shikastlangan', label: 'Buzilgan / yaroqsiz' },
  { value: 'tuzatish', label: 'Xato kiritilgan edi' },
  { value: 'boshqa', label: "Boshqa (yo'qolgan va h.k.)" },
];

const str = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));

export function ProductDetailPage() {
  const { id } = useParams();
  const pid = Number(id);
  const nav = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const admin = isAdmin();
  const { products, ready, refresh } = useProducts();
  const { categories, reload: reloadCats } = useCategories();
  const suppliers = useSuppliers();

  const cached = useMemo(() => products.find((p) => p.id === pid) ?? null, [products, pid]);
  const [fresh, setFresh] = useState<Product | null>(null);
  const [notFound, setNotFound] = useState(false);
  const p = fresh ?? cached;

  const loadFresh = useCallback(async () => {
    try { setFresh(await api<Product>(`/api/products/${pid}`)); setNotFound(false); } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.status === 422)) setNotFound(true);
    }
  }, [pid]);
  useEffect(() => {
    setFresh(null); setNotFound(!Number.isInteger(pid) || pid <= 0);
    if (Number.isInteger(pid) && pid > 0) loadFresh();
  }, [loadFresh, pid]);

  // Boshqa tovar skanerlansa — o'sha tovarga o'tish
  useScanner(useCallback((code: string) => {
    const x = products.find((q) => q.barcode === code || q.short_code === code);
    if (x) nav(`/products/${x.id}`);
    else nav(`/products/new?barcode=${encodeURIComponent(code)}`);
  }, [products, nav]));

  // ── Kirim tarixi (shu tovar) ──
  const [hist, setHist] = useState<SupplyRow[] | null>(null);
  const loadHist = useCallback(() => {
    api<SupplyRow[]>(`/api/products/supply-history?product_id=${pid}&limit=15`).then(setHist).catch(() => setHist([]));
  }, [pid]);
  useEffect(() => { setHist(null); loadHist(); }, [loadHist]);

  // ── Kirim ──
  const [inQty, setInQty] = useState('');
  const [inPrice, setInPrice] = useState('');
  const [inPriceOut, setInPriceOut] = useState('');
  const [supplier, setSupplier] = useState<number | null>(null);
  const [paid, setPaid] = useState(true);
  const [inBusy, setInBusy] = useState(false);
  const [inKey, setInKey] = useState(0);

  // ── Ma'lumotlar ──
  const [form, setForm] = useState({ name: '', barcode: '', plu: '', cat: null as number | null, unit: 'dona' as Unit, pin: '', pout: '', min: '' });
  const [formErr, setFormErr] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [adjOpen, setAdjOpen] = useState(false);

  const base = useMemo(() => p && ({
    name: p.name, barcode: p.barcode ?? '', plu: p.short_code ?? '', cat: p.category_id, unit: p.unit_type,
    pin: str(p.price_in), pout: str(p.price_out), min: str(p.min_stock_limit ?? 0),
  }), [p]);
  // Tovar o'zgarganda (boshqa tovarga o'tildi yoki saqlandi) — formani to'ldirish
  const baseSig = base ? JSON.stringify(base) : '';
  useEffect(() => {
    if (!base) return;
    setForm(base);
    setFormErr({});
    setInPrice(base.pin === '0' ? '' : base.pin);
    setInPriceOut(base.pout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseSig]);

  const dirty = !!base && JSON.stringify(form) !== baseSig;
  const others = useMemo(() => products.filter((x) => x.id !== pid), [products, pid]);
  const bcOwner = form.barcode.trim() ? others.find((x) => x.barcode === form.barcode.trim()) : undefined;
  const pluOwner = form.plu.trim() ? others.find((x) => x.short_code === form.plu.trim()) : undefined;

  if (notFound) {
    return (
      <Page title="Tovar topilmadi" back={() => nav('/products')}>
        <EmptyState icon="fa-box-open" title="Bu tovar o'chirilgan yoki mavjud emas"
                    action={<Button onClick={() => nav('/products')}>Omborga qaytish</Button>} />
      </Page>
    );
  }
  if (!p) {
    return (
      <Page title="Tovar" back={() => nav('/products')}>
        {ready && !fresh && !navigator.onLine
          ? <EmptyState icon="fa-wifi" title="Internet yo'q" text="Bu tovar qurilma xotirasida topilmadi" />
          : <div className="pd-layout"><Skeleton height={160} radius={18} /><Skeleton height={320} radius={18} /></div>}
      </Page>
    );
  }

  const unit = UNIT_SHORT[p.unit_type] ?? p.unit_type;
  const low = isLow(p);

  const afterChange = (np?: Product) => {
    if (np) setFresh(np); else loadFresh();
    refresh();
    loadHist();
  };

  const receive = async () => {
    const q = parseNum(inQty), price = parseNum(inPrice || '0'), pout = parseNum(inPriceOut || '0');
    if (!(q > 0)) { toast.show('Kelgan miqdorni yozing', 'error'); document.querySelector<HTMLInputElement>('.pd-receive input')?.focus(); return; }
    if (Number.isNaN(price) || price < 0) { toast.show("Kelish narxi noto'g'ri", 'error'); return; }
    if (!paid && !supplier) { toast.show("Qarzga olingan bo'lsa, ta'minotchini tanlang", 'error'); return; }
    if (pout > 0 && price > pout) {
      const ok = await confirm({ title: 'Kelish narxi sotuvdan qimmat', message: `Kelish ${money(price)}, sotuv ${money(pout)}. Zararga sotiladi. Davom etilsinmi?`, confirmText: 'Ha, davom etish', danger: true });
      if (!ok) return;
    }
    setInBusy(true);
    try {
      const r = await api<{ new_quantity: number }>('/api/products/supply_batches', 'POST', {
        product_id: p.id, quantity_received: q, supply_price: price,
        price_out: admin && pout > 0 ? pout : null, supplier_id: supplier, is_paid: supplier ? paid : true,
      });
      toast.show(`+${fmtQty(q)} ${unit} qabul qilindi. Omborda: ${fmtQty(r.new_quantity)} ${unit}`, 'success');
      setInQty(''); setInKey((k) => k + 1); setPaid(true);
      afterChange();
    } catch (e) { toast.show(e instanceof ApiError ? e.message : 'Saqlanmadi', 'error'); }
    finally { setInBusy(false); }
  };

  const save = async () => {
    const e: Record<string, string> = {};
    const pin = parseNum(form.pin || '0'), pout = parseNum(form.pout), min = parseNum(form.min || '0');
    if (!form.name.trim()) e.name = 'Nomini yozing';
    if (!(pout > 0)) e.pout = 'Sotuv narxini kiriting';
    if (Number.isNaN(pin) || pin < 0) e.pin = "Noto'g'ri";
    if (Number.isNaN(min) || min < 0) e.min = "Noto'g'ri";
    if (bcOwner) e.barcode = `Band: ${bcOwner.name}`;
    if (pluOwner) e.plu = `Band: ${pluOwner.name}`;
    setFormErr(e);
    if (Object.keys(e).length) { toast.show(Object.values(e)[0], 'error'); return; }
    const body: Record<string, unknown> = {
      name: form.name.trim(), barcode: form.barcode.trim() || null, short_code: form.plu.trim() || null,
      category_id: form.cat, unit_type: form.unit,
    };
    if (admin) Object.assign(body, { price_in: pin, price_out: pout, min_stock_limit: min });
    setSaving(true);
    try {
      const np = await api<Product>(`/api/products/${p.id}`, 'PUT', body);
      toast.show("O'zgarishlar saqlandi", 'success');
      afterChange(np);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Saqlanmadi';
      if (/shtrix|barcode/i.test(msg)) setFormErr({ barcode: msg });
      else if (/PLU/i.test(msg)) setFormErr({ plu: msg });
      toast.show(msg, 'error');
    } finally { setSaving(false); }
  };

  const remove = async () => {
    const ok = await confirm({
      title: "Tovarni o'chirish",
      message: `"${p.name}" ombordan o'chiriladi. Sotuv tarixi va hisobotlarda saqlanib qoladi.`,
      confirmText: "O'chirish", danger: true,
    });
    if (!ok) return;
    try {
      await api(`/api/products/${p.id}`, 'DELETE');
      toast.show(`"${p.name}" o'chirildi`, 'success');
      await refresh();
      nav('/products', { replace: true });
    } catch (e) { toast.show(e instanceof ApiError ? e.message : "O'chirib bo'lmadi", 'error'); }
  };

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setFormErr((x) => ({ ...x, [k]: '' }));
  };

  return (
    <Page title={p.name} back={() => nav('/products')}
          sub={<>{categoryOf(p)}{p.barcode && <> · <span className="pf-mono">{p.barcode}</span></>}{p.short_code && <> · PLU {p.short_code}</>}</>}
          actions={admin ? <IconButton icon="fa-trash-can" label="Tovarni o'chirish" className="inv-danger-icon" onClick={remove} /> : undefined}>
      <div className="pd-stats">
        <div className={`pd-stat pd-stat--stock${low ? ' is-low' : ''}`}>
          <span>Omborda</span><b>{fmtQty(p.quantity)} <small>{unit}</small></b>
          {low && <em>{p.quantity <= 0 ? 'Tugagan' : 'Kam qoldi'}</em>}
        </div>
        <div className="pd-stat"><span>Sotuv narxi</span><b className="tone-primary">{money(p.price_out)}</b></div>
        <div className="pd-stat"><span>Kelish narxi</span><b>{money(p.price_in)}</b></div>
        <div className="pd-stat"><span>"Kam qoldi" chegarasi</span><b>{fmtQty(p.min_stock_limit ?? 0)} <small>{unit}</small></b></div>
      </div>

      <div className="pd-layout">
        <div className="pd-col">
          {/* KIRIM */}
          <form className="pf-card pd-receive" onSubmit={(e) => { e.preventDefault(); receive(); }} noValidate>
            <div className="pf-card__head"><span><i className="fa-solid fa-truck-ramp-box" aria-hidden="true" /> Tovar qabul qilish (kirim)</span></div>
            <QtyInput key={`${p.id}-${inKey}`} label={`Kelgan miqdor (${unit})`} value={inQty} onValue={setInQty} unit={p.unit_type} />
            <div className="pf-grid2">
              <NumField label="Kelish narxi (1 ta)" isMoney placeholder="0" value={inPrice} onValue={setInPrice} />
              <NumField label="Sotuv narxi" isMoney value={inPriceOut} onValue={setInPriceOut} disabled={!admin}
                        hint={!admin ? "Narxni faqat admin o'zgartiradi" : undefined} />
            </div>
            {parseNum(inQty) > 0 && parseNum(inPrice) > 0 && (
              <div className="pd-sum">Jami: <b>{money(parseNum(inQty) * parseNum(inPrice))}</b></div>
            )}
            {suppliers.length > 0 && (
              <div className="pf-grid2">
                <div className="ui-field">
                  <label className="ui-field__label" htmlFor="pd-sup">Ta'minotchi</label>
                  <select id="pd-sup" className="ui-input" value={supplier ?? ''}
                          onChange={(e) => { const v = e.target.value ? Number(e.target.value) : null; setSupplier(v); if (!v) setPaid(true); }}>
                    <option value="">— Tanlanmagan —</option>
                    {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                {supplier && (
                  <div className="ui-field">
                    <span className="ui-field__label">To'lov</span>
                    <div className="pf-seg" role="radiogroup" aria-label="To'lov">
                      <button type="button" role="radio" aria-checked={paid} onClick={() => setPaid(true)}>To'landi</button>
                      <button type="button" role="radio" aria-checked={!paid} onClick={() => setPaid(false)}>Qarzga</button>
                    </div>
                  </div>
                )}
              </div>
            )}
            <Button type="submit" size="lg" block variant="success" icon="fa-plus" loading={inBusy}>Kirim qilish</Button>
          </form>

          {/* TARIX */}
          <section className="pf-card">
            <div className="pf-card__head"><span>Oxirgi kirimlar</span></div>
            {hist === null ? <Skeleton height={60} radius={12} /> : !hist.length ? (
              <p className="pf-help">Hali kirim bo'lmagan</p>
            ) : (
              <ul className="pd-hist">
                {hist.map((h) => {
                  const t = SUPPLY_TYPE[h.supply_type ?? ''] ?? SUPPLY_TYPE.restock;
                  return (
                    <li key={h.id}>
                      <div>
                        <b>+{fmtQty(h.quantity_received)} {unit}</b> × {money(h.supply_price)}
                        <small>{dateTime(h.created_at)}{h.employee_name && ` · ${h.employee_name}`}{h.supplier_name && ` · ${h.supplier_name}`}</small>
                      </div>
                      <div className="pd-hist__r">
                        <Badge tone={t.tone}>{t.label}</Badge>
                        {!h.is_paid && <Badge tone="red">Qarzga</Badge>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        <div className="pd-col">
          {/* MA'LUMOTLAR */}
          <form className="pf-card" onSubmit={(e) => { e.preventDefault(); save(); }} noValidate>
            <div className="pf-card__head"><span><i className="fa-solid fa-pen" aria-hidden="true" /> Ma'lumotlar</span></div>
            <Field label="Nomi" required value={form.name} error={formErr.name} onChange={(e) => set('name', e.target.value)} maxLength={120} />
            <BarcodeField value={form.barcode} onChange={(v) => set('barcode', v)}
                          error={formErr.barcode || (bcOwner ? `Band: ${bcOwner.name}` : null)} />
            <div className="pf-grid2">
              <NumField label="PLU kod" decimals={false} placeholder="Yo'q" value={form.plu} onValue={(v) => set('plu', v)}
                        error={formErr.plu || (pluOwner ? `Band: ${pluOwner.name}` : null)} maxLength={6} />
              <CategorySelect value={form.cat} onChange={(v) => set('cat', v)} categories={categories} onCreated={reloadCats} />
            </div>
            <UnitPills value={form.unit} onChange={(u) => set('unit', u)} />
            <div className="pf-grid2">
              <NumField label="Kelish narxi" isMoney value={form.pin} onValue={(v) => set('pin', v)} error={formErr.pin} disabled={!admin} />
              <NumField label="Sotuv narxi" required isMoney value={form.pout} onValue={(v) => set('pout', v)} error={formErr.pout} disabled={!admin} />
            </div>
            {admin && <Margin priceIn={form.pin} priceOut={form.pout} />}
            <NumField label={`"Kam qoldi" chegarasi (${UNIT_SHORT[form.unit]})`} value={form.min} onValue={(v) => set('min', v)}
                      error={formErr.min} disabled={!admin} hint={!admin ? "Narx va chegarani faqat admin o'zgartiradi" : undefined} />
            <div className="pd-formbtns">
              {dirty && <Button variant="ghost" onClick={() => { if (base) setForm(base); setFormErr({}); }}>Bekor qilish</Button>}
              <Button type="submit" icon="fa-check" loading={saving} disabled={!dirty}>Saqlash</Button>
            </div>
          </form>

          {admin && (
            <section className="pf-card">
              <div className="pf-card__head"><span><i className="fa-solid fa-clipboard-check" aria-hidden="true" /> Qoldiqni tuzatish</span></div>
              <p className="pf-help">Sanoqda qoldiq boshqacha chiqsa yoki tovar buzilgan/yo'qolgan bo'lsa. Har bir tuzatish tarixda saqlanadi.</p>
              <Button variant="outline" icon="fa-scale-unbalanced" onClick={() => setAdjOpen(true)}>Qoldiqni tuzatish</Button>
            </section>
          )}
        </div>
      </div>

      <AdjustModal open={adjOpen} onClose={() => setAdjOpen(false)} product={p} onDone={() => afterChange()} />
    </Page>
  );
}

function AdjustModal({ open, onClose, product, onDone }: { open: boolean; onClose: () => void; product: Product; onDone: () => void }) {
  const toast = useToast();
  const [val, setVal] = useState('');
  const [reason, setReason] = useState(ADJUST_REASONS[0].value);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setVal(''); setReason(ADJUST_REASONS[0].value); setNotes(''); } }, [open]);

  const unit = UNIT_SHORT[product.unit_type] ?? product.unit_type;
  const n = parseNum(val);
  const diff = Number.isFinite(n) ? Math.round((n - product.quantity) * 1000) / 1000 : NaN;

  const submit = async () => {
    if (!(n >= 0)) { toast.show('Haqiqiy qoldiqni yozing', 'error'); return; }
    if (diff === 0) { toast.show("Qoldiq o'zgarmadi", 'info'); onClose(); return; }
    setBusy(true);
    try {
      const qs = new URLSearchParams({ new_quantity: String(n), reason });
      if (notes.trim()) qs.set('notes', notes.trim());
      await api(`/api/products/${product.id}/adjust-stock?${qs}`, 'POST');
      toast.show(`Qoldiq tuzatildi: ${fmtQty(product.quantity)} → ${fmtQty(n)} ${unit}`, 'success');
      onDone(); onClose();
    } catch (e) { toast.show(e instanceof ApiError ? e.message : 'Saqlanmadi', 'error'); }
    finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Qoldiqni tuzatish"
           footer={<><Button variant="ghost" onClick={onClose}>Bekor</Button><Button icon="fa-check" loading={busy} onClick={submit}>Tasdiqlash</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="pf-form">
        <p className="pf-help">Hozir tizimda: <b>{fmtQty(product.quantity)} {unit}</b></p>
        <NumField label={`Haqiqiy qoldiq (${unit})`} value={val} onValue={setVal} autoFocus className="pf-big"
                  decimals={product.unit_type !== 'dona' && product.unit_type !== 'blok'} />
        {Number.isFinite(diff) && diff !== 0 && (
          <div className={`pd-diff ${diff > 0 ? 'is-plus' : 'is-minus'}`}>
            Farq: <b>{diff > 0 ? '+' : ''}{fmtQty(diff)} {unit}</b>
            {product.price_in > 0 && <> ({diff > 0 ? '+' : '−'}{money(Math.abs(diff) * product.price_in)} kelish narxida)</>}
          </div>
        )}
        <div className="ui-field">
          <label className="ui-field__label" htmlFor="adj-reason">Sabab</label>
          <select id="adj-reason" className="ui-input" value={reason} onChange={(e) => setReason(e.target.value)}>
            {ADJUST_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
        <Field label="Izoh" placeholder="Ixtiyoriy" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={200} />
      </form>
    </Modal>
  );
}
