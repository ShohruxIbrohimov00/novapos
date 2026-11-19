import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { isAdmin } from '@/lib/auth';
import type { Category } from '@/lib/products';
import { Button, EmptyState, Field, IconButton, Modal, useConfirm, useToast } from '@/components/ui';

interface Props {
  open: boolean;
  onClose: () => void;
  categories: Category[];
  /** Har bir kategoriyada nechta tovar borligi (ixtiyoriy) */
  counts?: Record<number, number>;
  onChanged: () => void | Promise<void>;
  /** Tanlash rejimi: kategoriya bosilsa tanlanadi va oyna yopiladi */
  onPick?: (c: Category) => void;
}

export function CategoriesModal({ open, onClose, categories, counts, onChanged, onPick }: Props) {
  const toast = useToast();
  const confirm = useConfirm();
  const admin = isAdmin();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) { setName(''); setErr(null); } }, [open]);

  const add = async () => {
    const n = name.trim();
    if (!n) { setErr('Nomini yozing'); inputRef.current?.focus(); return; }
    if (categories.some((c) => c.name.toLowerCase() === n.toLowerCase())) { setErr('Bunday kategoriya bor'); return; }
    setBusy(true); setErr(null);
    try {
      const c = await api<Category>('/api/products/categories', 'POST', { name: n });
      await onChanged();
      toast.show(`"${n}" qo'shildi`, 'success');
      setName('');
      if (onPick) { onPick(c); onClose(); } else inputRef.current?.focus();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Saqlanmadi');
    } finally { setBusy(false); }
  };

  const remove = async (c: Category) => {
    const n = counts?.[c.id] ?? 0;
    const ok = await confirm({
      title: "Kategoriyani o'chirish",
      message: n ? `"${c.name}" o'chiriladi. Undagi ${n} ta tovar "Kategoriyasiz" bo'lib qoladi.` : `"${c.name}" o'chirilsinmi?`,
      confirmText: "O'chirish", danger: true,
    });
    if (!ok) return;
    try {
      await api(`/api/products/categories/${c.id}`, 'DELETE');
      await onChanged();
      toast.show(`"${c.name}" o'chirildi`, 'success');
    } catch (e) { toast.show(e instanceof ApiError ? e.message : "O'chirib bo'lmadi", 'error'); }
  };

  return (
    <Modal open={open} onClose={onClose} title={onPick ? 'Kategoriya tanlash' : 'Kategoriyalar'}>
      <form className="inv-catadd" onSubmit={(e) => { e.preventDefault(); add(); }} noValidate>
        <Field ref={inputRef} placeholder="Yangi kategoriya nomi" value={name} error={err} aria-label="Yangi kategoriya nomi"
               onChange={(e) => { setName(e.target.value); setErr(null); }} maxLength={60} />
        <Button type="submit" icon="fa-plus" loading={busy}>Qo'shish</Button>
      </form>
      {!categories.length ? (
        <EmptyState icon="fa-tags" title="Kategoriya yo'q" text="Masalan: Ichimliklar, Non mahsulotlari, Gigiyena" />
      ) : (
        <ul className="inv-catlist">
          {categories.map((c) => (
            <li key={c.id} className="inv-catlist__row">
              {onPick ? (
                <button type="button" className="inv-catlist__pick" onClick={() => { onPick(c); onClose(); }}>
                  <i className="fa-solid fa-tag" aria-hidden="true" /> {c.name}
                </button>
              ) : (
                <span className="inv-catlist__name"><i className="fa-solid fa-tag" aria-hidden="true" /> {c.name}</span>
              )}
              {counts && <span className="inv-catlist__count">{counts[c.id] ?? 0} ta</span>}
              {admin && !onPick && <IconButton icon="fa-trash-can" label={`${c.name} — o'chirish`} className="inv-danger-icon" onClick={() => remove(c)} />}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
