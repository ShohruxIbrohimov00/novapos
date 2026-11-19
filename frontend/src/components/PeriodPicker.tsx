import { localDate } from '@/lib/format';
import { Field, Tabs } from '@/components/ui';

export type Period = 'today' | 'yesterday' | 'week' | 'month' | 'custom';

export interface PeriodValue { period: Period; from: string; to: string }

export const todayPeriod = (): PeriodValue => ({ period: 'today', from: localDate(), to: localDate() });

/** Davr → [boshlanish, tugash] (YYYY-MM-DD, qurilmaning mahalliy sanasi, ikkalasi ham kiradi) */
export function periodRange({ period, from, to }: PeriodValue): [string, string] {
  const t = new Date();
  const d = (days: number) => localDate(new Date(t.getFullYear(), t.getMonth(), t.getDate() - days));
  if (period === 'today') return [d(0), d(0)];
  if (period === 'yesterday') return [d(1), d(1)];
  if (period === 'week') return [d(6), d(0)];
  if (period === 'month') return [localDate(new Date(t.getFullYear(), t.getMonth(), 1)), d(0)];
  return [from || d(0), to || from || d(0)];
}

const LABEL: Record<Period, string> = { today: 'Bugun', yesterday: 'Kecha', week: '7 kun', month: 'Shu oy', custom: 'Sana' };

/** Sarlavhada ko'rsatish uchun: "Bugun", "01.11 – 19.11" */
export function periodLabel(v: PeriodValue): string {
  if (v.period !== 'custom') return LABEL[v.period];
  const [a, b] = periodRange(v);
  const f = (s: string) => s.split('-').reverse().slice(0, 2).join('.');
  return a === b ? f(a) : `${f(a)} – ${f(b)}`;
}

export function PeriodTabs({ value, onChange }: { value: PeriodValue; onChange: (v: PeriodValue) => void }) {
  return (
    <div className="period-tabs">
      <Tabs label="Davr" value={value.period} onChange={(period) => onChange({ ...value, period })}
            items={(Object.keys(LABEL) as Period[]).map((p) => ({ value: p, label: LABEL[p] }))} />
    </div>
  );
}

export function PeriodDates({ value, onChange }: { value: PeriodValue; onChange: (v: PeriodValue) => void }) {
  if (value.period !== 'custom') return null;
  return (
    <div className="period-dates">
      <Field type="date" label="Dan" value={value.from} max={value.to || undefined} onChange={(e) => onChange({ ...value, from: e.target.value })} />
      <Field type="date" label="Gacha" value={value.to} min={value.from || undefined} onChange={(e) => onChange({ ...value, to: e.target.value })} />
    </div>
  );
}
