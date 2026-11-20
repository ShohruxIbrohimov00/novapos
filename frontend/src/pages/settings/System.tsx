import { useEffect, useState } from 'react';
import { openDb } from '@/lib/db';
import { pendingCount, syncOfflineSales } from '@/lib/offlineSales';
import { useTheme } from '@/lib/theme';
import { Button, Switch, useConfirm, useToast } from '@/components/ui';

export function System() {
  const toast = useToast();
  const confirm = useConfirm();
  const [theme, toggleTheme] = useTheme();
  const [pending, setPending] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);

  const refresh = () => pendingCount().then(setPending).catch(() => setPending(0));
  useEffect(() => {
    refresh();
    const on = () => { setOnline(navigator.onLine); refresh(); };
    window.addEventListener('online', on); window.addEventListener('offline', on);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', on); };
  }, []);

  const sync = async () => {
    setSyncing(true);
    try { const n = await syncOfflineSales(); toast.show(n ? `${n} ta sotuv yuborildi` : 'Yuboriladigan sotuv yo\'q', 'success'); }
    catch (e) { toast.show((e as Error).message, 'error'); }
    finally { setSyncing(false); refresh(); }
  };

  const clearCache = async () => {
    const ok = await confirm({ title: 'Keshni tozalash', message: "Tovarlar va sahifalar qayta yuklanadi. Kirish (login) va yuborilmagan sotuvlar saqlanib qoladi.", confirmText: 'Tozalash' });
    if (!ok) return;
    try {
      const db = await openDb();
      for (const sn of ['products_cache', 'customers_cache', 'reports_cache']) {
        if (!db.objectStoreNames.contains(sn)) continue;
        await new Promise<void>((res) => { const tx = db.transaction(sn, 'readwrite'); tx.objectStore(sn).clear(); tx.oncomplete = () => res(); tx.onerror = () => res(); });
      }
    } catch { /* IDB yo'q */ }
    try { const ks = await caches.keys(); await Promise.all(ks.map((k) => caches.delete(k))); } catch { /* yo'q */ }
    toast.show('Kesh tozalandi', 'success');
    setTimeout(() => location.reload(), 600);
  };

  return (
    <section className="st-card" aria-labelledby="st-sys">
      <h2 id="st-sys" className="st-card__title"><i className="fa-solid fa-sliders" aria-hidden="true" /> Tizim</h2>
      <div className="st-row">
        <Switch label="Tungi rejim" hint="Qorong'i fon, ko'zni kamroq charchatadi" checked={theme === 'dark'} onChange={toggleTheme} />
      </div>
      <div className="st-row">
        <span><b>Internet</b><small>{online ? 'Ulangan' : "Yo'q — sotuvlar qurilmada saqlanadi"}</small></span>
        <span className={`st-dot ${online ? 'is-on' : 'is-off'}`} aria-hidden="true" />
      </div>
      <div className="st-row">
        <span><b>Yuborilmagan oflayn sotuvlar</b><small>{pending === null ? '…' : pending ? `${pending} ta navbatda` : 'Hammasi yuborilgan'}</small></span>
        <Button size="sm" variant="outline" icon="fa-rotate" loading={syncing} disabled={!pending || !online} onClick={sync}>Yuborish</Button>
      </div>
      <div className="st-row">
        <span><b>Keshni tozalash</b><small>Ilova g'alati ishlasa yoki eski ma'lumot ko'rinsa</small></span>
        <Button size="sm" variant="ghost" icon="fa-broom" onClick={clearCache}>Tozalash</Button>
      </div>
    </section>
  );
}
