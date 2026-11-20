import { Component, type ErrorInfo, type ReactNode } from 'react';
import { isChunkLoadError, reportError } from '@/lib/errorReport';

interface Props {
  children: ReactNode;
  /** Kalit o'zgarganda (masalan boshqa sahifaga o'tilganda) xato holati tozalanadi */
  resetKey?: string;
}
interface State { error: Error | null }

const RELOAD_FLAG = 'nova_chunk_reload';

/**
 * Sahifada kutilmagan xato bo'lsa — oq ekran o'rniga "Xatolik — qayta yuklash" oynasi.
 * AppShell ichida ishlatiladi: menyu ishlab turadi, boshqa sahifaga o'tish mumkin.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (isChunkLoadError(error)) {
      // Yangi versiya chiqqan, eski sahifa fayli yo'q — bir marta o'zi qayta yuklaydi.
      // (Bayroq cheksiz aylanishdan saqlaydi: 1 daqiqa ichida ikkinchi marta bo'lsa — oyna ko'rsatiladi.)
      let last = 0;
      try { last = Number(sessionStorage.getItem(RELOAD_FLAG)) || 0; } catch { /* yopiq */ }
      if (navigator.onLine && Date.now() - last > 60_000) {
        try { sessionStorage.setItem(RELOAD_FLAG, String(Date.now())); } catch { /* yopiq */ }
        location.reload();
      }
      return;
    }
    reportError(error, info.componentStack ?? '');
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return <CrashScreen error={error} onRetry={() => this.setState({ error: null })} />;
  }
}

function CrashScreen({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const chunk = isChunkLoadError(error);
  const offline = !navigator.onLine;
  const title = chunk ? (offline ? "Sahifa yuklanmadi" : 'Ilova yangilandi') : 'Xatolik yuz berdi';
  const text = chunk
    ? offline
      ? "Bu sahifa hali telefonga saqlanmagan, internet esa yo'q. Internet tiklanganda qayta urinib ko'ring — kassa oflayn ishlashda davom etadi."
      : "Ilovaning yangi versiyasi chiqdi. Davom etish uchun sahifani qayta yuklang."
    : "Bu sahifada kutilmagan xato bo'ldi. Ma'lumotlaringiz (savat, oflayn sotuvlar) saqlangan — sahifani qayta yuklang.";

  return (
    <div className="ui-crash" role="alert">
      <div className="ui-crash__card">
        <div className={`ui-crash__icon${chunk ? ' ui-crash__icon--info' : ''}`}>
          <i className={`fa-solid ${chunk ? (offline ? 'fa-wifi' : 'fa-circle-arrow-up') : 'fa-triangle-exclamation'}`} aria-hidden="true" />
        </div>
        <div className="ui-crash__title">{title}</div>
        <p className="ui-crash__text">{text}</p>
        <div className="ui-crash__actions">
          <button type="button" className="ui-btn ui-btn--primary ui-btn--lg ui-btn--block" onClick={() => location.reload()}>
            <i className="fa-solid fa-arrows-rotate" aria-hidden="true" /> Qayta yuklash
          </button>
          {!chunk && (
            <button type="button" className="ui-btn ui-btn--outline ui-btn--block" onClick={onRetry}>
              Qayta urinish
            </button>
          )}
          <a className="ui-btn ui-btn--ghost ui-btn--block" href="/app/">
            <i className="fa-solid fa-house" aria-hidden="true" /> Bosh sahifaga
          </a>
        </div>
        {!chunk && (
          <details className="ui-crash__details">
            <summary>Texnik ma'lumot</summary>
            <pre>{`${error.name}: ${error.message}`}</pre>
          </details>
        )}
      </div>
    </div>
  );
}
