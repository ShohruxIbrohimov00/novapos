import { useState } from 'react';
import { dateTime, money, qty } from '@/lib/format';
import { Button, Modal, useToast } from '@/components/ui';
import { printText, receiptFooter, receiptText, storeName, type ReceiptData } from './receipt';
import { isWeight, lineTotal, UNIT_SHORT } from './types';

const METHOD = { naqd: 'Naqd', plastik: 'Plastik karta', nasiya: 'Nasiya' } as const;

/** Sotuvdan keyin: chek ko'rinishi, chop etish, yangi sotuv. Skaner ishlaydi — yangi tovar oynani yopadi. */
export function ReceiptModal({ receipt, onClose }: { receipt: ReceiptData | null; onClose: () => void }) {
  const toast = useToast();
  const [printing, setPrinting] = useState(false);
  if (!receipt) return null;
  const change = receipt.method === 'naqd' ? receipt.paid - receipt.total : 0;
  const debt = receipt.method === 'nasiya' ? receipt.total - receipt.paid : 0;

  const print = async () => {
    setPrinting(true);
    try { await printText(receiptText(receipt)); }
    catch (e) { toast.show((e as Error).message, 'error'); }
    finally { setPrinting(false); }
  };

  return (
    <Modal open onClose={onClose} title={receipt.offline ? 'Sotuv saqlandi (internetsiz)' : 'Sotuv yakunlandi'} allowScanner
      footer={<>
        <Button variant="ghost" icon="fa-print" loading={printing} onClick={print}>Chek chiqarish</Button>
        <Button icon="fa-plus" onClick={onClose} data-autofocus>Yangi sotuv</Button>
      </>}>
      {receipt.offline && (
        <p className="rc-offline" role="status">
          <i className="fa-solid fa-wifi" aria-hidden="true" /> Internet qaytganda serverga avtomatik yuboriladi
        </p>
      )}
      <div className="rc-paper">
        <div className="rc-paper__head">
          <b>{storeName()}</b>
          <span>{dateTime(receipt.date)}</span>
          <span>Chek #{receipt.number}</span>
        </div>
        <ul className="rc-paper__items">
          {receipt.items.map((i) => (
            <li key={i.id}>
              <div>
                <span>{i.name}</span>
                <small>{isWeight(i.unit) ? `${qty(i.qty)} ${UNIT_SHORT[i.unit]}` : qty(i.qty)} × {money(i.price, false)}</small>
              </div>
              <b>{money(lineTotal(i), false)}</b>
            </li>
          ))}
        </ul>
        <dl className="rc-paper__sum">
          <div><dt>Jami</dt><dd>{money(receipt.total)}</dd></div>
          <div><dt>To'lov</dt><dd>{METHOD[receipt.method]}</dd></div>
          {receipt.customer && <div><dt>Mijoz</dt><dd>{receipt.customer}</dd></div>}
          {receipt.paid > 0 && <div><dt>To'landi</dt><dd>{money(receipt.paid)}</dd></div>}
          {change > 0 && <div className="is-change"><dt>Qaytim</dt><dd>{money(change)}</dd></div>}
          {debt > 0 && <div className="is-debt"><dt>Qarzga</dt><dd>{money(debt)}</dd></div>}
        </dl>
        <p className="rc-paper__foot">{receiptFooter()}</p>
      </div>
    </Modal>
  );
}
