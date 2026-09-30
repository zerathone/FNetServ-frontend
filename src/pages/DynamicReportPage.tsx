import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchDynamicReport } from '../api/dynamic-reports'
import { Button, Select, DateRangePicker } from '../design-system/components'
import { ReportResultView } from '../features/reports/ReportResultView'

// Ngày LOCAL (toISOString lệch múi giờ: trước 7h sáng giờ VN sẽ ra ngày hôm trước).
function getToday() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

const REPORT_STALE_MS = 5 * 60 * 1000

// Chi liet ke report co trong map_file_report (ServerSide_ai/ReportUtils.cpp:653) --
// day la nguon su that cho biet report nao THAT SU sinh du lieu qua /rptv2. Cac id bi
// loai (14,16-24,29,30) khong co trong map do: 14/29/30 khong co trong map_report cua
// MakeData() (ReportUtils.cpp:836) nen luon that bai; 16-24 co trong map_report nhung
// chi `return TRUE;` khong goi ham sinh du lieu nao (ReportUtils.cpp:878-882) nen luon
// tra ve rong -- ca hai truong hop deu vo nghia tren combobox WebUI.
// Nhan dashboard 34-40: user chot 2026-09-30 (task web-report-params, handoff 4.6).
const REPORT_TYPES = [
  { id: 1, label: 'Báo cáo 1: DAILY CASH' },
  { id: 2, label: 'Báo cáo 2: DAILY CASH ALL' },
  { id: 3, label: 'Báo cáo 3: WEEKLY CASH' },
  { id: 4, label: 'Báo cáo 4: WEEKLY CASH ALL' },
  { id: 5, label: 'Báo cáo 5: MONTHLY CASH' },
  { id: 6, label: 'Báo cáo 6: MONTHLY CASH ALL' },
  { id: 7, label: 'Báo cáo 7: SERVICE IN DAY' },
  { id: 8, label: 'Báo cáo 8: SERVICE IN DAY ALL' },
  { id: 9, label: 'Báo cáo 9: SERVICE IN MONTH' },
  { id: 10, label: 'Báo cáo 10: SERVICE IN MONTH ALL' },
  { id: 11, label: 'Báo cáo 11: CASH MACHINE' },
  { id: 12, label: 'Báo cáo 12: FREE TIME' },
  { id: 13, label: 'Báo cáo 13: FREE MONEY' },
  { id: 15, label: 'Báo cáo 15: ACCOUNT DEBIT' },
  { id: 25, label: 'Báo cáo 25: CARD RECHARGE IN DAY' },
  { id: 26, label: 'Báo cáo 26: CARD RECHARGE IN DAY ALL' },
  { id: 27, label: 'Báo cáo 27: CARD RECHARGE IN MONTH' },
  { id: 28, label: 'Báo cáo 28: CARD RECHARGE IN MONTH ALL' },
  { id: 31, label: 'Báo cáo 31: TIME AND MONEY USED MEMBER' },
  { id: 32, label: 'Báo cáo 32: MEMBER RECHARGE IN DAY' },
  { id: 33, label: 'Báo cáo 33: MEMBER RECHARGE IN MONTH' },
  { id: 34, label: 'Báo cáo 34: DASHBOARD Doanh thu' },
  { id: 35, label: 'Báo cáo 35: DASHBOARD Doanh thu (mobile)' },
  { id: 36, label: 'Báo cáo 36: DASHBOARD Khách hàng' },
  { id: 37, label: 'Báo cáo 37: DASHBOARD Khách hàng chi tiết' },
  { id: 38, label: 'Báo cáo 38: DASHBOARD Sử dụng máy' },
  { id: 39, label: 'Báo cáo 39: DASHBOARD Sử dụng máy chi tiết' },
  { id: 40, label: 'Báo cáo 40: DASHBOARD Thống kê Tài khoản' },
  { id: 41, label: 'Báo cáo 41: TYPE20 INCOME' },
  { id: 42, label: 'Báo cáo 42: TYPE20 INCOME STAFF' },
  { id: 43, label: 'Báo cáo 43: TYPE20 CASH SHIFT (Giao ca)' },
]

type Submitted = { reportType: number; fromDate: string; toDate: string }

export function DynamicReportPage() {
  const [reportType, setReportType] = useState<number>(43)
  const [fromDate, setFromDate] = useState(getToday())
  const [toDate, setToDate] = useState(getToday())
  // Chi fetch khi bam "Xem" (handoff 4.8): g_MySQLConn la 1 ket noi dung chung, report nang chan moi viec DB khac.
  const [submitted, setSubmitted] = useState<Submitted | null>(null)

  const reportQuery = useQuery({
    queryKey: ['dynamic-report', submitted],
    queryFn: async () => {
      if (!submitted) throw new Error('Chưa chọn báo cáo')
      // fetchDynamicReport returns result.data directly, which is already an array or object
      return fetchDynamicReport({
        type: submitted.reportType,
        from_date: submitted.fromDate,
        to_date: submitted.toDate,
        from_time: '00:00:00',
        to_time: '23:59:59',
        staffid: 0, // 0 means all staff.
      })
    },
    enabled: submitted !== null,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: REPORT_STALE_MS,
    retry: false,
  })

  const submit = () => {
    const next: Submitted = { reportType, fromDate, toDate }
    if (submitted && JSON.stringify(submitted) === JSON.stringify(next)) {
      void reportQuery.refetch()
    } else {
      setSubmitted(next)
    }
  }

  const renderContent = () => {
    if (!submitted) return <p className="status-text">Chọn báo cáo rồi bấm “Xem báo cáo”.</p>
    if (reportQuery.isFetching) return <p className="status-text">Đang tải báo cáo...</p>
    if (reportQuery.isError) return <p className="status-text error-text">Lỗi: {(reportQuery.error as Error).message}</p>
    return <ReportResultView type={submitted.reportType} data={reportQuery.data} />
  }

  return (
    <section className="page-card">
      <div className="page-header">
        <div>
          <p className="eyebrow">Báo cáo đa năng</p>
          <h2 className="section-title">Dynamic Reports (/rptv2)</h2>
        </div>
      </div>

      <div className="toolbar-grid toolbar-grid-3">
        <label className="field compact-field">
          <span>Loại báo cáo</span>
          <Select
            value={reportType}
            onChange={(e) => setReportType(Number(e.target.value))}
          >
            {REPORT_TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </Select>
        </label>
        <DateRangePicker
          fromDate={fromDate}
          toDate={toDate}
          onFromDateChange={setFromDate}
          onToDateChange={setToDate}
        />
        <div className="field compact-field" style={{ alignSelf: 'end' }}>
          <Button variant="primary" loading={reportQuery.isFetching} onClick={submit}>
            Xem báo cáo
          </Button>
        </div>
      </div>

      <div style={{ marginTop: '24px' }}>
        {renderContent()}
      </div>
    </section>
  )
}
