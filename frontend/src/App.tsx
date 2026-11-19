import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { ConfirmProvider, ToastProvider } from '@/components/ui';
import { AuthPage } from '@/pages/auth/AuthPage';
import { CustomersPage } from '@/pages/customers/CustomersPage';
import { PosPage } from '@/pages/pos/PosPage';
import { SuperDashboard } from '@/pages/superadmin/SuperDashboard';
import { SuperRequests } from '@/pages/superadmin/SuperRequests';
import { SuperStores } from '@/pages/superadmin/SuperStores';
import { getUser } from '@/lib/auth';
import { ReportsPage } from '@/pages/reports/ReportsPage';
import { SalesPage } from '@/pages/sales/SalesPage';
import { SettingsPage } from '@/pages/settings/SettingsPage';
import { AiScanPage } from '@/pages/products/AiScanPage';
import { NewProductPage } from '@/pages/products/NewProductPage';
import { ProductDetailPage } from '@/pages/products/ProductDetailPage';
import { ProductsPage } from '@/pages/products/ProductsPage';
import { SupplyHistoryPage } from '@/pages/products/SupplyHistoryPage';

/**
 * Butun ilova /app/... manzilida. Eski manzillar (/pos, /products, /login ...) server va
 * Service Worker tomonidan shu yerga yo'naltiriladi.
 */
/** Superadmin sahifalari faqat superadmin uchun (do'kon egasi kassaga qaytariladi) */
function SuperOnly({ children }: { children: ReactNode }) {
  return getUser()?.role === 'super_admin' ? <>{children}</> : <Navigate to="/pos" replace />;
}

export function App() {
  return (
    <BrowserRouter basename="/app">
      <ToastProvider>
        <ConfirmProvider>
          <Routes>
            {/* Kirish sahifalari — menyusiz */}
            <Route path="/login" element={<AuthPage />} />
            <Route path="/register" element={<AuthPage />} />
            <Route element={<AppShell><Outlet /></AppShell>}>
              <Route path="/pos" element={<PosPage />} />
              <Route path="/customers" element={<CustomersPage />} />
              <Route path="/sales" element={<SalesPage />} />
              <Route path="/reports" element={<ReportsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/products" element={<ProductsPage />} />
              <Route path="/products/new" element={<NewProductPage />} />
              <Route path="/products/ai" element={<AiScanPage />} />
              <Route path="/products/supply-history" element={<SupplyHistoryPage />} />
              <Route path="/products/:id" element={<ProductDetailPage />} />
              <Route path="/superadmin" element={<SuperOnly><SuperDashboard /></SuperOnly>} />
              <Route path="/superadmin/stores" element={<SuperOnly><SuperStores /></SuperOnly>} />
              <Route path="/superadmin/requests" element={<SuperOnly><SuperRequests /></SuperOnly>} />
              <Route path="*" element={<Navigate to={getUser()?.role === 'super_admin' ? '/superadmin' : '/pos'} replace />} />
            </Route>
          </Routes>
        </ConfirmProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
