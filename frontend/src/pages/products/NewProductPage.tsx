import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { parseNum, qty as fmtQty } from '@/lib/format';
import { UNIT_SHORT, type Product, type Unit } from '@/lib/products';
import { useProducts } from '@/lib/useProducts';
import { useScanner } from '@/lib/useScanner';
import { Button, Field, IconButton, Page, Tabs, useToast } from '@/components/ui';
import { currentLimits } from './LimitsPanel';
import { useCategories } from './data';
import { BarcodeField, CategorySelect, Margin, NumField, QtyInput, UnitPills } from './fields';
import './products.css';

type Mode = 'single' | 'group';

interface Variant { key: number; suffix: string; barcode: string; plu: string; qty: string; priceIn: string; priceOut: string; error?: string }
let vkey = 0;
const emptyVariant = (): Variant => ({ key: ++vkey, suffix: '', barcode: '', plu: '', qty: '', priceIn: '', priceOut: '' });

/** Kod band emasligini mahalliy ro'yxatdan tekshirish (server ham tekshiradi) */
function useCodeCheck(products: Product[]) {
  return useCallback((field: 'barcode' | 'short_code', code: string): Product | undefined => {
    const c = code.trim();
    return c ? products.find((p) => p[field] === c) : undefined;
  }, [products]);
}

