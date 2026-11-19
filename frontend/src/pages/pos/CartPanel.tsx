import { memo } from 'react';
import { money, qty } from '@/lib/format';
import { Button, EmptyState } from '@/components/ui';
import { isWeight, lineTotal, UNIT_SHORT, type CartItem } from './types';

interface Props {
  items: CartItem[];
  total: number;
  onQty: (id: number, q: number) => void;
  onWeight: (id: number) => void;
  onRemove: (id: number) => void;
  onClear: () => void;
  onCheckout: () => void;
}

export const CartPanel = memo(function CartPanel({ items, total, onQty, onWeight, onRemove, onClear, onCheckout }: Props) {
  const count = items.length;
  return (
    <aside className="pos-cart" aria-label="Savat">
      <header className="pos-cart__head">
        <h2>Savat</h2>
        {count > 0 && <span className="ui-badge ui-badge--blue">{count} xil</span>}
        {count > 0 && (
          <button type="button" className="pos-cart__clear" onClick={onClear} aria-label="Savatni tozalash" title="Savatni tozalash">
            <i className="fa-solid fa-trash-can" aria-hidden="true" />
          </button>
        )}
      </header>

      <div className="pos-cart__list">
        {!count ? (
          <EmptyState icon="fa-basket-shopping" title="Savat bo'sh" text="Tovarni skanerlang yoki ro'yxatdan tanlang" />
        ) : (
          <ul>
            {items.map((i) => {
              const weight = isWeight(i.unit);
              const pending = weight && i.qty <= 0;
              const over = i.qty > i.stock;
              return (
                <li key={i.id} className={`pos-line${pending ? ' is-pending' : ''}`}>
                  <div className="pos-line__top">
                    <span className="pos-line__name">{i.name}</span>
                    <button type="button" className="pos-line__del" onClick={() => onRemove(i.id)} aria-label={`${i.name} — olib tashlash`}>
                      <i className="fa-solid fa-xmark" aria-hidden="true" />
                    </button>
                  </div>
                  <div className="pos-line__bottom">
                    {weight ? (
                      <button type="button" className="pos-line__weight" onClick={() => onWeight(i.id)}>
                        {pending ? 'Miqdorni kiriting' : `${qty(i.qty)} ${UNIT_SHORT[i.unit]}`} <i className="fa-solid fa-pen" aria-hidden="true" />
                      </button>
                    ) : (
                      <div className="pos-qty" role="group" aria-label={`${i.name} soni`}>
                        <button type="button" onClick={() => onQty(i.id, i.qty - 1)} aria-label="Kamaytirish">−</button>
                        <input inputMode="numeric" value={i.qty} aria-label="Soni"
                               onChange={(e) => { const v = parseInt(e.target.value, 10); if (v >= 1) onQty(i.id, v); }}
                               onFocus={(e) => e.target.select()} />
                        <button type="button" onClick={() => onQty(i.id, i.qty + 1)} aria-label="Ko'paytirish">+</button>
                      </div>
                    )}
                    <span className="pos-line__unit">× {money(i.price, false)}</span>
                    <span className="pos-line__sum">{money(lineTotal(i), false)}</span>
                  </div>
                  {over && !pending && <div className="pos-line__warn">Omborda {qty(i.stock)} {UNIT_SHORT[i.unit]} bor</div>}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <footer className="pos-cart__foot">
        <div className="pos-cart__total">
          <span>Jami</span>
          <b>{money(total)}</b>
        </div>
        <Button variant="success" size="lg" block icon="fa-circle-check" disabled={!count} onClick={onCheckout}>
          To'lovga o'tish <kbd className="pos-kbd">F4</kbd>
        </Button>
      </footer>
    </aside>
  );
});
