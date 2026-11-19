import { useEffect, useState } from 'react';
import { money, qty as fmtQty } from '@/lib/format';
import { Button, Modal, Tabs } from '@/components/ui';
import { applyKey, Numpad } from './Numpad';
import { UNIT_SHORT, type CartItem } from './types';

type Mode = 'qty' | 'sum';

/** Vaznli tovar (kg/litr/metr): miqdor yoki summa bo'yicha. Klaviatura: raqam, nuqta, Backspace, Enter. */
export function WeightModal({ item, onApply, onClose }: {
  item: CartItem | null;
  onApply: (id: number, mode: Mode, value: number) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<Mode>('qty');
  const [buf, setBuf] = useState('');

  useEffect(() => {
    if (!item) return;
    setMode('qty');
    setBuf(item.qty > 0 ? String(item.qty) : '');
  }, [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!item) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^[0-9]$/.test(e.key) || e.key === '.' || e.key === ',' ) { e.preventDefault(); setBuf((b) => applyKey(b, e.key, mode === 'qty' ? 3 : 0)); }
      else if (e.key === 'Backspace') { e.preventDefault(); setBuf((b) => applyKey(b, '⌫')); }
      else if (e.key === 'Delete') { e.preventDefault(); setBuf(''); }
      else if (e.key === 'Enter') { e.preventDefault(); apply(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  if (!item) return null;
  const v = parseFloat(buf) || 0;
  const unit = UNIT_SHORT[item.unit];
  const preview = mode === 'qty' ? `${money(v * item.price)}` : `${fmtQty(item.price ? v / item.price : 0)} ${unit}`;

  function apply() {
    if (!item || v <= 0) return;
    onApply(item.id, mode, v);
  }

  return (
    <Modal open onClose={onClose} title={item.name}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Bekor qilish</Button>
        <Button onClick={apply} disabled={v <= 0} icon="fa-check">Qo'shish</Button>
      </>}>
      <p className="wm-price">Narxi: {money(item.price)} / {unit}</p>
      <Tabs label="Kiritish turi" value={mode} onChange={(m) => { setMode(m); setBuf(''); }}
            items={[{ value: 'qty', label: `Miqdor (${unit})` }, { value: 'sum', label: "Summa (so'm)" }]} />
      <div className="wm-display" aria-live="polite">
        <span className="wm-display__value">{buf || '0'}</span>
        <span className="wm-display__unit">{mode === 'qty' ? unit : "so'm"}</span>
      </div>
      <div className="wm-preview">{mode === 'qty' ? 'Summa' : 'Miqdor'}: <b>{v > 0 ? preview : '—'}</b></div>
      <Numpad decimal={mode === 'qty'} onKey={(k) => setBuf((b) => applyKey(b, k, mode === 'qty' ? 3 : 0))} />
    </Modal>
  );
}