export function NewProductPage() {
  const nav = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const { products, refresh } = useProducts();
  const { categories, reload: reloadCats } = useCategories();
  const taken = useCodeCheck(products);
  const limits = useMemo(() => currentLimits(products), [products]);

  const [mode, setMode] = useState<Mode>('single');
  const [recent, setRecent] = useState<{ id: number; name: string; qty: number; unit: Unit }[]>([]);

  // ── Bitta tovar ──
  const [barcode, setBarcode] = useState(params.get('barcode') ?? '');
  const [name, setName] = useState('');
  const [plu, setPlu] = useState('');
  const [catId, setCatId] = useState<number | null>(null);
  const [unit, setUnit] = useState<Unit>('dona');
  const [qty, setQty] = useState('');
  const [priceIn, setPriceIn] = useState('');
  const [priceOut, setPriceOut] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [qtyKey, setQtyKey] = useState(0);   // QtyInput holatini (blok) tozalash uchun
  const nameRef = useRef<HTMLInputElement>(null);

  // ── To'plam ──
  const [gName, setGName] = useState('');
  const [gCat, setGCat] = useState<number | null>(null);
  const [gUnit, setGUnit] = useState<Unit>('dona');
  const [gIn, setGIn] = useState('');
  const [gOut, setGOut] = useState('');
  const [variants, setVariants] = useState<Variant[]>(() => [emptyVariant(), emptyVariant()]);
  const [gSaving, setGSaving] = useState(false);

  const barcodeOwner = taken('barcode', barcode);
  const pluOwner = taken('short_code', plu);

  // Skaner: omborda bor tovar — darhol uning kirim sahifasiga; yangi — shtrix-kod maydoniga
  const onScan = useCallback((code: string) => {
    const p = products.find((x) => x.barcode === code || x.short_code === code);
    if (p) {
      toast.show(`"${p.name}" omborda bor — kirim qiling`, 'info');
      nav(`/products/${p.id}`);
      return;
    }
    if (mode === 'single') {
      setBarcode(code);
      setTimeout(() => nameRef.current?.focus(), 0);
    } else {
      setVariants((vs) => {
        const i = vs.findIndex((v) => !v.barcode);
        if (i < 0) return [...vs, { ...emptyVariant(), barcode: code }];
        return vs.map((v, j) => (j === i ? { ...v, barcode: code } : v));
      });
    }
  }, [products, mode, nav, toast]);
  useScanner(onScan);

  useEffect(() => { if (params.get('barcode')) nameRef.current?.focus(); }, [params]);

  const minFor = (u: Unit) => limits[u] ?? 2;

  const resetSingle = () => {
    setBarcode(''); setName(''); setPlu(''); setQty(''); setPriceIn(''); setPriceOut(''); setErrors({});
    setQtyKey((k) => k + 1);
  };

  const saveSingle = async () => {
    const e: Record<string, string> = {};
    const pOut = parseNum(priceOut), pIn = parseNum(priceIn || '0'), q = parseNum(qty || '0');
    if (!name.trim()) e.name = 'Tovar nomini yozing';
    if (!(pOut > 0)) e.priceOut = 'Sotuv narxini kiriting';
    if (Number.isNaN(pIn) || pIn < 0) e.priceIn = "Narx noto'g'ri";
    if (Number.isNaN(q) || q < 0) e.qty = "Miqdor noto'g'ri";
    if (barcodeOwner) e.barcode = `Band: ${barcodeOwner.name}`;
    if (pluOwner) e.plu = `Band: ${pluOwner.name}`;
    setErrors(e);
    if (Object.keys(e).length) {
      toast.show(Object.values(e)[0], 'error');
      return;
    }
    setSaving(true);
    try {
      const p = await api<Product>('/api/products/', 'POST', {
        name: name.trim(), barcode: barcode.trim() || null, short_code: plu.trim() || null,
        category_id: catId, unit_type: unit, price_in: pIn, price_out: pOut, quantity: q,
        min_stock_limit: minFor(unit),
      });
      toast.show(`"${p.name}" qo'shildi`, 'success');
      setRecent((r) => [{ id: p.id, name: p.name, qty: p.quantity, unit: p.unit_type }, ...r].slice(0, 8));
      resetSingle();
      refresh();
      // Keyingi tovar: skaner yoki nom
      setTimeout(() => (document.querySelector<HTMLInputElement>('.pf-form input'))?.focus(), 0);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Saqlanmadi';
      if (/shtrix|barcode/i.test(msg)) setErrors({ barcode: msg });
      else if (/PLU/i.test(msg)) setErrors({ plu: msg });
      toast.show(msg, 'error');
    } finally { setSaving(false); }
  };

  const setV = (key: number, patch: Partial<Variant>) => setVariants((vs) => vs.map((v) => (v.key === key ? { ...v, ...patch, error: undefined } : v)));

  const saveGroup = async () => {
    if (!gName.trim()) { toast.show('Umumiy nomni yozing', 'error'); return; }
    const rows = variants.filter((v) => v.suffix.trim() || v.barcode.trim() || v.priceOut.trim() || v.qty.trim());
    if (!rows.length) { toast.show("Kamida bitta variant yozing", 'error'); return; }
    setGSaving(true);
    let ok = 0;
    const left: Variant[] = [];
    const seen = new Set<string>();
    for (const v of rows) {
      const pOut = parseNum(v.priceOut || gOut), pIn = parseNum(v.priceIn || gIn || '0'), q = parseNum(v.qty || '0');
      const fail = (error: string) => left.push({ ...v, error });
      if (!(pOut > 0)) { fail('Sotuv narxi yo\'q'); continue; }
      if (Number.isNaN(pIn) || Number.isNaN(q)) { fail("Son noto'g'ri"); continue; }
      const bc = v.barcode.trim(), sc = v.plu.trim();
      const own = taken('barcode', bc) ?? (sc ? taken('short_code', sc) : undefined);
      if (own) { fail(`Kod band: ${own.name}`); continue; }
      if ((bc && seen.has('b' + bc)) || (sc && seen.has('s' + sc))) { fail('Kod takrorlangan'); continue; }
      try {
        const p = await api<Product>('/api/products/', 'POST', {
          name: `${gName.trim()} ${v.suffix.trim()}`.trim(), barcode: bc || null, short_code: sc || null,
          category_id: gCat, unit_type: gUnit, price_in: pIn, price_out: pOut, quantity: q, min_stock_limit: minFor(gUnit),
        });
        if (bc) seen.add('b' + bc);
        if (sc) seen.add('s' + sc);
        ok++;
        setRecent((r) => [{ id: p.id, name: p.name, qty: p.quantity, unit: p.unit_type }, ...r].slice(0, 8));
      } catch (err) {
        fail(err instanceof ApiError ? err.message : 'Saqlanmadi');
      }
    }
    setGSaving(false);
    refresh();
    // Saqlanganlar ro'yxatdan olib tashlanadi — qayta bosilganda ikki marta qo'shilmaydi
    setVariants(left.length ? left : [emptyVariant(), emptyVariant()]);
    if (ok && !left.length) { toast.show(`${ok} ta tovar qo'shildi`, 'success'); setGName(''); }
    else if (ok) toast.show(`${ok} ta qo'shildi, ${left.length} tasida xato — qizil qatorlarni tuzating`, 'warning');
    else toast.show('Hech biri saqlanmadi — xatolarni tuzating', 'error');
  };

  const single = (
    <form className="pf-form" onSubmit={(e) => { e.preventDefault(); saveSingle(); }} noValidate>
      <section className="pf-card">
        <BarcodeField value={barcode} onChange={(v) => { setBarcode(v); setErrors((x) => ({ ...x, barcode: '' })); }}
                      error={errors.barcode || (barcodeOwner ? `Bu kod band: ${barcodeOwner.name}` : null)}
                      onScanned={() => nameRef.current?.focus()} autoFocus={!params.get('barcode')} />
        {barcodeOwner && (
          <Link to={`/products/${barcodeOwner.id}`} className="pf-exists">
            <i className="fa-solid fa-arrow-right" aria-hidden="true" /> "{barcodeOwner.name}" omborda bor — unga kirim qilish
          </Link>
        )}
        <Field ref={nameRef} label="Tovar nomi" required placeholder="Masalan: Coca-Cola 1.5L" value={name} error={errors.name}
               onChange={(e) => { setName(e.target.value); setErrors((x) => ({ ...x, name: '' })); }} maxLength={120} />
        <div className="pf-grid2">
          <NumField label="PLU kod" hint="Kassada tez chaqirish uchun (ixtiyoriy)" placeholder="12" decimals={false}
                    value={plu} onValue={(v) => { setPlu(v); setErrors((x) => ({ ...x, plu: '' })); }}
                    error={errors.plu || (pluOwner ? `Band: ${pluOwner.name}` : null)} maxLength={6} />
          <CategorySelect value={catId} onChange={setCatId} categories={categories} onCreated={reloadCats} />
        </div>
      </section>

      <section className="pf-card">
        <div className="pf-card__head"><span>O'lchov birligi</span></div>
        <UnitPills value={unit} onChange={(u) => { setUnit(u); setQty(''); setQtyKey((k) => k + 1); }} />
        <QtyInput key={qtyKey} label={`Boshlang'ich qoldiq (${UNIT_SHORT[unit]})`} value={qty} onValue={setQty} unit={unit} />
        <div className="pf-grid2">
          <NumField label="Kelish narxi" isMoney placeholder="0" value={priceIn} onValue={setPriceIn} error={errors.priceIn} className="pf-price-in" />
          <NumField label="Sotuv narxi" required isMoney placeholder="0" value={priceOut} onValue={(v) => { setPriceOut(v); setErrors((x) => ({ ...x, priceOut: '' })); }}
                    error={errors.priceOut} className="pf-price-out" />
        </div>
        <Margin priceIn={priceIn} priceOut={priceOut} />
      </section>

      <div className="pf-savebar">
        <Button type="submit" size="lg" block icon="fa-check" loading={saving}>Saqlash</Button>
      </div>
    </form>
  );

  const group = (
    <form className="pf-form" onSubmit={(e) => { e.preventDefault(); saveGroup(); }} noValidate>
      <section className="pf-card">
        <p className="pf-help">Bir xil tovarning bir necha turi (o'lcham, ta'm, rang) — masalan "Coca-Cola" + 0.5L, 1L, 1.5L.</p>
        <Field label="Umumiy nom" required placeholder="Masalan: Coca-Cola" value={gName} onChange={(e) => setGName(e.target.value)} maxLength={100} />
        <CategorySelect value={gCat} onChange={setGCat} categories={categories} onCreated={reloadCats} />
        <UnitPills value={gUnit} onChange={setGUnit} />
        <div className="pf-grid2">
          <NumField label="Kelish narxi (hammasiga)" isMoney placeholder="0" value={gIn} onValue={setGIn} />
          <NumField label="Sotuv narxi (hammasiga)" isMoney placeholder="0" value={gOut} onValue={setGOut} />
        </div>
      </section>

      <div className="pf-vhead">
        <span>Turlari</span><span className="ui-badge ui-badge--blue">{variants.length} ta</span>
      </div>
      <ol className="pf-variants">
        {variants.map((v, i) => (
          <li key={v.key} className={`pf-card pf-variant${v.error ? ' has-error' : ''}`}>
            <div className="pf-variant__head">
              <span className="pf-variant__n">{i + 1}</span>
              <span className="pf-variant__title">{gName.trim() || 'Tovar'} {v.suffix.trim()}</span>
              <IconButton icon="fa-xmark" label={`${i + 1}-turni olib tashlash`} className="inv-danger-icon"
                          onClick={() => setVariants((vs) => (vs.length > 1 ? vs.filter((x) => x.key !== v.key) : [emptyVariant()]))} />
            </div>
            {v.error && <div className="pf-variant__err" role="alert">{v.error}</div>}
            <div className="pf-grid2">
              <Field label="Turi" placeholder="0.5L, Katta, Qizil..." value={v.suffix} onChange={(e) => setV(v.key, { suffix: e.target.value })} />
              <Field label="Shtrix-kod" className="pf-mono" inputMode="numeric" placeholder="Ixtiyoriy" value={v.barcode}
                     onChange={(e) => setV(v.key, { barcode: e.target.value.replace(/\s/g, '') })} />
              <NumField label="PLU" decimals={false} placeholder="Ixtiyoriy" value={v.plu} onValue={(x) => setV(v.key, { plu: x })} maxLength={6} />
              <NumField label={`Qoldiq (${UNIT_SHORT[gUnit]})`} decimals={gUnit !== 'dona' && gUnit !== 'blok'} placeholder="0" value={v.qty} onValue={(x) => setV(v.key, { qty: x })} />
              <NumField label="Kelish narxi" isMoney placeholder={gIn || '0'} value={v.priceIn} onValue={(x) => setV(v.key, { priceIn: x })} />
              <NumField label="Sotuv narxi" isMoney placeholder={gOut || '0'} value={v.priceOut} onValue={(x) => setV(v.key, { priceOut: x })} />
            </div>
          </li>
        ))}
      </ol>
      <Button variant="ghost" block icon="fa-plus" onClick={() => setVariants((vs) => [...vs, emptyVariant()])}>Yana tur qo'shish</Button>
      <div className="pf-savebar">
        <Button type="submit" size="lg" block variant="success" icon="fa-check-double" loading={gSaving}>Hammasini saqlash</Button>
      </div>
    </form>
  );

  return (
    <Page title="Yangi tovar" back={() => nav('/products')}
          toolbar={<Tabs label="Qo'shish turi" value={mode} onChange={setMode}
                         items={[{ value: 'single', label: 'Bitta tovar' }, { value: 'group', label: "Turlari bilan (to'plam)" }]} />}>
      <div className="pf-layout">
        <div className="pf-col">{mode === 'single' ? single : group}</div>
        <aside className="pf-aside">
          <section className="pf-card">
            <div className="pf-card__head"><span>Shu yerda qo'shilganlar</span></div>
            {recent.length ? (
              <ul className="pf-recent">
                {recent.map((r) => (
                  <li key={r.id}><Link to={`/products/${r.id}`}><span>{r.name}</span><b>{fmtQty(r.qty)} {UNIT_SHORT[r.unit]}</b></Link></li>
                ))}
              </ul>
            ) : <p className="pf-help">Saqlangan tovarlar shu yerda ko'rinadi. Saqlagandan keyin forma tozalanadi — keyingi tovarni skanerlang.</p>}
          </section>
          <section className="pf-card pf-tips">
            <div className="pf-card__head"><span>Maslahat</span></div>
            <p><i className="fa-solid fa-barcode" aria-hidden="true" /> Skaner bilan kodni o'qing — tovar omborda bo'lsa, uning kirim sahifasi ochiladi.</p>
            <p><i className="fa-solid fa-hashtag" aria-hidden="true" /> <b>PLU</b> — shtrix-kodsiz tovar (non, sabzavot) uchun qisqa raqam. Kassada yozib chaqiriladi.</p>
            <p><i className="fa-solid fa-scale-balanced" aria-hidden="true" /> Kg/litr tovarlar kassada vazn bilan sotiladi.</p>
          </section>
        </aside>
      </div>
    </Page>
  );
}
