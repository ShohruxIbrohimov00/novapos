import { useEffect, useRef } from 'react';

const KEY_GAP_MS = 100;   // skaner belgilari orasidagi maksimal vaqt
const MIN_LEN = 3;

/**
 * USB / Bluetooth shtrix-kod skaneri (klaviatura kabi ishlaydi): tez yozilgan belgilar + Enter.
 * - Raqam kiritiladigan oyna ochiq bo'lsa ([data-scanner-off]) — jim turadi
 *   ("1.5"+Enter yoki "50000"+Enter shtrix-kod deb ushlanmasin).
 * - Maydon fokusda bo'lsa — maydonga yozilgan kod olib tashlanadi, ikki marta qo'shilmaydi.
 * - Har bir skanerlash = bitta tovar (bir xil kod ketma-ket ham qo'shiladi).
 */
export function useScanner(onScan: (code: string) => void) {
  const cb = useRef(onScan);
  cb.current = onScan;

  useEffect(() => {
    let buf = '';
    let last = 0;
    let fast = true;   // hamma belgilar tez kelganmi

    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (document.querySelector('[data-scanner-off]')) { buf = ''; return; }
      const now = performance.now();
      if (now - last > KEY_GAP_MS) { buf = ''; fast = true; }
      else if (buf.length === 0) fast = true;
      last = now;

      if (e.key === 'Enter') {
        const code = buf.trim();
        buf = '';
        if (code.length < MIN_LEN || !fast) return;
        const el = document.activeElement as HTMLInputElement | null;
        if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
          if (!el.value.endsWith(code)) return;          // odam o'zi yozyapti
          // React boshqaradigan maydon: qiymatni "native" setter orqali o'zgartirish kerak,
          // aks holda React eski qiymatni qaytarib qo'yadi
          const proto = el.tagName === 'INPUT' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
          Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, el.value.slice(0, -code.length));
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
        e.preventDefault();
        e.stopImmediatePropagation();
        cb.current(code);
      } else if (e.key.length === 1) {
        buf += e.key;
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);
}
