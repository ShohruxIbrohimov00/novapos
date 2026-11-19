import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { qty } from '@/lib/format';
import { UNITS, type Product, type Unit } from '@/lib/products';
import { useToast } from '@/components/ui';

/** Har bir o'lchov birligida eng ko'p uchraydigan limit */
export function currentLimits(products: Product[]): Partial<Record<Unit, number>> {
  const freq: Partial<Record<Unit, Map<number, number>>> = {};
  for (const p of products) {
    const m = (freq[p.unit_type] ??= new Map());
    const v = p.min_stock_limit ?? 0;
    m.set(v, (m.get(v) ?? 0) + 1);
  }
  const out: Partial<Record<Unit, number>> = {};
  for (const [u, m] of Object.entries(freq) as [Unit, Map<number, number>][]) {
    out[u] = [...m.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }
  return out;
}

/**
 * "Kam qoldi" chegarasi — birlik bo'yicha hamma tovarga birdan.
 * Tugma bosilganda darhol ko'rinadi, serverga esa 0.6 soniyadan keyin bitta so'rov ketadi.
 */
export function LimitsPanel({ products, onSaved }: { products: Product[]; onSaved: () => void }) {
  const toast = useToast();
  const server = useMemo(() => currentLimits(products), [products]);
  const [local, setLocal] = useState<Partial<Record<Unit, number>>>({});
  const timers = useRef<Partial<Record<Unit, number>>>({});

  useEffect(() => () => { Object.values(timers.current).forEach((t) => clearTimeout(t)); }, []);

  const units = UNITS.filter((u) => server[u.value] !== undefined);
  if (!units.length) return null;

  const change = (u: Unit, step: number) => {
    const base = local[u] ?? server[u] ?? 0;
    const next = Math.max(0, Math.round(base + step));
    setLocal((l) => ({ ...l, [u]: next }));
    clearTimeout(timers.current[u]);
    timers.current[u] = window.setTimeout(async () => {
      try {
        const r = await api<{ updated_count: number }>(`/api/products/bulk-update-limits?unit=${u}&new_limit=${next}`, 'POST');
        toast.show(`${u}: chegara ${qty(next)} — ${r.updated_count} ta tovar`, 'success');
        onSaved();
      } catch (e) {
        toast.show((e as Error).message, 'error');
        setLocal((l) => { const c = { ...l }; delete c[u]; return c; });
      }
    }, 600);
  };

  return (
    <div className="inv-limits">
      <div className="inv-side__title">"Kam qoldi" chegarasi</div>
      <p className="inv-limits__hint">Qoldiq shu songa tushganda tovar qizil bo'ladi</p>
      {units.map((u) => {
        const v = local[u.value] ?? server[u.value] ?? 0;
        return (
          <div key={u.value} className="inv-limit">
            <span className="inv-limit__unit">{u.label}</span>
            <div className="inv-limit__ctrl">
              <button type="button" className="inv-limit__btn" onClick={() => change(u.value, -1)} disabled={v <= 0}
                      aria-label={`${u.label} chegarasini kamaytirish`}>−</button>
              <output className="inv-limit__val" aria-live="polite">{qty(v)}</output>
              <button type="button" className="inv-limit__btn" onClick={() => change(u.value, 1)}
                      aria-label={`${u.label} chegarasini oshirish`}>+</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
