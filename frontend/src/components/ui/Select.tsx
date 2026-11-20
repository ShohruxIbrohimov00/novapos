import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface SelectOption<V extends string | number> {
  value: V;
  label: string;
  /** Qo'shimcha kichik matn (masalan, "3 ta tovar") */
  hint?: string;
  /** Font Awesome nomi */
  icon?: string;
  disabled?: boolean;
}

export interface SelectProps<V extends string | number> {
  value: V | null;
  onChange: (v: V | null) => void;
  options: SelectOption<V>[];
  label?: string;
  /** Hech narsa tanlanmaganda ko'rinadi. `clearable` bo'lsa — ro'yxatda "bo'sh" qator sifatida ham */
  placeholder?: string;
  /** Tanlovni bekor qilish mumkin (ro'yxat boshida placeholder qatori) */
  clearable?: boolean;
  /** Qidiruv maydoni. Standart: 8 tadan ko'p variant bo'lsa avtomatik */
  searchable?: boolean;
  error?: string | null;
  hint?: string;
  required?: boolean;
  disabled?: boolean;
  size?: 'md' | 'sm';
  icon?: string;
  /** Ekran o'quvchilar uchun (label bo'lmasa) */
  'aria-label'?: string;
  id?: string;
  /** Ro'yxat oxirida qo'shimcha tugma (masalan, "+ Yangi kategoriya") */
  footer?: (close: () => void) => ReactNode;
}

