import { memo, useMemo } from 'react';
import { money, qty } from '@/lib/format';
import { EmptyState, Skeleton } from '@/components/ui';
import { isWeight, UNIT_SHORT, type Product } from './types';

/** Shtrix-kodsiz tovarlar (non, ko'katlar...) — tez bosish uchun yuqorida chip ko'rinishida */
export const QuickChips = memo(function QuickChips({ products, onPick }: { products: Product[]; onPick: (p: Product) => void }) {
  const quick = useMemo(() => products.filter((p) => !p.barcode && !p.short_code), [products]);
  if (!quick.length) return null;
  return (
    <div className="pos-chips" role="group" aria-label="Tezkor tovarlar">
      {quick.map((p) => (
        <button key={p.id} type="button" className={`pos-chip${p.quantity <= 0 ? ' is-out' : ''}`}
                disabled={p.quantity <= 0} onClick={() => onPick(p)}>
          <span>{p.name}</span><small>{qty(p.quantity)}</small>
        </button>
      ))}
    </div>
  );
});

/** Kategoriya bo'yicha mahsulot kartalari */
export const ProductGrid = memo(function ProductGrid({ products, loading, onPick }: { products: Product[]; loading: boolean; onPick: (p: Product) => void }) {
  const groups = useMemo(() => {
    const m = new Map<string, Product[]>();
    for (const p of products) {
      const k = p.category_name || 'Kategoriyasiz';
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(p);
    }
    return [...m.entries()].sort((a, b) => (a[0] === 'Kategoriyasiz' ? 1 : b[0] === 'Kategoriyasiz' ? -1 : a[0].localeCompare(b[0])));
  }, [products]);

  if (loading) return <div className="pos-grid">{Array.from({ length: 12 }, (_, i) => <Skeleton key={i} height={84} radius={14} />)}</div>;
  if (!products.length) {
    return <EmptyState icon="fa-box-open" title="Mahsulot yo'q" text="Avval Ombor bo'limida mahsulot qo'shing"
                       action={<a className="ui-btn ui-btn--primary" href="/products/add">Mahsulot qo'shish</a>} />;
  }
  return (
    <>
      {groups.map(([cat, list]) => (
        <section key={cat} className="pos-group" aria-label={cat}>
          <h2 className="pos-group__title">{cat}</h2>
          <div className="pos-grid">
            {list.map((p) => {
              const low = p.quantity > 0 && p.quantity <= (p.min_stock_limit ?? 5);
              return (
                <button key={p.id} type="button" disabled={p.quantity <= 0} onClick={() => onPick(p)}
                        className={`pos-card${p.quantity <= 0 ? ' is-out' : low ? ' is-low' : ''}`}>
                  <span className="pos-card__name">{p.name}</span>
                  <span className="pos-card__foot">
                    <span className="pos-card__price">{money(p.price_out, false)}{isWeight(p.unit_type) && <small>/{UNIT_SHORT[p.unit_type]}</small>}</span>
                    <span className="pos-card__qty">{p.quantity <= 0 ? 'tugagan' : qty(p.quantity)}</span>
                  </span>
                  {p.short_code && <span className="pos-card__plu">{p.short_code}</span>}
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
});
