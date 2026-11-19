import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { ConfirmProvider, ToastProvider } from '@/components/ui';
import { CustomersPage } from '@/pages/customers/CustomersPage';
import { PosPage } from '@/pages/pos/PosPage';

/**
 * React ilovasi /app/... manzilida ishlaydi. Sahifalar bosqichma-bosqich ko'chiriladi;
 * hali ko'chirilmaganlari eski manzilda (menyu ularga oddiy havola bilan olib boradi).
 */
export function App() {
  return (
    <BrowserRouter basename="/app">
      <ToastProvider>
        <ConfirmProvider>
          <AppShell>
            <Routes>
              <Route path="/pos" element={<PosPage />} />
              <Route path="/customers" element={<CustomersPage />} />
              <Route path="*" element={<Navigate to="/pos" replace />} />
            </Routes>
          </AppShell>
        </ConfirmProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
