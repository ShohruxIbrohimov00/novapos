// Brauzerdagi kutilmagan xatolarni serverga yuborish (server logida ko'rinadi).
import { currentVersion } from './appUpdate';

const MAX_PER_SESSION = 5;
let sent = 0;

export function reportError(error: unknown, extra = ''): void {
  if (sent >= MAX_PER_SESSION || !navigator.onLine) return;
  sent++;
  const e = error instanceof Error ? error : new Error(String(error));
  const body = JSON.stringify({
    message: `${e.name}: ${e.message}`.slice(0, 500),
    stack: `${e.stack ?? ''}${extra ? `\n--- komponent ---${extra}` : ''}`.slice(0, 4000),
    url: (location.pathname + location.search).slice(0, 300),
    version: (currentVersion() ?? 'dev').slice(0, 40),
  });
  try {
    fetch('/api/client-errors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true })
      .catch(() => {});
  } catch { /* hisobot yuborilmasa ham ilova ishlashda davom etadi */ }
}

/**
 * Sahifa bo'lagi (chunk) yuklanmadi — odatda server yangilanib, eski fayllar o'chganda
 * yoki internet uzilganda bo'ladi. Bu dastur xatosi emas: qayta yuklash kifoya.
 */
export function isChunkLoadError(error: unknown): boolean {
  const msg = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|ChunkLoadError|Unable to preload CSS/i.test(msg);
}
