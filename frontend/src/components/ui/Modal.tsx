import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from './Button';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  /** Fon bosilganda yopilmasin (masalan, saqlanmagan forma) */
  persistent?: boolean;
  /** Oyna ochiq paytda USB skaner ham ishlasin (masalan, chek oynasi). Standart: skaner jim */
  allowScanner?: boolean;
}

/**
 * Telefonda pastdan chiqadigan oyna, planshet va kompyuterda markazda.
 * Esc — yopadi, fokus oyna ichida qoladi, orqa fon aylanmaydi.
 */
export function Modal({ open, onClose, title, children, footer, wide, persistent, allowScanner }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);
  // onClose ota komponentda har chizishda yangi bo'lishi mumkin — effekt qayta ishlamasin
  // (aks holda fokus har safar birinchi maydonga sakrab ketadi)
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    lastFocus.current = document.activeElement as HTMLElement;
    const el = ref.current;
    // Birinchi maydonga fokus (yo'q bo'lsa — oynaning o'ziga)
    const first = el?.querySelector<HTMLElement>('input, textarea, select, [data-autofocus]');
    (first ?? el)?.focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      // Faqat eng ustdagi oyna javob beradi (oyna ichida oyna ochilganda)
      const all = document.querySelectorAll('.ui-modal');
      if (all[all.length - 1] !== el) return;
      if (e.key === 'Escape') { e.stopPropagation(); closeRef.current(); return; }
      if (e.key !== 'Tab' || !el) return;
      const items = el.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (!items.length) return;
      const a = items[0], b = items[items.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); b.focus(); }
      else if (!e.shiftKey && document.activeElement === b) { e.preventDefault(); a.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); lastFocus.current?.focus?.({ preventScroll: true }); };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className="ui-modal-backdrop" data-scanner-off={allowScanner ? undefined : ''} onMouseDown={(e) => { if (!persistent && e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className={`ui-modal ${wide ? 'ui-modal--wide' : ''}`} role="dialog" aria-modal="true"
           aria-label={title} tabIndex={-1}>
        <div className="ui-modal__head">
          <h2 className="ui-modal__title">{title}</h2>
          <IconButton icon="fa-xmark" label="Yopish" onClick={onClose} />
        </div>
        <div className="ui-modal__body">{children}</div>
        {footer && <div className="ui-modal__foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
