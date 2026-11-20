import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { isAdmin } from '@/lib/auth';
import { dateTime, money, parseNum } from '@/lib/format';
import { UNITS, type Product, type Unit } from '@/lib/products';
import { useProducts } from '@/lib/useProducts';
import { Badge, Button, EmptyState, IconButton, Modal, Page, Skeleton, Tabs, useToast, Field, NumField, Select } from '@/components/ui';
import './products.css';
import './ai.css';

interface Scanned { name: string; barcode: string | null; quantity: number; unit_type: string; price_in: number | null; price_out: number | null; category_name: string | null; confidence: number }
interface ScanResp { products: Scanned[]; total_found: number; scan_id: number | null; error_message?: string | null }
interface Row { key: number; name: string; barcode: string; qty: string; unit: Unit; pin: string; pout: string; cat: string; conf: number; matchId: number | null; unlinked: boolean }
interface HistRow { id: number; products_found: number; products_added: number; status: string; created_at: string | null }

const STORE_KEY = 'ai_scan_draft_v2';
let rk = 0;

/** O'xshashlik 0..1 (Levenshtein) */
function sim(a: string, b: string) {
  a = a.toLowerCase().trim(); b = b.toLowerCase().trim();
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.85;
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] : 1 + Math.min(prev[j], cur[j - 1], prev[j - 1]);
    prev = cur;
  }
  return 1 - prev[n] / Math.max(m, n);
}
function findMatch(r: { name: string; barcode: string }, list: Product[]): Product | null {
  if (r.barcode) { const b = list.find((p) => p.barcode === r.barcode.trim()); if (b) return b; }
  let best: Product | null = null, bs = 0;
  for (const p of list) { const s = sim(r.name, p.name); if (s > bs) { bs = s; best = p; } }
  return bs >= 0.72 ? best : null;
}
const asUnit = (u: string): Unit => (UNITS.some((x) => x.value === u) ? (u as Unit) : 'dona');
const str = (v: number | null | undefined) => (v ? String(v) : '');

type Filter = 'all' | 'noprice' | 'existing';

