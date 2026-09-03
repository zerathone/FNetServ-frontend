import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AdminRoute } from '../components/AdminRoute'
import { AuthGuard } from '../components/AuthGuard'
import { DebugMonitor } from '../components/DebugMonitor'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { MainLayout } from '../layouts/MainLayout'

const LoginPage = lazy(() =>
  import('../pages/LoginPage').then((module) => ({ default: module.LoginPage })),
)
const WorkstationsPage = lazy(() =>
  import('../features/workstations/WorkstationWorkspace').then((module) => ({
    default: module.WorkstationWorkspace,
  })),
)
const OrderQueuePage = lazy(() =>
  import('../features/orders/OrderWorkspace').then((module) => ({
    default: module.OrderWorkspace,
  })),
)
const LegacyOrderQueuePage = lazy(() =>
  import('../pages/OrderQueuePage').then((module) => ({
    default: module.OrderQueuePage,
  })),
)
const PaymentPage = lazy(() =>
  import('../features/checkout/CheckoutWorkspace').then((module) => ({
    default: module.CheckoutWorkspace,
  })),
)
const UsersPage = lazy(() =>
  import('../features/customers/CustomerWorkspace').then((module) => ({
    default: module.CustomerWorkspace,
  })),
)
const LegacyUsersPage = lazy(() =>
  import('../pages/UsersPage').then((module) => ({ default: module.UsersPage })),
)
const VoucherLogPage = lazy(() =>
  import('../features/transactions/TransactionWorkspace').then((module) => ({
    default: module.TransactionWorkspace,
  })),
)
const SystemLogPage = lazy(() =>
  import('../pages/SystemLogPage').then((module) => ({ default: module.SystemLogPage })),
)
const AppsPage = lazy(() =>
  import('../pages/AppsPage').then((module) => ({ default: module.AppsPage })),
)
const CardsPage = lazy(() =>
  import('../features/cards/CardWorkspace').then((module) => ({
    default: module.CardWorkspace,
  })),
)
const AnonymsPage = lazy(() =>
  import('../features/anonyms/AnonymWorkspace').then((module) => ({
    default: module.AnonymWorkspace,
  })),
)
const ServicesPage = lazy(() =>
  import('../features/services/ServiceCatalogWorkspace').then((module) => ({
    default: module.ServiceCatalogWorkspace,
  })),
)
const CombosPage = lazy(() =>
  import('../features/combos/ComboWorkspace').then((module) => ({
    default: module.ComboWorkspace,
  })),
)
const ReportsPage = lazy(() =>
  import('../pages/ReportsPage').then((module) => ({ default: module.ReportsPage })),
)
const DynamicReportPage = lazy(() =>
  import('../pages/DynamicReportPage').then((module) => ({ default: module.DynamicReportPage })),
)
const PrinterSettingsPage = lazy(() =>
  import('../pages/PrinterSettingsPage').then((module) => ({
    default: module.PrinterSettingsPage,
  })),
)
const SettingsPage = lazy(() =>
  import('../pages/SettingsPage').then((module) => ({ default: module.SettingsPage })),
)
const ServerLogPage = lazy(() =>
  import('../pages/ServerLogPage').then((module) => ({ default: module.ServerLogPage })),
)
const WebHistoryPage = lazy(() =>
  import('../pages/WebHistoryPage').then((module) => ({ default: module.WebHistoryPage })),
)
const MachineGroupsPage = lazy(() =>
  import('../pages/MachineGroupsPage').then((module) => ({
    default: module.MachineGroupsPage,
  })),
)
const UserGroupsPage = lazy(() =>
  import('../pages/UserGroupsPage').then((module) => ({ default: module.UserGroupsPage })),
)
const StaffRightsPage = lazy(() =>
  import('../pages/StaffRightsPage').then((module) => ({ default: module.StaffRightsPage })),
)
const WebBlockPage = lazy(() =>
  import('../pages/WebBlockPage').then((module) => ({ default: module.WebBlockPage })),
)
const PromotionPage = lazy(() =>
  import('../pages/PromotionPage').then((module) => ({ default: module.PromotionPage })),
)
const ComponentCatalogPage = lazy(() =>
  import('../pages/ComponentCatalogPage').then((module) => ({
    default: module.ComponentCatalogPage,
  })),
)
const CustomerQrDisplay = lazy(() =>
  import('../features/payments/CustomerQrDisplay').then((module) => ({
    default: module.CustomerQrDisplay,
  })),
)

function RouteLoading() {
  return (
    <div className="route-loading" role="status" aria-label="Đang tải trang">
      <span className="route-loading__spinner" aria-hidden="true" />
    </div>
  )
}

function ProtectedRoutes() {
  return (
    <MainLayout>
      <Suspense fallback={<RouteLoading />}>
        <Routes>
          <Route path="/" element={<Navigate to="/workstations" replace />} />
          <Route path="/workstations" element={<WorkstationsPage />} />
          <Route path="/orders" element={<OrderQueuePage />} />
          <Route path="/payments" element={<PaymentPage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/logs/voucher" element={<VoucherLogPage />} />
          <Route path="/logs/system" element={<SystemLogPage />} />

          <Route element={<AdminRoute />}>
            <Route path="/apps" element={<AppsPage />} />
            <Route path="/cards" element={<CardsPage />} />
            <Route path="/anonyms" element={<AnonymsPage />} />
            <Route path="/services" element={<ServicesPage />} />
            <Route path="/combos" element={<CombosPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/dynamic-reports" element={<DynamicReportPage />} />
            <Route path="/printers" element={<PrinterSettingsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/logs/server" element={<ServerLogPage />} />
            <Route path="/logs/webhistory" element={<WebHistoryPage />} />
            <Route path="/machine-groups" element={<MachineGroupsPage />} />
            <Route path="/user-groups" element={<UserGroupsPage />} />
            <Route path="/users/legacy" element={<LegacyUsersPage />} />
            <Route path="/orders/legacy" element={<LegacyOrderQueuePage />} />
            <Route path="/staff-rights" element={<StaffRightsPage />} />
            <Route path="/promotions" element={<PromotionPage />} />
            <Route path="/webblock" element={<WebBlockPage />} />
            <Route path="/ui-catalog" element={<ComponentCatalogPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/workstations" replace />} />
        </Routes>
      </Suspense>
    </MainLayout>
  )
}

export function AppRouter() {
  return (
    <>
      <ErrorBoundary>
        <Suspense fallback={<RouteLoading />}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/customer-qr" element={<CustomerQrDisplay />} />
            <Route element={<AuthGuard />}>
              <Route path="/*" element={<ProtectedRoutes />} />
            </Route>
          </Routes>
        </Suspense>
      </ErrorBoundary>
      <DebugMonitor />
    </>
  )
}
