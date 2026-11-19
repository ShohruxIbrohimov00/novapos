import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '@/lib/api';
import { isAdmin } from '@/lib/auth';
import { useAsync } from '@/lib/useAsync';
import { Page } from '@/components/ui';
import { Profile, StoreSection } from './Account';
import { Employees } from './Employees';
import { Printer } from './Printer';
import { Subscription } from './Subscription';
import { System } from './System';
import type { Me, StoreInfo } from './types';
import '../products/products.css';
import '../sales/sales.css';
import '../reports/reports.css';
import './settings.css';

export function SettingsPage() {
  const loc = useLocation();
  const admin = isAdmin();
  const me = useAsync(() => api<Me>('/api/auth/me'));
  const store = useAsync(() => api<StoreInfo>('/api/stores/me'));

  // /settings#obuna — obuna tugaganda shu yerga yo'naltiriladi
  useEffect(() => {
    if (loc.hash !== '#obuna' || !me.data) return;
    document.getElementById('obuna')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [loc.hash, me.data]);

  return (
    <Page title="Sozlamalar" sub={store.data?.name ?? undefined}>
      <div className="st-grid">
        <div className="st-col">
          <Profile me={me.data} />
          <Subscription me={me.data} onChanged={me.reload} />
          <StoreSection store={store.data} onSaved={(s) => store.setData(s)} />
        </div>
        <div className="st-col">
          {admin && <Employees />}
          <Printer />
          <System />
        </div>
      </div>
    </Page>
  );
}
