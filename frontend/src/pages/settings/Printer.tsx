import { useEffect, useState } from 'react';
import { getUser } from '@/lib/auth';
import { Button, Field, Segmented, useToast } from '@/components/ui';
import { printText, reloadPrinterSettings } from '@/pages/pos/receipt';

type Method = 'auto' | 'rawbt' | 'bluetooth' | 'qztray' | 'browser';

const METHODS: { value: Method; icon: string; title: string; text: string }[] = [
  { value: 'auto', icon: 'fa-wand-magic-sparkles', title: 'Avtomatik', text: 'Qurilmaga qarab o\'zi tanlaydi' },
  { value: 'rawbt', icon: 'fa-android', title: 'RawBT', text: 'Android: USB yoki Bluetooth printer (RawBT ilovasi orqali)' },
  { value: 'bluetooth', icon: 'fa-bluetooth-b', title: 'Bluetooth', text: 'Chrome: printerga to\'g\'ridan-to\'g\'ri ulanish' },
  { value: 'qztray', icon: 'fa-desktop', title: 'QZ Tray', text: 'Kompyuter + USB printer (QZ Tray dasturi kerak)' },
  { value: 'browser', icon: 'fa-print', title: 'Brauzer', text: 'Oddiy chop etish oynasi' },
];

interface PrinterSettings { method?: string; paper_width?: number; bt_device_name?: string | null; [k: string]: unknown }

function read(): PrinterSettings { try { return JSON.parse(localStorage.getItem('printer_settings') || '{}'); } catch { return {}; } }
const ls = (k: string) => { try { return localStorage.getItem(k) ?? ''; } catch { return ''; } };

export function Printer() {
  const toast = useToast();
  const [s0] = useState(read);
  const [method, setMethod] = useState<Method>((METHODS.some((m) => m.value === s0.method) ? s0.method : 'auto') as Method);
  const [paper, setPaper] = useState<number>(s0.paper_width === 48 ? 48 : 32);
  const [name, setName] = useState(() => ls('receipt_store_name') || getUser()?.store_name || '');
  const [footer, setFooter] = useState(() => ls('receipt_footer') || 'Rahmat! Yana keling!');
  const [saved, setSaved] = useState(true);
  const [testing, setTesting] = useState(false);
  useEffect(() => { setSaved(false); }, [method, paper, name, footer]);
  useEffect(() => { setSaved(true); }, []);   // birinchi chizishda "saqlanmagan" deb belgilanmasin

  const save = (quiet = false) => {
    try {
      localStorage.setItem('printer_settings', JSON.stringify({ ...read(), method, paper_width: paper }));
      localStorage.setItem('receipt_store_name', name.trim());
      localStorage.setItem('receipt_footer', footer.trim());
    } catch { toast.show('Brauzer xotirasi yopiq — saqlanmadi', 'error'); return; }
    // Sahifada yuklangan printer moduli yangi sozlamani darhol olsin
    reloadPrinterSettings();
    setSaved(true);
    if (!quiet) toast.show('Printer sozlamalari saqlandi', 'success');
  };

  const test = async () => {
    save(true);
    setTesting(true);
    const W = paper;
    const c = (t: string) => ' '.repeat(Math.max(0, Math.floor((W - t.length) / 2))) + t;
    const lr = (l: string, r: string) => l + ' '.repeat(Math.max(1, W - l.length - r.length)) + r;
    const line = '-'.repeat(W);
    const txt = [c((name || 'NovaPOS').toUpperCase().slice(0, W)), c('SINOV CHEKI'), line, 'Non', lr('  2 x 2 000', '4 000'), 'Cola 1L', lr('  1 x 10 000', '10 000'),
      line, lr('JAMI:', "14 000 so'm"), line, c((footer || '').slice(0, W)), '', ''].join('\n');
    try { await printText(txt); } catch (e) { toast.show((e as Error).message || 'Chop etilmadi', 'error'); }
    finally { setTesting(false); }
  };

  return (
    <section className="st-card" aria-labelledby="st-printer">
      <h2 id="st-printer" className="st-card__title"><i className="fa-solid fa-print" aria-hidden="true" /> Chek printer</h2>
      <div className="st-methods" role="radiogroup" aria-label="Chop etish usuli">
        {METHODS.map((m) => (
          <button key={m.value} type="button" role="radio" aria-checked={method === m.value} className="st-method" onClick={() => setMethod(m.value)}>
            <i className={`fa-${m.value === 'rawbt' || m.value === 'bluetooth' ? 'brands' : 'solid'} ${m.icon}`} aria-hidden="true" />
            <span><b>{m.title}</b><small>{m.text}</small></span>
          </button>
        ))}
      </div>
      {method === 'bluetooth' && <p className="st-muted">"Sinov cheki" bosilganda printer tanlash oynasi chiqadi. {s0.bt_device_name && <>Oxirgi printer: <b>{s0.bt_device_name}</b></>}</p>}
      <Segmented label="Qog'oz kengligi" value={paper} onChange={setPaper}
                 options={[{ value: 32, label: '58 mm' }, { value: 48, label: '80 mm' }]} />
      <Field label="Chek tepasidagi nom" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
      <Field label="Chek pastidagi matn" value={footer} maxLength={80} onChange={(e) => setFooter(e.target.value)} />
      <div className="st-btns st-btns--row">
        <Button variant="outline" icon="fa-receipt" loading={testing} onClick={test}>Sinov cheki</Button>
        <Button icon="fa-check" onClick={() => save()} disabled={saved}>{saved ? 'Saqlangan' : 'Saqlash'}</Button>
      </div>
    </section>
  );
}
