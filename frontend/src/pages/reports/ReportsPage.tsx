import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { isAdmin } from '@/lib/auth';
import { EmptyState, Page, Tabs } from '@/components/ui';
import { PeriodDates, periodLabel, periodRange, PeriodTabs, todayPeriod, type PeriodValue } from '@/components/PeriodPicker';
import { Debtors } from './Debtors';
import { Expenses } from './Expenses';
import { Overview } from './Overview';
import { Suppliers } from './Suppliers';
import '../products/products.css';
import '../customers/customers.css';
import '../sales/sales.css';
import './reports.css';

type Tab = 'overview' | 'expenses' | 'debtors' | 'suppliers';
const TABS: { value: Tab; label: string }[] = [
  { value: 'overview', label: 'Umumiy' },
  { value: 'expenses', label: 'Chiqimlar' },
  { value: 'debtors', label: 'Qarzdorlar' },
  { value: 'suppliers', label: "Ta'minotchilar" },
];

export function ReportsPage() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((t) => t.value === params.get('t')) ? params.get('t') : 'overview') as Tab;
  const [period, setPeriod] = useState<PeriodValue>(todayPeriod);
  const [start, end] = periodRange(period);
  const qs = `start_date=${start}&end_date=${end}`;
  const usesPeriod = tab === 'overview' || tab === 'expenses';

  if (!isAdmin()) {
    return (
      <Page title="Hisobot">
        <EmptyState icon="fa-lock" title="Hisobot faqat do'kon egasi uchun" text="Foyda va chiqimlarni administrator ko'radi" />
      </Page>
    );
  }

  const go = (t: Tab) => setParams(t === 'overview' ? {} : { t }, { replace: true });

  return (
    <Page title="Hisobot" sub={usesPeriod ? periodLabel(period) : 'Hozirgi holat'}
          toolbar={<>
            <div className="sl-toprow">
              <div className="period-tabs"><Tabs label="Bo'lim" value={tab} onChange={go} items={TABS} /></div>
              {usesPeriod && <PeriodTabs value={period} onChange={setPeriod} />}
            </div>
            {usesPeriod && <PeriodDates value={period} onChange={setPeriod} />}
          </>}>
      {tab === 'overview' && <Overview qs={qs} onGo={go} />}
      {tab === 'expenses' && <Expenses qs={qs} label={periodLabel(period).toLowerCase()} />}
      {tab === 'debtors' && <Debtors />}
      {tab === 'suppliers' && <Suppliers />}
    </Page>
  );
}
