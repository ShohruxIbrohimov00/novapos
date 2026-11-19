import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { cleanNumInput, money, parseNum, qty as fmtQty } from '@/lib/format';
import { isWeight, UNIT_SHORT } from '@/lib/products';
import { Button, Field, Modal, useToast } from '@/components/ui';
import type { Sale, SaleItem } from './types';

const REASONS = ['Sifatsiz / buzuq', "Mijoz fikrini o'zgartirdi", 'Xato urilgan', 'Muddati o\'tgan'];

export function ReturnModal({ sale, item, onClose, onDone }: { sale: Sale; item: SaleItem | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [val, setVal] = useState('1');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (item) { setVal(isWeight(item.unit_type) ? fmtQty(item.quantity) : '1'); setReason(''); }
  }, [item]);

  if (!item) return <Modal open={false} onClose={onClose} title="">{null}</Modal>;

  const weight = isWeight(item.unit_type);
  const unit = UNIT_SHORT[item.unit_type] ?? 'dona';
  const unitPaid = item.quantity > 0 ? item.final_amount / item.quantity : item.unit_price;
  const n = parseNum(val);
  const valid = n > 0 && n <= item.quantity + 1e-9 && (weight || Number.isInteger(n));
  const refund = valid ? Math.round(unitPaid * n) : 0;
  const step = (d: number) => setVal(String(Math.min(item.quantity, Math.max(1, Math.round((Number.isFinite(n) ? n : 0) + d)))));

  const submit = async () => {
    if (!valid) { toast.show(n > item.quantity ? `Ko'pi bilan ${fmtQty(item.quantity)} ${unit}` : 'Miqdorni to\'g\'ri yozing', 'error'); return; }
    setBusy(true);
    try {
      const r = await api<{ refund_amount: number }>(`/api/sales/${sale.id}/return`, 'POST', {
        product_id: item.product_id, quantity: n, reason: reason.trim() || null,
      });
      toast.show(sale.payment_method === 'nasiya'
        ? `Qaytarildi. Mijoz qarzi ${money(r.refund_amount)}ga kamaydi`
        : `Qaytarildi. Mijozga ${money(r.refund_amount)} qaytaring`, 'success');
      onDone(); onClose();
    } catch (e) { toast.show(e instanceof ApiError ? e.message : 'Qaytarilmadi', 'error'); }
    finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title="Tovarni qaytarish"
           footer={<><Button variant="ghost" onClick={onClose}>Bekor</Button>
             <Button variant="danger" icon="fa-rotate-left" loading={busy} disabled={!valid} onClick={submit}>Qaytarish</Button></>}>
      <form className="sl-ret" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
        <button type="submit" className="sr-only" tabIndex={-1} aria-hidden="true" />
        <div className="sl-ret__prod">
          <b>{item.product_name}</b>
          <span>Chekda: {fmtQty(item.quantity)} {unit} × {money(unitPaid)}</span>
        </div>
        {weight ? (
          <Field label={`Qaytariladigan miqdor (${unit})`} inputMode="decimal" value={val} autoFocus className="sl-ret__input"
                 onChange={(e) => setVal(cleanNumInput(e.target.value))} />
        ) : (
          <div className="ui-field">
            <span className="ui-field__label">Nechta qaytariladi</span>
            <div className="sl-stepper">
              <button type="button" onClick={() => step(-1)} disabled={n <= 1} aria-label="Kamaytirish">−</button>
              <input inputMode="numeric" value={val} aria-label="Miqdor" autoFocus
                     onChange={(e) => setVal(cleanNumInput(e.target.value, false))} />
              <button type="button" onClick={() => step(1)} disabled={n >= item.quantity} aria-label="Ko'paytirish">+</button>
              <button type="button" className="sl-stepper__all" onClick={() => setVal(String(item.quantity))}>Hammasi ({fmtQty(item.quantity)})</button>
            </div>
          </div>
        )}
        <div className="ui-field">
          <span className="ui-field__label">Sabab</span>
          <div className="sl-reasons">
            {REASONS.map((r) => (
              <button key={r} type="button" className="sl-reason" aria-pressed={reason === r} onClick={() => setReason(reason === r ? '' : r)}>{r}</button>
            ))}
          </div>
          <Field placeholder="Yoki o'zingiz yozing (ixtiyoriy)" value={REASONS.includes(reason) ? '' : reason}
                 onChange={(e) => setReason(e.target.value)} maxLength={200} aria-label="Boshqa sabab" />
        </div>
        <div className={`sl-refund${valid ? '' : ' is-off'}`} role="status">
          <span>{sale.payment_method === 'nasiya' ? 'Qarzdan ayriladi' : 'Mijozga qaytariladi'}</span>
          <b>{money(refund)}</b>
        </div>
        <p className="sl-note">Tovar omborga qaytadi. Chek summasi va foyda hisoboti kamayadi.</p>
      </form>
    </Modal>
  );
}
