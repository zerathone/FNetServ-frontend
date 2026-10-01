// Khối trên bảng của income-by-staff: Segmented chuyển giữa "Thống kê" (card từng nhân viên)
// và "Biểu đồ" (2 bar chart ngang). Bảng dữ liệu bên dưới không đổi.

import { useState } from 'react'
import { Segmented, type SegmentedOption } from '../../design-system/components'
import { IncomeByStaffCharts } from './IncomeByStaffCharts'
import { IncomeByStaffStats } from './IncomeByStaffStats'

type ViewMode = 'stats' | 'charts'

const VIEW_OPTIONS: readonly SegmentedOption<ViewMode>[] = [
  { value: 'stats', label: 'Thống kê' },
  { value: 'charts', label: 'Biểu đồ' },
]

// allStaff: báo cáo đang xem TẤT CẢ nhân viên (staffid = 0) -> biểu đồ so sánh các nhân viên với nhau.
export function IncomeByStaffPanel({ data, allData, allStaff }: { data: unknown; allData?: unknown; allStaff: boolean }) {
  const [mode, setMode] = useState<ViewMode>('stats')

  // Không có dữ liệu thì cả hai chế độ đều không vẽ gì — ẩn luôn Segmented cho gọn.
  if (!Array.isArray(data) || data.length === 0) return null

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ marginBottom: 12 }}>
        <Segmented value={mode} options={VIEW_OPTIONS} onChange={setMode} ariaLabel="Chế độ xem" />
      </div>
      {mode === 'stats' ? <IncomeByStaffStats data={data} /> : <IncomeByStaffCharts data={data} allData={allData} allStaff={allStaff} />}
    </div>
  )
}
