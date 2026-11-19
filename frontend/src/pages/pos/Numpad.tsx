/** Ekrandagi raqam tugmalari (planshet va sensorli kassa uchun) */
export function Numpad({ onKey, decimal = true }: { onKey: (k: string) => void; decimal?: boolean }) {
  const keys = ['7', '8', '9', '4', '5', '6', '1', '2', '3', decimal ? '.' : '00', '0', '⌫'];
  return (
    <div className="numpad" role="group" aria-label="Raqam tugmalari">
      {keys.map((k) => (
        <button key={k} type="button" className={`numpad__key${k === '⌫' ? ' numpad__key--del' : ''}`}
                onClick={() => onKey(k)} aria-label={k === '⌫' ? "O'chirish" : k}>
          {k}
        </button>
      ))}
    </div>
  );
}

/** Raqamli satrga tugma bosishni qo'llash */
export function applyKey(buf: string, k: string, maxDecimals = 3): string {
  if (k === '⌫') return buf.slice(0, -1);
  if (k === 'C') return '';
  if (k === '.' || k === ',') return buf.includes('.') ? buf : (buf || '0') + '.';
  if (k === '00') return buf && buf !== '0' ? buf + '00' : buf;
  if (!/^\d$/.test(k)) return buf;
  const dot = buf.indexOf('.');
  if (dot >= 0 && buf.length - dot > maxDecimals) return buf;
  return buf === '0' ? k : buf + k;
}
