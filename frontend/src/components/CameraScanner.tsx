import { useEffect, useRef, useState } from 'react';
import { Modal } from '@/components/ui';

interface Html5QrcodeInstance {
  start: (cam: unknown, cfg: unknown, ok: (text: string) => void, err: () => void) => Promise<void>;
  stop: () => Promise<void>;
  pause: (v?: boolean) => void;
  resume: () => void;
}
declare global { interface Window { Html5Qrcode?: new (id: string) => Html5QrcodeInstance } }

let libLoading: Promise<void> | null = null;
function loadLib(): Promise<void> {
  if (window.Html5Qrcode) return Promise.resolve();
  libLoading ??= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = '/static/vendor/html5-qrcode.min.js';
    s.onload = () => res(); s.onerror = () => { libLoading = null; rej(new Error('Skaner kutubxonasi yuklanmadi')); };
    document.head.appendChild(s);
  });
  return libLoading;
}

/** Telefon/planshet kamerasi bilan shtrix-kod o'qish. Bitta kod — bitta tovar (1.2 s pauza). */
export function CameraScanner({ open, onClose, onScan }: { open: boolean; onClose: () => void; onScan: (code: string) => void }) {
  const [error, setError] = useState<string | null>(null);
  const scanRef = useRef(onScan);
  scanRef.current = onScan;

  useEffect(() => {
    if (!open) return;
    let qr: Html5QrcodeInstance | null = null;
    let stopped = false;
    setError(null);
    loadLib().then(() => {
      if (stopped || !window.Html5Qrcode) return;
      qr = new window.Html5Qrcode('cam-reader');
      return qr.start({ facingMode: 'environment' }, { fps: 12, qrbox: { width: 260, height: 120 } }, (text) => {
        qr?.pause(true);
        scanRef.current(text.trim());
        setTimeout(() => { try { qr?.resume(); } catch { /* to'xtatilgan */ } }, 1200);
      }, () => {});
    }).catch((e: unknown) => {
      setError(String(e).includes('Permission') ? "Kameraga ruxsat berilmadi. Brauzer sozlamalaridan ruxsat bering." : 'Kamerani ochib bo\'lmadi');
    });
    return () => { stopped = true; qr?.stop().catch(() => {}); };
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title="Kamera bilan skanerlash">
      {error ? <p className="co-error" role="alert">{error}</p> : <div id="cam-reader" className="cam-reader" />}
      <p className="co-hint">Shtrix-kodni ramka ichiga keltiring. Tovar savatga qo'shilgach, keyingisini skanerlang.</p>
    </Modal>
  );
}
