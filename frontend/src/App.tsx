import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { ConfirmProvider, ToastProvider } from '@/components/ui';
import { AuthPage } from '@/pages/auth/AuthPage';
import { CustomersPage } from '@/pages/customers/CustomersPage';
import { PosPage } from '@/pages/pos/PosPage';
import { ReportsPage } from '@/pages/reports/ReportsPage';
import { SalesPage } from '@/pages/sales/SalesPage';
import { SettingsPage } from '@/pages/settings/SettingsPage';
import { AiScanPage } from '@/pages/products/AiScanPage';
import { NewProductPage } from '@/pages/products/NewProductPage';
import { ProductDetailPage } from '@/pages/products/ProductDetailPage';
import { ProductsPage } from '@/pages/products/ProductsPage';
import { SupplyHistoryPage } from '@/pages/products/SupplyHistoryPage';

/**
 * React ilovasi /app/... manzilida ishlaydi. Sahifalar bosqichma-bosqich ko'chiriladi;
 * hali ko'chirilmaganlari eski manzilda (menyu ularga oddiy havola bilan olib boradi).
 */
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
              <Route path="*" element={<Navigate to="/pos" replace />} />
            </Route>
          </Routes>
        </ConfirmProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