export function AiScanPage() {
  const nav = useNavigate();
  const toast = useToast();
  const admin = isAdmin();
  const { products, refresh } = useProducts();
  const [rows, setRows] = useState<Row[] | null>(() => {
    try {
      const saved: Row[] | null = JSON.parse(sessionStorage.getItem(STORE_KEY) || 'null');
      // Qator kalitlari takrorlanmasin (aks holda bitta qatorni o'chirish boshqasini ham o'chiradi)
      if (saved) rk = Math.max(rk, ...saved.map((r) => r.key));
      return saved;
    } catch { return null; }
  });
  const [scanId, setScanId] = useState<number | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hint, setHint] = useState(0);
  const [filter, setFilter] = useState<Filter>('all');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<{ n: number; s: number; errs: string[] } | null>(null);
  const [hist, setHist] = useState<HistRow[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);

  useEffect(() => { api<HistRow[]>('/api/ai/scan/history?limit=5').then(setHist).catch(() => setHist([])); }, []);
  useEffect(() => { try { if (rows) sessionStorage.setItem(STORE_KEY, JSON.stringify(rows)); else sessionStorage.removeItem(STORE_KEY); } catch { /* yopiq */ } }, [rows]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setHint((h) => h + 1), 2200);
    return () => clearInterval(t);
  }, [busy]);
  // Ombor ro'yxati keyin kelsa — mos tovarlarni qayta topish
  useEffect(() => {
    if (!rows || !products.length) return;
    setRows((rs) => rs && rs.map((r) => (r.unlinked || r.matchId ? r : { ...r, matchId: findMatch(r, products)?.id ?? null })));
  }, [products.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (f: File | undefined) => {
    if (!f) return;
    const img = /^image\/(jpeg|png|webp)$/.test(f.type), xls = /\.xlsx?$/i.test(f.name);
    if (!img && !xls) { setErr('Faqat rasm (JPG, PNG, WEBP) yoki Excel (.xlsx)'); return; }
    if (f.size > 10 * 1024 * 1024) { setErr("Fayl 10 MB dan kichik bo'lsin"); return; }
    if (preview) URL.revokeObjectURL(preview);
    setErr(null); setFile(f); setPreview(img ? URL.createObjectURL(f) : null);
  };

  const analyze = async () => {
    if (!file) return;
    setBusy(true); setErr(null); setHint(0);
    try {
      const fd = new FormData(); fd.append('file', file);
      const r = await api<ScanResp>(/\.xlsx?$/i.test(file.name) ? '/api/ai/scan-excel' : '/api/ai/scan', 'POST', fd);
      if (!r.products?.length) { setErr(r.error_message || "Hech qanday tovar topilmadi. Rasm aniqroq bo'lsin yoki namuna jadvaldan foydalaning."); return; }
      setScanId(r.scan_id ?? null);
      setRows(r.products.map((p) => {
        const row: Row = { key: ++rk, name: (p.name || '').trim(), barcode: p.barcode ?? '', qty: str(p.quantity), unit: asUnit(p.unit_type), pin: str(p.price_in), pout: str(p.price_out), cat: p.category_name ?? '', conf: p.confidence ?? 1, matchId: null, unlinked: false };
        row.matchId = findMatch(row, products)?.id ?? null;
        return row;
      }));
      setFile(null); setPreview(null);
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Tahlil qilinmadi'); }
    finally { setBusy(false); }
  };

  const set = (key: number, patch: Partial<Row>) => setRows((rs) => rs && rs.map((r) => {
    if (r.key !== key) return r;
    const n = { ...r, ...patch };
    if (('name' in patch || 'barcode' in patch) && !n.unlinked) n.matchId = findMatch(n, products)?.id ?? null;
    return n;
  }));

  const list = rows ?? [];
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const isNew = (r: Row) => !(r.matchId && !r.unlinked);
  const noPrice = (r: Row) => isNew(r) && !(parseNum(r.pout) > 0);
  const shown = list.filter((r) => filter === 'all' || (filter === 'noprice' ? noPrice(r) : !isNew(r)));
  const nNew = list.filter((r) => isNew(r) && r.name.trim()).length, nStock = list.length - nNew;
  const nNoPrice = list.filter(noPrice).length;

  const save = async () => {
    const act = list.filter((r) => r.name.trim());
    if (!act.length) { toast.show("Ro'yxat bo'sh", 'error'); return; }
    if (nNoPrice) { setFilter('noprice'); toast.show(`${nNoPrice} ta yangi tovarda sotuv narxi yo'q`, 'error'); return; }
    setSaving(true);
    try {
      const r = await api<{ added_new: number; added_stock: number; errors: string[] }>('/api/ai/confirm', 'POST', {
        scan_id: scanId,
        products: act.map((x) => ({
          name: x.name.trim(), barcode: x.barcode.trim() || null, quantity: parseNum(x.qty) || 0, unit_type: x.unit,
          price_in: parseNum(x.pin) || null, price_out: parseNum(x.pout) || null, category_name: x.cat.trim() || null,
          existing_product_id: isNew(x) ? null : x.matchId,
        })),
      });
      setDone({ n: r.added_new, s: r.added_stock, errs: r.errors ?? [] });
      setRows(null); refresh();
    } catch (e) { toast.show(e instanceof ApiError ? e.message : 'Saqlanmadi', 'error'); }
    finally { setSaving(false); }
  };

  const HINTS = ['Rasm o\'qilmoqda…', 'Tovar nomlari aniqlanmoqda…', 'Narxlar va miqdorlar ajratilmoqda…', 'Ombordagi tovarlar bilan solishtirilmoqda…'];

  return (
    <Page title="AI orqali qo'shish" sub={rows ? `${list.length} ta tovar topildi` : 'Rasm yoki Excel'} back={() => (rows ? setRows(null) : nav('/products'))}>
      {!rows ? (
        <div className="ai-layout">
          <section className="pf-card">
            <div className="pf-card__head"><span><i className="fa-solid fa-wand-magic-sparkles" aria-hidden="true" /> Faktura, nakladnoy yoki ro'yxat rasmi</span></div>
            <p className="pf-help">Ta'minotchi bergan hujjatni suratga oling — AI tovar nomi, miqdori va narxini o'qiydi. Saqlashdan oldin hammasini tekshirasiz.</p>
            <input ref={fileRef} type="file" className="sr-only" id="ai-file" accept="image/jpeg,image/png,image/webp,.xlsx,.xls" onChange={(e) => pick(e.target.files?.[0])} />
            <input ref={camRef} type="file" className="sr-only" accept="image/*" capture="environment" onChange={(e) => pick(e.target.files?.[0])} aria-label="Kamera" />
            {file ? (
              <div className="ai-file">
                {preview ? <img src={preview} alt="Tanlangan rasm" /> : <div className="ai-file__xls"><i className="fa-solid fa-file-excel" aria-hidden="true" /></div>}
                <div className="ai-file__meta"><b>{file.name}</b><small>{(file.size / 1024).toFixed(0)} KB</small></div>
                <IconButton icon="fa-xmark" label="Boshqa fayl" onClick={() => { setFile(null); setPreview(null); }} />
              </div>
            ) : (
              <div className="ai-pick">
                <button type="button" className="ai-pick__btn ai-pick__btn--cam" onClick={() => camRef.current?.click()}><i className="fa-solid fa-camera" aria-hidden="true" /><b>Suratga olish</b><small>Telefon kamerasi</small></button>
                <label htmlFor="ai-file" className="ai-pick__btn"><i className="fa-solid fa-file-arrow-up" aria-hidden="true" /><b>Fayl tanlash</b><small>Rasm yoki Excel (.xlsx)</small></label>
              </div>
            )}
            {err && <div className="au-err" role="alert">{err}</div>}
            {busy ? (
              <div className="ai-busy" role="status"><span className="ui-spinner" aria-hidden="true" /> {HINTS[hint % HINTS.length]}</div>
            ) : (
              <Button size="lg" block icon="fa-wand-magic-sparkles" disabled={!file} onClick={analyze}>Tahlil qilish</Button>
            )}
          </section>
          <aside className="ai-aside">
            <section className="pf-card">
              <div className="pf-card__head"><span>Excel namuna</span></div>
              <p className="pf-help">Ko'p tovarni bir yo'la kiritish uchun: namunani yuklab oling, to'ldiring va shu yerga yuklang. Ustunlar: №, Nomi, Shtrix-kod, Miqdor, Kelish narxi, Sotuv narxi.</p>
              <a className="ui-btn ui-btn--outline" href="/static/shablon/novapos_mahsulot.xlsx" download><i className="fa-solid fa-file-excel" aria-hidden="true" /> Namunani yuklab olish</a>
            </section>
            <section className="pf-card">
              <div className="pf-card__head"><span>Oxirgi skanlar</span></div>
              {hist === null ? <Skeleton height={60} radius={12} /> : !hist.length ? <p className="pf-help">Hali skan qilinmagan</p> : (
                <ul className="ai-hist">
                  {hist.map((h) => (
                    <li key={h.id}><i className={`fa-solid ${h.status === 'error' ? 'fa-circle-xmark tone-danger' : 'fa-circle-check tone-success'}`} aria-hidden="true" />
                      <span><b>{h.products_found} topildi, {h.products_added} qo'shildi</b><small>{dateTime(h.created_at)}</small></span></li>
                  ))}
                </ul>
              )}
            </section>
          </aside>
        </div>
      ) : (
        <div className="ai-review">
          <div className="ai-sum">
            <span><b>{nNew}</b> yangi tovar</span>
            <span><b>{nStock}</b> omborga qo'shiladi</span>
            {nNoPrice > 0 && <span className="tone-danger"><b>{nNoPrice}</b> narxsiz</span>}
          </div>
          <Tabs label="Filtr" value={filter} onChange={setFilter}
                items={[{ value: 'all', label: 'Hammasi', count: list.length }, { value: 'noprice', label: 'Narxsiz', count: nNoPrice }, { value: 'existing', label: 'Omborda bor', count: nStock }]} />
          {!shown.length ? <EmptyState icon="fa-check" title="Bu yerda hech narsa yo'q" /> : (
            <ol className="ai-rows">
              {shown.map((r) => {
                const m = r.matchId && !r.unlinked ? byId.get(r.matchId) : null;
                return (
                  <li key={r.key} className={`pf-card ai-row${noPrice(r) ? ' has-error' : ''}`}>
                    <div className="ai-row__head">
                      {r.conf < 0.85 && <Badge tone={r.conf < 0.6 ? 'red' : 'amber'}>AI {Math.round(r.conf * 100)}% ishonch</Badge>}
                      {m ? (
                        <span className="ai-match"><i className="fa-solid fa-link" aria-hidden="true" /> Omborda bor: <b>{m.name}</b> — miqdori qo'shiladi
                          <button type="button" onClick={() => set(r.key, { unlinked: true })}>Yangi tovar qilish</button></span>
                      ) : r.unlinked && r.matchId ? (
                        <span className="ai-match ai-match--off">Yangi tovar sifatida <button type="button" onClick={() => set(r.key, { unlinked: false })}>Ombordagiga qo'shish</button></span>
                      ) : <Badge tone="blue">Yangi</Badge>}
                      <IconButton icon="fa-trash-can" label={`${r.name || 'Qator'} — olib tashlash`} className="inv-danger-icon ai-row__del"
                                  onClick={() => setRows((rs) => rs && rs.filter((x) => x.key !== r.key))} />
                    </div>
                    <div className="ai-grid">
                      <div className="ai-f--name"><Field label="Nomi" value={r.name} onChange={(e) => set(r.key, { name: e.target.value })} /></div>
                      <Field label="Shtrix-kod" className="pf-mono" inputMode="numeric" value={r.barcode} onChange={(e) => set(r.key, { barcode: e.target.value.replace(/\s/g, '') })} />
                      <NumField label="Miqdor" value={r.qty} onValue={(v) => set(r.key, { qty: v })} />
                      <Select label="Birlik" size="sm" value={r.unit} onChange={(v) => set(r.key, { unit: v ?? 'dona' })} options={UNITS} />
                      <NumField label="Kelish narxi" hint="" value={r.pin} onValue={(v) => set(r.key, { pin: v })} placeholder={m ? money(m.price_in, false) : '0'} />
                      <NumField label="Sotuv narxi" hint="" required={isNew(r)} value={r.pout} error={noPrice(r) ? "Narx yo'q" : null}
                                disabled={!!m && !admin} onValue={(v) => set(r.key, { pout: v })} placeholder={m ? money(m.price_out, false) : 'Majburiy'} />
                      {isNew(r) && <Field label="Kategoriya" value={r.cat} onChange={(e) => set(r.key, { cat: e.target.value })} placeholder="Ixtiyoriy" />}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
          <Button variant="ghost" icon="fa-plus" onClick={() => setRows((rs) => [...(rs ?? []), { key: ++rk, name: '', barcode: '', qty: '', unit: 'dona', pin: '', pout: '', cat: '', conf: 1, matchId: null, unlinked: false }])}>Qator qo'shish</Button>
          <div className="pf-savebar">
            <Button size="lg" block variant="success" icon="fa-check-double" loading={saving} onClick={save}>Omborga saqlash ({list.length})</Button>
          </div>
        </div>
      )}

      <Modal open={!!done} onClose={() => nav('/products')} title="Saqlandi"
             footer={<><Button variant="ghost" onClick={() => setDone(null)}>Yana skan qilish</Button><Link to="/products" className="ui-btn ui-btn--primary">Omborga o'tish</Link></>}>
        {done && (
          <div className="ai-done">
            <i className="fa-solid fa-circle-check" aria-hidden="true" />
            <p>{done.n > 0 && <><b>{done.n}</b> ta yangi tovar qo'shildi. </>}{done.s > 0 && <><b>{done.s}</b> ta tovarning qoldig'i oshirildi.</>}</p>
            {done.errs.length > 0 && <ul className="ai-errs">{done.errs.map((e) => <li key={e}>{e}</li>)}</ul>}
          </div>
        )}
      </Modal>
    </Page>
  );
}
