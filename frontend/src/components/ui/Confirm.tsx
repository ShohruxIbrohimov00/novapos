import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Button } from './Button';
import { Modal } from './Modal';

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmText: string;
  cancelText?: string;
  danger?: boolean;
}
type ConfirmFn = (o: ConfirmOptions) => Promise<boolean>;

const Ctx = createContext<ConfirmFn>(async () => false);

/** Tasdiqlash oynasi: `if (await confirm({...})) ...` */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<(v: boolean) => void>();

  const confirm = useCallback<ConfirmFn>((o) => new Promise((resolve) => { resolver.current = resolve; setOpts(o); }), []);
  const close = (v: boolean) => { resolver.current?.(v); resolver.current = undefined; setOpts(null); };

  return (
    <Ctx.Provider value={confirm}>
      {children}
      <Modal open={!!opts} onClose={() => close(false)} title={opts?.title ?? ''}
        footer={<>
          <Button variant="ghost" onClick={() => close(false)}>{opts?.cancelText ?? 'Bekor qilish'}</Button>
          <Button variant={opts?.danger ? 'danger' : 'primary'} onClick={() => close(true)} data-autofocus>
            {opts?.confirmText}
          </Button>
        </>}>
        {opts?.message && <p style={{ color: 'var(--text2)' }}>{opts.message}</p>}
      </Modal>
    </Ctx.Provider>
  );
}

export const useConfirm = () => useContext(Ctx);
