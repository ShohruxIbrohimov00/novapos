import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

type Tone = 'success' | 'error' | 'warning' | 'info';
interface ToastItem { id: number; text: string; tone: Tone }
interface ToastApi { show: (text: string, tone?: Tone) => void }

const ToastCtx = createContext<ToastApi>({ show: () => {} });
const ICON: Record<Tone, string> = { success: 'fa-circle-check', error: 'fa-circle-xmark', warning: 'fa-triangle-exclamation', info: 'fa-circle-info' };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const show = useCallback((text: string, tone: Tone = 'info') => {
    const id = ++seq.current;
    // Bir vaqtda ko'pi bilan 3 ta; xato ko'proq turadi
    setItems((l) => [...l.slice(-2), { id, text, tone }]);
    setTimeout(() => setItems((l) => l.filter((t) => t.id !== id)), tone === 'error' ? 4500 : 2800);
  }, []);

  const api = useMemo(() => ({ show }), [show]);
  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="ui-toast-region" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`ui-toast ui-toast--${t.tone}`}>
            <i className={`fa-solid ${ICON[t.tone]}`} aria-hidden="true" />
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
