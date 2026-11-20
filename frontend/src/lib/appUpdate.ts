// Yangi versiya chiqqanini aniqlash va yangilash.
//
// Ilova (index.html) o'z versiyasini <meta name="app-version"> da olib keladi, serverdagi
// joriy versiya esa /static/app/version.json da. Farq bo'lsa — "Yangilash" tugmasi chiqadi.
// Service Worker sahifani keshdan beradi (tez ochilish, oflayn), shuning uchun usiz
// do'kondagi telefon eski versiyada qolib ketardi.
import { useCallback, useEffect, useRef, useState } from 'react';

export const VERSION_URL = '/static/app/version.json';
const CHECK_EVERY_MS = 30 * 60_000;   // kun bo'yi ochiq turgan kassa uchun
const MIN_GAP_MS = 60_000;            // tez-tez tekshirmaslik (oyna almashtirilganda)
const SW_REPLY_TIMEOUT_MS = 10_000;

/** Ushbu sahifa qaysi build'dan yuklangan (ishlab chiqish rejimida — null, tekshiruv yo'q) */
export function currentVersion(): string | null {
  return document.querySelector<HTMLMetaElement>('meta[name="app-version"]')?.content || null;
}

/** Serverdagi versiya; internet yo'q yoki xato bo'lsa — null */
export async function fetchServerVersion(): Promise<string | null> {
  try {
    const res = await fetch(VERSION_URL, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.version === 'string' ? data.version : null;
  } catch {
    return null;
  }
}

/**
 * Yangi versiyani o'rnatib, sahifani qayta yuklaydi. Avval Service Worker yangi fayllarni
 * keshga oladi — aks holda qayta yuklashda yana eski (keshdagi) sahifa ochilardi.
 * SW javob bermasa ham (eski brauzer, xato) baribir qayta yuklanadi.
 */
export async function applyUpdate(): Promise<void> {
  const sw = navigator.serviceWorker?.controller;
  if (sw) {
    await new Promise<void>((resolve) => {
      const ch = new MessageChannel();
      const timer = setTimeout(resolve, SW_REPLY_TIMEOUT_MS);
      ch.port1.onmessage = () => { clearTimeout(timer); resolve(); };
      try { sw.postMessage({ type: 'UPDATE_APP' }, [ch.port2]); } catch { clearTimeout(timer); resolve(); }
    });
  }
  location.reload();
}

/** Yangi versiya bormi — sahifa ochilganda, har 30 daqiqada, oynaga qaytilganda va internet tiklanganda */
export function useAppUpdate() {
  const [available, setAvailable] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const last = useRef(0);

  const check = useCallback(async () => {
    const mine = currentVersion();
    if (!mine || !navigator.onLine) return;
    const now = Date.now();
    if (now - last.current < MIN_GAP_MS) return;
    last.current = now;
    // Service Worker faylining o'zi ham yangilanganmi — brauzerga tekshirishni eslatamiz
    navigator.serviceWorker?.getRegistration().then((r) => r?.update()).catch(() => {});
    const server = await fetchServerVersion();
    if (server && server !== mine) {
      setAvailable(true);
      setDismissed(false);   // "Keyinroq" deyilgan bo'lsa ham keyingi tekshiruvda yana eslatiladi
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(check, 5_000);   // ochilish tezligiga xalaqit bermaslik uchun biroz keyin
    const timer = setInterval(check, CHECK_EVERY_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', check);
    return () => {
      clearTimeout(first); clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', check);
    };
  }, [check]);

  return { visible: available && !dismissed, dismiss: () => setDismissed(true), check };
}
