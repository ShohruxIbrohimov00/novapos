import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { money, qty } from '@/lib/format';
import { UNIT_SHORT, type Product } from './types';

interface Props {
  products: Product[];
  onPick: (p: Product) => void;
  /** Aniq kod (PLU/shtrix-kod) topilmasa — serverdan qidirish */
  onCode: (code: string) => void;
  onCamera: () => void;
}
export interface SearchHandle { focus: () => void }

/** Nom, PLU yoki shtrix-kod bo'yicha qidiruv. Enter — aniq kod yoki birinchi natija. */
export const ProductSearch = forwardRef<SearchHandle, Props>(function ProductSearch({ products, onPick, onCode, onCamera }, ref) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => ({ focus: () => input.current?.focus() }), []);

  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    return products
      .filter((p) => p.name.toLowerCase().includes(t) || p.barcode === t || p.short_code === t)
      .slice(0, 8);
  }, [q, products]);

  const pick = (p: Product) => { onPick(p); setQ(''); setActive(0); };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Escape') { setQ(''); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const t = q.trim();
      if (!t) return;
      const exact = products.find((p) => p.barcode === t || p.short_code === t);
      if (exact) pick(exact);
      else if (results[active]) pick(results[active]);
      else { onCode(t); setQ(''); }
    }
  };

  return (
    <div className="pos-search">
      <div className="pos-search__box">
        <i className="fa-solid fa-magnifying-glass pos-search__icon" aria-hidden="true" />
        <input ref={input} className="pos-search__input" type="search" value={q} placeholder="Nom, PLU yoki shtrix-kod  (F2)"
               aria-label="Mahsulot qidirish" autoComplete="off" role="combobox" aria-expanded={results.length > 0}
               aria-controls="pos-search-list" aria-activedescendant={results[active] ? `ps-${results[active].id}` : undefined}
               onChange={(e) => { setQ(e.target.value); setActive(0); }} onKeyDown={onKeyDown} />
        <button type="button" className="pos-search__cam" onClick={onCamera} aria-label="Kamera bilan skanerlash" title="Kamera bilan skanerlash">
          <i className="fa-solid fa-camera" aria-hidden="true" />
        </button>
      </div>
      {results.length > 0 && (
        <ul id="pos-search-list" className="pos-search__list" role="listbox">
          {results.map((p, i) => (
            <li key={p.id} id={`ps-${p.id}`} role="option" aria-selected={i === active}
                className={`pos-search__item${i === active ? ' is-active' : ''}${p.quantity <= 0 ? ' is-out' : ''}`}
                onMouseDown={(e) => { e.preventDefault(); pick(p); }} onMouseEnter={() => setActive(i)}>
              <span className="pos-search__name">{p.name}</span>
              <span className="pos-search__meta">{qty(p.quantity)} {UNIT_SHORT[p.unit_type]}</span>
              <span className="pos-search__price">{money(p.price_out, false)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});
