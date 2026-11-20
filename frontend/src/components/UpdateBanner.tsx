import { useState } from 'react';
import { applyUpdate, useAppUpdate } from '@/lib/appUpdate';
import { Spinner } from '@/components/ui';

/** "Yangi versiya chiqdi" — ekran tepasida, ishni to'xtatmaydi (savat saqlanib qoladi) */
export function UpdateBanner() {
  const { visible, dismiss } = useAppUpdate();
  const [busy, setBusy] = useState(false);
  if (!visible) return null;

  const update = () => { setBusy(true); applyUpdate(); };

  return (
    <div className="update-banner" role="status" aria-live="polite">
      <i className="fa-solid fa-circle-arrow-up" aria-hidden="true" />
      <span className="update-banner__text">Yangi versiya chiqdi</span>
      <button type="button" className="update-banner__btn" onClick={update} disabled={busy}>
        {busy ? <Spinner /> : null} Yangilash
      </button>
      {!busy && (
        <button type="button" className="update-banner__close" onClick={dismiss} aria-label="Keyinroq" title="Keyinroq">
          <i className="fa-solid fa-xmark" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
