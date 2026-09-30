import { Navigate, useParams } from 'react-router-dom'
import { ReportPage } from './ReportPage'
import { findReportPage } from './reportCatalog'

/** Route `/analysis/:slug` (báo cáo thường) và `/analysis/dashboard/:slug` (dashboard, nằm trong AdminRoute). */
export function ReportRoutePage({ dashboard = false }: { dashboard?: boolean }) {
  const { slug } = useParams()
  const def = findReportPage(slug, dashboard)
  if (!def) return <Navigate to="/workstations" replace />
  // key: đổi trang báo cáo = state control/kết quả mới hoàn toàn (không rò tham số giữa các trang).
  return <ReportPage key={def.id} def={def} />
}
