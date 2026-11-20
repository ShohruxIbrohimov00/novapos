import { useState } from 'react';
import { money, parseNum, qty as fmtQty } from '@/lib/format';
import { UNITS, type Category, type Unit } from '@/lib/products';
import { CameraScanner } from '@/components/CameraScanner';
import { Button, Chips, Field, IconButton, NumField, Select, Switch } from '@/components/ui';
import { CategoriesModal } from './CategoriesModal';

export function UnitPills({ value, onChange }: { value: Unit; onChange: (u: Unit) => void }) {
  return <Chips ariaLabel="O'lchov birligi" value={value} onChange={(u) => { if (u) onChange(u); }} options={UNITS} />;
}

export function CategorySelect({ value, onChange, categories, onCreated }:
  { value: number | null; onChange: (id: number | null) => void; categories: Category[]; onCreated: () => Promise<void> | void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Select label="Kategoriya" icon="fa-tag" value={value} onChange={onChange} clearable placeholder="Kategoriyasiz"
              options={categories.map((c) => ({ value: c.id, label: c.name }))}
              footer={(close) => <Button variant="ghost" size="sm" icon="fa-plus" onClick={() => { close(); setOpen(true); }}>Yangi kategoriya</Button>} />
      <CategoriesModal open={open} onClose={() => setOpen(false)} categories={categories} onChanged={onCreated}
                       onPick={(c) => onChange(c.id)} />
    </>
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
        <Switch label="Blok bilan" checked={bulk} onChange={(v) => { setBulk(v); if (!v) { setPacks(''); setPer(''); } }} />
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
