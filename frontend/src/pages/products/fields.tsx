import { useId, useState } from 'react';
import { cleanNumInput, money, parseNum, qty as fmtQty } from '@/lib/format';
import { UNITS, type Category, type Unit } from '@/lib/products';
import { CameraScanner } from '@/components/CameraScanner';
import { Field, IconButton, type FieldProps } from '@/components/ui';
import { CategoriesModal } from './CategoriesModal';

/** Son maydoni: telefonda raqamli klaviatura, vergul ham qabul qilinadi, pul bo'lsa ostida "12 500 so'm" */
export function NumField({ value, onValue, isMoney, decimals = true, hint, ...rest }:
  Omit<FieldProps, 'value' | 'onChange'> & { value: string; onValue: (v: string) => void; isMoney?: boolean; decimals?: boolean }) {
  const n = parseNum(value);
  const auto = isMoney && n >= 1000 ? money(n) : undefined;
  return (
    <Field inputMode={decimals ? 'decimal' : 'numeric'} autoComplete="off" value={value}
           onChange={(e) => onValue(cleanNumInput(e.target.value, decimals))}
           hint={hint ?? auto} {...rest} />
  );
}

export function UnitPills({ value, onChange, disabled }: { value: Unit; onChange: (u: Unit) => void; disabled?: boolean }) {
  return (
    <div className="pf-units" role="radiogroup" aria-label="O'lchov birligi">
      {UNITS.map((u) => (
        <button key={u.value} type="button" role="radio" aria-checked={value === u.value} disabled={disabled}
                className="pf-unit" onClick={() => onChange(u.value)}>{u.label}</button>
      ))}
    </div>
  );
}

export function CategorySelect({ value, onChange, categories, onCreated }:
  { value: number | null; onChange: (id: number | null) => void; categories: Category[]; onCreated: () => Promise<void> | void }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <div className="ui-field">
      <label className="ui-field__label" htmlFor={id}>Kategoriya</label>
      <div className="pf-row">
        <select id={id} className="ui-input" value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
          <option value="">— Kategoriyasiz —</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <IconButton icon="fa-plus" label="Yangi kategoriya" className="pf-sqbtn" onClick={() => setOpen(true)} />
      </div>
      <CategoriesModal open={open} onClose={() => setOpen(false)} categories={categories} onChanged={onCreated}
                       onPick={(c) => onChange(c.id)} />
    </div>
  );
}

export function BarcodeField({ value, onChange, error, onScanned, autoFocus }:
  { value: string; onChange: (v: string) => void; error?: string | null; onScanned?: (code: string) => void; autoFocus?: boolean }) {
  const [cam, setCam] = useState(false);
  return (
    <div className="pf-row pf-row--top">
      <Field label="Shtrix-kod" icon="fa-barcode" placeholder="Skanerlang yoki yozing" value={value} error={error}
             className="pf-mono" autoComplete="off" autoFocus={autoFocus} inputMode="numeric"
             onChange={(e) => onChange(e.target.value.replace(/\s/g, ''))} />
      <IconButton icon="fa-camera" label="Kamera bilan skanerlash" className="pf-sqbtn pf-sqbtn--label" onClick={() => setCam(true)} />
      <CameraScanner open={cam} onClose={() => setCam(false)}
                     onScan={(code) => { setCam(false); onChange(code); onScanned?.(code); }} />
    </div>
  );
}

/** Miqdor: oddiy yoki blok bilan (blok soni × ichidagi soni) */
export function QtyInput({ label, value, onValue, unit, autoFocus }:
  { label: string; value: string; onValue: (v: string) => void; unit: Unit; autoFocus?: boolean }) {
  const [bulk, setBulk] = useState(false);
  const [packs, setPacks] = useState('');
  const [per, setPer] = useState('');
  const canBulk = unit === 'dona';

  const recalc = (p: string, x: string) => {
    const t = parseNum(p) * parseNum(x);
    onValue(Number.isFinite(t) && t > 0 ? String(t) : '');
  };

  return (
    <div className="pf-qty">
      {canBulk && (
        <label className="pf-switch">
          <input type="checkbox" checked={bulk} onChange={(e) => { setBulk(e.target.checked); if (!e.target.checked) { setPacks(''); setPer(''); } }} />
          <span className="pf-switch__track" aria-hidden="true" />
          Blok bilan
        </label>
      )}
      {bulk && canBulk ? (
        <div className="pf-bulk">
          <NumField label="Blok soni" value={packs} decimals={false} autoFocus
                    onValue={(v) => { setPacks(v); recalc(v, per); }} />
          <span className="pf-bulk__x" aria-hidden="true">×</span>
          <NumField label="Ichida nechta" value={per} decimals={false}
                    onValue={(v) => { setPer(v); recalc(packs, v); }} />
          <div className="pf-bulk__eq" aria-live="polite">= <b>{value ? fmtQty(parseNum(value)) : 0}</b> dona</div>
        </div>
      ) : (
        <NumField label={label} value={value} onValue={onValue} decimals={unit !== 'dona' && unit !== 'blok'}
                  placeholder="0" autoFocus={autoFocus} className="pf-big" />
      )}
    </div>
  );
}

/** Kelish/sotuv narxidan foyda */
export function Margin({ priceIn, priceOut }: { priceIn: string; priceOut: string }) {
  const a = parseNum(priceIn), b = parseNum(priceOut);
  if (!(b > 0) || !(a >= 0) || Number.isNaN(a)) return null;
  const profit = b - a;
  const pct = a > 0 ? Math.round((profit / a) * 1000) / 10 : null;
  const tone = profit < 0 ? 'is-loss' : profit === 0 ? 'is-zero' : 'is-ok';
  return (
    <div className={`pf-margin ${tone}`} role="status">
      <i className={`fa-solid ${profit < 0 ? 'fa-triangle-exclamation' : 'fa-chart-line'}`} aria-hidden="true" />
      {profit < 0
        ? <>Zarar: har biridan <b>{money(-profit)}</b> kam sotiladi</>
        : <>Foyda: <b>{money(profit)}</b>{pct !== null && <> ({pct}%)</>}</>}
    </div>
  );
}
