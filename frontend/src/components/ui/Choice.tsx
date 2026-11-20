import type { ReactNode } from 'react';

/** Yoqish/o'chirish tugmasi (masalan, "Tungi rejim", "Blok bilan") */
export function Switch({ checked, onChange, label, hint, disabled }: {
  checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: string; disabled?: boolean;
}) {
  return (
    <label className={`ui-switch${disabled ? ' is-disabled' : ''}`}>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="ui-switch__track" aria-hidden="true" />
      <span className="ui-switch__text">{label}{hint && <small>{hint}</small>}</span>
    </label>
  );
}

export interface SegmentOption<V extends string | number> { value: V; label: string; icon?: string; tone?: 'danger' }

/** 2–4 variantdan bittasini tanlash ("Naqd / Plastik", "58 mm / 80 mm") */
export function Segmented<V extends string | number>({ value, onChange, options, label, ariaLabel, disabled }: {
  value: V; onChange: (v: V) => void; options: SegmentOption<V>[]; label?: string; ariaLabel?: string; disabled?: boolean;
}) {
  const seg = (
    <div className="ui-seg" role="radiogroup" aria-label={label ?? ariaLabel}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={value === o.value} disabled={disabled}
                className={`ui-seg__btn${o.tone === 'danger' ? ' ui-seg__btn--danger' : ''}`} onClick={() => onChange(o.value)}>
          {o.icon && <i className={`fa-solid ${o.icon}`} aria-hidden="true" />}{o.label}
        </button>
      ))}
    </div>
  );
  if (!label) return seg;
  return <div className="ui-field"><span className="ui-field__label">{label}</span>{seg}</div>;
}

export interface ChipOption<V extends string | number> { value: V; label: string; icon?: string; count?: number; tone?: 'danger' }

/**
 * Chiplar: bitta tanlash (filtr, sabab, tur). `multiple` bo'lmasa ham qayta bosish — tanlovni bekor qiladi
 * (`toggle`). `scroll` — telefonda bir qatorda yonga suriladi.
 */
export function Chips<V extends string | number>({ value, onChange, options, label, ariaLabel, toggle, scroll, size = 'md' }: {
  value: V | null; onChange: (v: V | null) => void; options: ChipOption<V>[]; label?: string; ariaLabel?: string;
  toggle?: boolean; scroll?: boolean; size?: 'md' | 'sm';
}) {
  const chips = (
    <div className={`ui-chips${scroll ? ' ui-chips--scroll' : ''}`} role="radiogroup" aria-label={label ?? ariaLabel}>
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button key={String(o.value)} type="button" role="radio" aria-checked={on}
                  className={`ui-chip${size === 'sm' ? ' ui-chip--sm' : ''}${o.tone === 'danger' ? ' ui-chip--danger' : ''}`}
                  onClick={() => onChange(on && toggle ? null : o.value)}>
            {o.icon && <i className={`fa-solid ${o.icon}`} aria-hidden="true" />}
            {o.label}
            {o.count !== undefined && <span className="ui-chip__n">{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
  if (!label) return chips;
  return <div className="ui-field"><span className="ui-field__label">{label}</span>{chips}</div>;
}
