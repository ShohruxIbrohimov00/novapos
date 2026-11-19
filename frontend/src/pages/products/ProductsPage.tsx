import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { isAdmin } from '@/lib/auth';
import { money, qty } from '@/lib/format';
import { categoryOf, isLow, NO_CATEGORY, UNIT_SHORT, type Product } from '@/lib/products';
import { useProducts } from '@/lib/useProducts';
import { useScanner } from '@/lib/useScanner';
import { Button, EmptyState, Field, IconButton, Modal, Page, Skeleton } from '@/components/ui';
import { CategoriesModal } from './CategoriesModal';
import { LimitsPanel } from './LimitsPanel';
import { useCategories } from './data';
import './products.css';

const PAGE = 120;   // bir martada chiziladigan kartalar (katta omborda ham tez)
const ALL = '__all', LOW = '__low';

function matches(p: Product, term: string) {
  if (!term) return true;
  return p.name.toLowerCase().includes(term) || p.barcode === term || p.short_code === term
    || (term.length >= 4 && !!p.barcode?.includes(term));
}

export function ProductsPage() {
  const nav = useNavigate();
  const admin = isAdmin();
  const { products, ready, synced, refresh } = useProducts();
  const { categories, reload: reloadCats } = useCategories();
  const [params, setParams] = useSearchParams();
  const filter = params.get('f') ?? ALL;
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [catsOpen, setCatsOpen] = useState(false);
  const [limitsOpen, setLimitsOpen] = useState(false);

  const setFilter = (f: string) => {
    setLimit(PAGE);
    setParams(f === ALL ? {} : { f }, { replace: true });
  };

  // Skaner: tovar bor bo'lsa — uning sahifasi (kirim), yo'q bo'lsa — yangi tovar shu kod bilan
  const onScan = useCallback((code: string) => {
    const p = products.find((x) => x.barcode === code || x.short_code === code);
    nav(p ? `/products/${p.id}` : `/products/new?barcode=${encodeURIComponent(code)}`);
  }, [products, nav]);
  useScanner(onScan);

  const lowList = useMemo(() => products.filter(isLow), [products]);
  const groups = useMemo(() => {
    const m = new Map<string, number>();
    products.forEach((p) => m.set(categoryOf(p), (m.get(categoryOf(p)) ?? 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [products]);
  const catCounts = useMemo(() => {
    const c: Record<number, number> = {};
    products.forEach((p) => { if (p.category_id) c[p.category_id] = (c[p.category_id] ?? 0) + 1; });
    return c;
  }, [products]);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    const base = filter === LOW ? lowList : filter === ALL ? products : products.filter((p) => categoryOf(p) === filter);
    return base.filter((p) => matches(p, term))
      .sort((a, b) => (filter === LOW ? a.quantity - b.quantity : 0) || a.name.localeCompare(b.name));
  }, [products, lowList, filter, q]);

  const value = useMemo(() => products.reduce(
    (s, p) => { const qn = Math.max(0, p.quantity); s.out += qn * p.price_out; s.in += qn * p.price_in; return s; },
    { in: 0, out: 0 }), [products]);

  const filters: { key: string; label: string; count: number; icon: string; danger?: boolean }[] = [
    { key: ALL, label: 'Hammasi', count: products.length, icon: 'fa-border-all' },
    { key: LOW, label: 'Kam qolgan', count: lowList.length, icon: 'fa-triangle-exclamation', danger: true },
    ...groups.map(([name, count]) => ({ key: name, label: name, count, icon: name === NO_CATEGORY ? 'fa-circle-question' : 'fa-tag' })),
  ];
  // Tanlangan kategoriya o'chib ketgan bo'lsa — "Hammasi"
  const activeFilter = filters.some((f) => f.key === filter) ? filter : ALL;

  const exact = q.trim() && shown.length === 0 && /^\d{4,}$/.test(q.trim()) ? q.trim() : null;

  return (
    <Page
      title="Ombor"
      sub={ready ? `${products.length} xil tovar${synced ? '' : ' · keshdan'}` : undefined}
      actions={<>
        <Link to="/products/supply-history" className="ui-btn ui-btn--ghost inv-hbtn" title="Kirim tarixi">
          <i className="fa-solid fa-clock-rotate-left" aria-hidden="true" /><span className="inv-hbtn__label">Kirim tarixi</span>
        </Link>
        <Link to="/products/ai" className="ui-btn ui-btn--ghost inv-hbtn inv-hbtn--ai" title="AI orqali qo'shish (rasm yoki Excel)">
          <i className="fa-solid fa-wand-magic-sparkles" aria-hidden="true" /><span className="inv-hbtn__label">AI</span>
        </Link>
        <Link to="/products/new" className="ui-btn ui-btn--primary inv-hbtn" title="Tovar qo'shish">
          <i className="fa-solid fa-plus" aria-hidden="true" /><span className="inv-hbtn__label">Qo'shish</span>
        </Link>
      </>}
      toolbar={<>
        <div className="inv-searchrow">
          <Field icon="fa-magnifying-glass" type="search" placeholder="Nom, shtrix-kod, PLU" aria-label="Tovar qidirish"
                 value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} />
          <IconButton icon="fa-tags" label="Kategoriyalar" className="inv-only-narrow" onClick={() => setCatsOpen(true)} />
          {admin && <IconButton icon="fa-sliders" label='"Kam qoldi" chegarasi' className="inv-only-narrow" onClick={() => setLimitsOpen(true)} />}
        </div>
        <div className="inv-chips inv-only-narrow" role="tablist" aria-label="Filtr">
          {filters.map((f) => (
            <button key={f.key} type="button" role="tab" aria-selected={activeFilter === f.key}
                    className={`inv-chip${f.danger ? ' inv-chip--danger' : ''}`} onClick={() => setFilter(f.key)}>
              {f.label}<span className="inv-chip__n">{f.count}</span>
            </button>
          ))}
        </div>
      </>}
    >
      <div className="inv-layout">
        <aside className="inv-side" aria-label="Filtr va sozlamalar">
          <div className="inv-side__card">
            <div className="inv-side__title">Filtr</div>
            <div className="inv-side__list" role="tablist" aria-label="Filtr" aria-orientation="vertical">
              {filters.map((f) => (
                <button key={f.key} type="button" role="tab" aria-selected={activeFilter === f.key}
                        className={`inv-sbtn${f.danger ? ' inv-sbtn--danger' : ''}`} onClick={() => setFilter(f.key)}>
                  <i className={`fa-solid ${f.icon}`} aria-hidden="true" />
                  <span className="inv-sbtn__name">{f.label}</span>
                  <span className="inv-sbtn__n">{f.count}</span>
                </button>
              ))}
            </div>
            <Button variant="ghost" size="sm" block icon="fa-tags" onClick={() => setCatsOpen(true)}>Kategoriyalarni boshqarish</Button>
          </div>
          {admin && products.length > 0 && (
            <div className="inv-side__card">
              <div className="inv-side__title">Ombor qiymati</div>
              <div className="inv-value"><span>Sotuv narxida</span><b>{money(value.out)}</b></div>
              <div className="inv-value"><span>Kelish narxida</span><b>{money(value.in)}</b></div>
              <div className="inv-value inv-value--profit"><span>Kutilgan foyda</span><b>{money(value.out - value.in)}</b></div>
            </div>
          )}
          {admin && <div className="inv-side__card"><LimitsPanel products={products} onSaved={refresh} /></div>}
        </aside>

        <section className="inv-main" aria-label="Tovarlar">
          {!ready ? (
            <div className="inv-grid">{Array.from({ length: 9 }, (_, i) => <Skeleton key={i} height={104} radius={18} />)}</div>
          ) : !products.length ? (
            <EmptyState icon="fa-boxes-stacked" title="Omborda hali tovar yo'q"
                        text="Birinchi tovarni qo'shing yoki shtrix-kodini skanerlang"
                        action={<Link to="/products/new" className="ui-btn ui-btn--primary"><i className="fa-solid fa-plus" aria-hidden="true" /> Tovar qo'shish</Link>} />
          ) : !shown.length ? (
            <EmptyState icon={activeFilter === LOW && !q ? 'fa-circle-check' : 'fa-magnifying-glass'}
                        title={activeFilter === LOW && !q ? 'Kam qolgan tovar yo\'q' : 'Hech narsa topilmadi'}
                        text={q ? `"${q}" bo'yicha tovar yo'q` : undefined}
                        action={exact ? <Link to={`/products/new?barcode=${encodeURIComponent(exact)}`} className="ui-btn ui-btn--primary">
                          <i className="fa-solid fa-plus" aria-hidden="true" /> {exact} kodi bilan qo'shish</Link> : undefined} />
          ) : (
            <>
              <ul className="inv-grid">
                {shown.slice(0, limit).map((p) => {
                  const low = isLow(p);
                  return (
                    <li key={p.id}>
                      <Link to={`/products/${p.id}`} className={`inv-card${low ? ' is-low' : ''}`}>
                        <div className="inv-card__main">
                          <div className="inv-card__name">{p.name}</div>
                          <div className="inv-card__tags">
                            <span className="inv-tag">{categoryOf(p)}</span>
                            {p.short_code && <span className="inv-tag inv-tag--plu">PLU {p.short_code}</span>}
                            {!p.barcode && !p.short_code && <span className="inv-tag inv-tag--warn">Kodsiz</span>}
                          </div>
                          <div className="inv-card__price">{money(p.price_out)}</div>
                        </div>
                        <div className="inv-card__stock">
                          <div className="inv-card__qty">{qty(p.quantity)}</div>
                          <div className="inv-card__unit">{UNIT_SHORT[p.unit_type] ?? p.unit_type}</div>
                          {low && <div className="inv-card__low">{p.quantity <= 0 ? 'Tugagan' : 'Kam qoldi'}</div>}
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
              {shown.length > limit && (
                <div className="inv-more">
                  <Button variant="ghost" onClick={() => setLimit((l) => l + PAGE * 2)}>
                    Yana ko'rsatish ({shown.length - limit} ta qoldi)
                  </Button>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      <CategoriesModal open={catsOpen} onClose={() => setCatsOpen(false)} categories={categories} counts={catCounts}
                       onChanged={async () => { await reloadCats(); await refresh(); }} />
      <Modal open={limitsOpen} onClose={() => setLimitsOpen(false)} title='"Kam qoldi" chegarasi'>
        <LimitsPanel products={products} onSaved={refresh} />
      </Modal>
    </Page>
  );
}
