import { useEffect, useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { Button, Field, Modal, useToast } from '@/components/ui';
import type { Customer } from './types';

interface Props {
  open: boolean;
  customer: Customer | null;   // null — yangi mijoz
  onClose: () => void;
  onSaved: (c: Customer) => void;
}

const empty = { full_name: '', phone: '', address: '', notes: '' };

export function CustomerFormModal({ open, customer, onClose, onSaved }: Props) {
  const toast = useToast();
  const [form, setForm] = useState(empty);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(customer
      ? { full_name: customer.full_name, phone: customer.phone ?? '', address: customer.address ?? '', notes: customer.notes ?? '' }
      : empty);
  }, [open, customer]);

  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!form.full_name.trim()) { setError('Ism va familiyani kiriting'); return; }
    setSaving(true);
    const body = {
      full_name: form.full_name.trim(),
      phone: form.phone.trim() || null,
      address: form.address.trim() || null,
      notes: form.notes.trim() || null,
    };
    try {
      const saved = customer
        ? await api<Customer>(`/api/customers/${customer.id}`, 'PATCH', body)
        : await api<Customer>('/api/customers/', 'POST', body);
      toast.show(customer ? "O'zgarishlar saqlandi" : "Mijoz qo'shildi", 'success');
      onSaved(saved);
      onClose();
    } catch (err) {
      toast.show((err as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={customer ? 'Mijozni tahrirlash' : 'Yangi mijoz'} persistent={saving}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Bekor qilish</Button>
        <Button onClick={() => submit()} loading={saving} icon="fa-check">Saqlash</Button>
      </>}>
      <form onSubmit={submit} style={{ display: 'contents' }} noValidate>
        <Field label="Ism va familiya" required value={form.full_name} onChange={set('full_name')}
               error={error} autoComplete="off" maxLength={120} />
        <Field label="Telefon" type="tel" inputMode="tel" placeholder="+998 90 123 45 67" value={form.phone} onChange={set('phone')} />
        <Field label="Manzil" value={form.address} onChange={set('address')} />
        <Field label="Izoh" value={form.notes} onChange={set('notes')} hint="Faqat sizga ko'rinadi" />
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