const norm = (s: string) => s.toLowerCase().replace(/[ʻʼ‘’`']/g, "'");

/**
 * Yagona tanlash komponenti (brauzerning oddiy <select> o'rniga).
 * - Kompyuter/planshet: maydon ostida ochiladigan ro'yxat (joy bo'lmasa — tepaga)
 * - Telefon: pastdan chiqadigan varaq, katta bosiladigan qatorlar
 * - Klaviatura: ↑ ↓ Home End, Enter/Space — tanlash, Esc — yopish, harf yozsa — o'sha harfga sakraydi
 * - Ochiq paytda USB skaner jim (data-scanner-off), oyna (Modal) ichida ham to'g'ri ishlaydi
 */
export function Select<V extends string | number>({
  value, onChange, options, label, placeholder = 'Tanlang', clearable, searchable, error, hint, required, disabled,
  size = 'md', icon, id, footer, ...rest
}: SelectProps<V>) {
  const auto = useId();
  const fid = id ?? auto;
  const listId = `${fid}-list`;
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; width: number; maxH: number } | null>(null);
  const [sheet, setSheet] = useState(false);
  const typed = useRef({ s: '', t: 0 });

  const withSearch = searchable ?? options.length > 8;
  const rows = useMemo(() => {
    const t = norm(q.trim());
    const list = t ? options.filter((o) => norm(o.label).includes(t) || norm(o.hint ?? '').includes(t)) : options;
    return clearable && !t ? [{ value: null as V | null, label: placeholder } as { value: V | null; label: string; hint?: string; icon?: string; disabled?: boolean }, ...list] : list;
  }, [options, q, clearable, placeholder]);
  const current = options.find((o) => o.value === value) ?? null;

  const place = useCallback(() => {
    const b = btnRef.current?.getBoundingClientRect();
    if (!b) return;
    const phone = window.innerWidth < 640;
    setSheet(phone);
    if (phone) { setPos(null); return; }
    const below = window.innerHeight - b.bottom - 12, above = b.top - 12;
    const up = below < 220 && above > below;
    const maxH = Math.min(320, up ? above : below);
    setPos(up ? { left: b.left, bottom: window.innerHeight - b.top + 6, width: b.width, maxH }
              : { left: b.left, top: b.bottom + 6, width: b.width, maxH });
  }, []);

  const close = useCallback((focus = true) => {
    setOpen(false); setQ('');
    if (focus) btnRef.current?.focus({ preventScroll: true });
  }, []);

  const openList = () => {
    if (disabled) return;
    const i = rows.findIndex((r) => r.value === value);
    setActive(i >= 0 ? i : 0);
    place(); setOpen(true);
  };

  useLayoutEffect(() => { if (open) place(); }, [open, place]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      close(false);
    };
    const onMove = (e: Event) => { if (!popRef.current?.contains(e.target as Node)) place(); };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('touchstart', onDown, true);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', onMove, true);
    if (withSearch) setTimeout(() => searchRef.current?.focus({ preventScroll: true }), 0);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('touchstart', onDown, true);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [open, close, place, withSearch]);

  // Faol qator ko'rinib tursin
  useEffect(() => {
    if (!open) return;
    popRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const choose = (r: { value: V | null; disabled?: boolean } | undefined) => {
    if (!r || r.disabled) return;
    onChange(r.value);
    close();
  };

  const step = (from: number, dir: 1 | -1) => {
    for (let i = 1; i <= rows.length; i++) {
      const n = (from + dir * i + rows.length) % rows.length;
      if (!rows[n].disabled) return n;
    }
    return from;
  };

  const onKey = (e: KeyboardEvent) => {
    if (disabled) return;
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); openList(); }
      else if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault(); openList();
        setActive(e.key === 'Home' ? step(-1, 1) : step(rows.length, -1));
      }
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); close(); return; }
    if (e.key === 'Tab') { close(false); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => step(a, 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => step(a, -1)); return; }
    if (e.key === 'Home') { e.preventDefault(); setActive(step(-1, 1)); return; }
    if (e.key === 'End') { e.preventDefault(); setActive(step(rows.length, -1)); return; }
    if (e.key === 'Enter' || (e.key === ' ' && !withSearch)) { e.preventDefault(); choose(rows[active]); return; }
    // Qidiruvsiz: harf yozilsa o'sha harf bilan boshlanadigan qatorga sakrash
    if (!withSearch && e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      const now = Date.now();
      typed.current = { s: (now - typed.current.t < 700 ? typed.current.s : '') + e.key.toLowerCase(), t: now };
      const i = rows.findIndex((r) => norm(r.label).startsWith(typed.current.s));
      if (i >= 0) setActive(i);
    }
  };

  const cls = ['ui-select', size === 'sm' && 'ui-select--sm', error && 'ui-select--error', open && 'is-open', icon && 'ui-select--icon'].filter(Boolean).join(' ');
  const describedBy = error ? `${fid}-err` : hint ? `${fid}-hint` : undefined;

  const list = (
    <div ref={popRef} className={`ui-select-pop${sheet ? ' ui-select-pop--sheet' : ''}`} data-scanner-off=""
         style={pos ? { left: pos.left, top: pos.top, bottom: pos.bottom, width: Math.max(pos.width, 200), maxHeight: pos.maxH } : undefined}
         onKeyDown={onKey}>
      {sheet && <div className="ui-select-pop__head">{label ?? rest['aria-label'] ?? placeholder}<button type="button" className="ui-icon-btn" aria-label="Yopish" onClick={() => close()}><i className="fa-solid fa-xmark" aria-hidden="true" /></button></div>}
      {withSearch && (
        <div className="ui-select-pop__search">
          <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
          <input ref={searchRef} value={q} placeholder="Qidirish…" aria-label="Ro'yxatdan qidirish" aria-controls={listId}
                 aria-activedescendant={rows[active] ? `${fid}-o${active}` : undefined}
                 onChange={(e) => { setQ(e.target.value); setActive(0); }} />
        </div>
      )}
      <ul id={listId} role="listbox" aria-label={label ?? rest['aria-label']} className="ui-select-pop__list">
        {!rows.length && <li className="ui-select-pop__empty">Topilmadi</li>}
        {rows.map((r, i) => (
          <li key={String(r.value)} id={`${fid}-o${i}`} data-i={i} role="option" aria-selected={r.value === value} aria-disabled={r.disabled || undefined}
              className={`ui-select-opt${i === active ? ' is-active' : ''}${r.value === null ? ' is-empty' : ''}`}
              onMouseEnter={() => setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(r)}>
            {r.icon && <i className={`fa-solid ${r.icon}`} aria-hidden="true" />}
            <span className="ui-select-opt__text">{r.label}{r.hint && <small>{r.hint}</small>}</span>
            {r.value === value && <i className="fa-solid fa-check ui-select-opt__check" aria-hidden="true" />}
          </li>
        ))}
      </ul>
      {footer && <div className="ui-select-pop__foot">{footer(() => close(false))}</div>}
    </div>
  );

  return (
    <div className="ui-field">
      {label && <label className="ui-field__label" htmlFor={fid}>{label}{required && <span className="ui-field__req" aria-hidden="true">*</span>}</label>}
      <button ref={btnRef} id={fid} type="button" className={cls} disabled={disabled}
              role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
              aria-activedescendant={open && !withSearch && rows[active] ? `${fid}-o${active}` : undefined}
              aria-invalid={!!error || undefined} aria-describedby={describedBy} aria-label={label ? undefined : rest['aria-label']}
              onClick={() => (open ? close() : openList())} onKeyDown={onKey}>
        {icon && <i className={`fa-solid ${icon} ui-select__icon`} aria-hidden="true" />}
        {current?.icon && !icon && <i className={`fa-solid ${current.icon} ui-select__icon`} aria-hidden="true" />}
        <span className={`ui-select__value${current ? '' : ' is-placeholder'}`}>{current?.label ?? placeholder}</span>
        <i className="fa-solid fa-chevron-down ui-select__chev" aria-hidden="true" />
      </button>
      {error ? <span id={`${fid}-err`} className="ui-field__error">{error}</span>
        : hint ? <span id={`${fid}-hint`} className="ui-field__hint">{hint}</span> : null}
      {open && createPortal(sheet ? <div className="ui-select-backdrop" data-scanner-off="">{list}</div> : list, document.body)}
    </div>
  );
}
