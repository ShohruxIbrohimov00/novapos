import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { isAdmin } from '@/lib/auth';
import { dateTime, money, qty as fmtQty } from '@/lib/format';
import { UNIT_SHORT } from '@/lib/products';
import { Badge, Button, Skeleton, useConfirm, useToast } from '@/components/ui';
import { printText, receiptText } from '@/pages/pos/receipt';
import { ReturnModal } from './ReturnModal';
import { canReturn, METHOD, shortReceipt, type Sale, type SaleItem, type SaleReturn } from './types';

export function SaleDetail({ sale, onChanged }: { sale: Sale; onChanged: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const admin = isAdmin();
  const [returns, setReturns] = useState<SaleReturn[] | null>(null);
  const [retItem, setRetItem] = useState<SaleItem | null>(null);
  const [busy, setBusy] = useState(false);

  const loadReturns = useCallback(() => {
    if (!sale.returns_count) { setReturns([]); return; }
    api<SaleReturn[]>(`/api/sales/${sale.id}/returns`).then(setReturns).catch(() => setReturns([]));
  }, [sale.id, sale.returns_count]);
  useEffect(() => { setReturns(null); loadReturns(); }, [loadReturns]);

  const m = METHOD[sale.payment_method] ?? METHOD.naqd;
  const returnable = canReturn(sale);
  const debt = sale.payment_method === 'nasiya' ? Math.max(0, sale.total_amount - sale.paid_amount) : 0;

  const print = async () => {
    try {
      await printText(receiptText({
        number: shortReceipt(sale.receipt_number), date: sale.created_at, copy: true,
        items: sale.items.map((i) => ({ id: i.product_id, name: i.product_name, unit: i.unit_type, price: i.unit_price, qty: i.quantity, fixedTotal: i.final_amount, stock: 0 })),
        total: sale.total_amount, paid: sale.payment_method === 'nasiya' ? sale.paid_amount : Math.min(sale.paid_amount, sale.total_amount),
        method: sale.payment_method, customer: sale.customer_name,
      }));
      toast.show('Chek printerga yuborildi', 'success');
    } catch (e) { toast.show((e as Error).message || 'Chop etilmadi', 'error'); }
  };

  const cancel = async () => {
    const ok = await confirm({
      title: `Chek #${shortReceipt(sale.receipt_number)} bekor qilinsinmi?`,
      message: `Hamma tovar omborga qaytadi${sale.payment_method === 'nasiya' ? ", mijozning shu chek bo'yicha qarzi o'chiriladi" : ''}. Hisobotdan chiqadi. Buni ortga qaytarib bo'lmaydi.`,
      confirmText: 'Bekor qilish', cancelText: 'Yopish', danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api(`/api/sales/${sale.id}/cancel`, 'POST');
      toast.show('Chek bekor qilindi, tovarlar omborga qaytdi', 'success');
      onChanged();
    } catch (e) { toast.show(e instanceof ApiError ? e.message : 'Bekor qilinmadi', 'error'); }
    finally { setBusy(false); }
  };

  return (
    <div className="sl-detail">
      <div className="sl-detail__head">
        <div>
          <div className="sl-detail__no">Chek #{shortReceipt(sale.receipt_number)}</div>
          <div className="sl-detail__date">{dateTime(sale.created_at)}{sale.employee_name && ` · ${sale.employee_name}`}</div>
        </div>
        {sale.is_cancelled ? <Badge tone="red">Bekor qilingan</Badge> : <Badge tone={m.tone}>{m.label}</Badge>}
      </div>

      {sale.is_cancelled && (
        <div className="sl-alert"><i className="fa-solid fa-ban" aria-hidden="true" /> Bu chek bekor qilingan{sale.cancelled_by_name && ` (${sale.cancelled_by_name})`}. Tovarlar omborga qaytarilgan.</div>
      )}

      <div className="sl-sums">
        <div><span>Jami</span><b className="tone-primary">{money(sale.total_amount)}</b></div>
        {sale.payment_method !== 'nasiya' && sale.paid_amount > 0 && <div><span>To'landi</span><b>{money(sale.paid_amount)}</b></div>}
        {sale.change_amount > 0 && <div><span>Qaytim</span><b>{money(sale.change_amount)}</b></div>}
        {sale.payment_method === 'nasiya' && <div><span>Oldindan to'langan</span><b>{money(sale.paid_amount)}</b></div>}
        {debt > 0 && <div><span>Qarzga</span><b className="tone-danger">{money(debt)}</b></div>}
        {sale.refunded_amount > 0 && <div><span>Qaytarilgan</span><b className="tone-danger">−{money(sale.refunded_amount)}</b></div>}
      </div>

      {sale.customer_name && (
        <Link to="/customers" className="sl-customer"><i className="fa-solid fa-user" aria-hidden="true" /> {sale.customer_name}</Link>
      )}

      <div className="sl-h">Tovarlar</div>
      {!sale.items.length ? (
        <p className="sl-note">{sale.is_cancelled ? 'Chek bekor qilingan.' : 'Hamma tovar qaytarilgan.'}</p>
      ) : (
        <ul className="sl-items">
          {sale.items.map((i) => (
            <li key={i.id}>
              <div className="sl-items__main">
                <b>{i.product_name}</b>
                <span>{fmtQty(i.quantity)} {UNIT_SHORT[i.unit_type] ?? ''} × {money(i.unit_price, false)}
                  {i.returned_quantity > 0 && <em> · {fmtQty(i.returned_quantity)} qaytarilgan</em>}</span>
              </div>
              <div className="sl-items__r">
                <b>{money(i.final_amount, false)}</b>
                {returnable && (
                  <button type="button" className="sl-retbtn" onClick={() => setRetItem(i)} aria-label={`${i.product_name} — qaytarish`}>
                    <i className="fa-solid fa-rotate-left" aria-hidden="true" /> Qaytarish
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {!returnable && !sale.is_cancelled && sale.items.length > 0 && (
        <p className="sl-note"><i className="fa-solid fa-lock" aria-hidden="true" /> Eski chekdan qaytarishni faqat admin qila oladi.</p>
      )}

      {sale.returns_count > 0 && (
        <>
          <div className="sl-h">Qaytarishlar</div>
          {returns === null ? <Skeleton height={48} radius={12} /> : (
            <ul className="sl-rets">
              {returns.map((r) => (
                <li key={r.id}>
                  <div><b>{r.product_name}</b> × {fmtQty(r.quantity)}
                    <small>{dateTime(r.created_at)} · {r.employee_name}{r.reason && ` · ${r.reason}`}</small></div>
                  <b className="tone-danger">−{money(r.refund_amount, false)}</b>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <div className="sl-actions">
        {!sale.is_cancelled && sale.items.length > 0 && <Button variant="outline" icon="fa-print" onClick={print}>Chekni qayta chiqarish</Button>}
        {admin && !sale.is_cancelled && <Button variant="danger-soft" icon="fa-ban" loading={busy} onClick={cancel}>Chekni bekor qilish</Button>}
      </div>

      <ReturnModal sale={sale} item={retItem} onClose={() => setRetItem(null)} onDone={() => { onChanged(); loadReturns(); }} />
    </div>
  );
}
