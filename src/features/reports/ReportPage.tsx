import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchDynamicReport } from '../../api/dynamic-reports'
import { getStaffList } from '../../api/staff'
import { useAuthStore } from '../../store/auth'
import { Button, DateRangePicker, InlineAlert, Select } from '../../design-system/components'
import { ReportResultView } from './ReportResultView'
import { IncomeSummaryStats } from './IncomeSummaryStats'
import { IncomeByStaffStats, ShiftReportStats } from './IncomeByStaffStats'
import { IncomePivotChart } from './IncomePivotChart'
import {
  DashboardIncomeView,
  DashboardMobileView,
  DashboardCustomersView,
  DashboardCustomersDetailView,
  DashboardMachineUsageView,
  DashboardMachineDetailView,
  DashboardAccountStatsView,
} from './DashboardViews'
import '../workstations/workstations.css'
import {
  MEMBER_PAYMENT_TYPE_OPTIONS,
  PAYMENT_METHOD_OPTIONS,
  REVENUE_SOURCE_OPTIONS,
  reportViewCodes,
  type ReportPageDef,
  type ReportRequestSpec,
} from './reportCatalog'
import { PaperPlaneRight } from '@phosphor-icons/react'

const REPORT_STALE_MS = 5 * 60 * 1000
const DIGITS_ONLY = /^\d{1,9}$/
/**
 * Burst detector — bảo vệ g_MySQLConn dùng chung.
 * Nếu gửi ≥ BURST_MAX_HITS request khác tham số trong BURST_WINDOW_MS ms liên tiếp
 * thì khoá BURST_PENALTY_MS ms. Dùng bình thường (click → đợi → đổi ngày → click) không bao giờ bị chặn.
 */
const BURST_WINDOW_MS = 8_000   // cửa sổ trượt 8 giây
const BURST_MAX_HITS = 3         // ≥ 3 request khác tham số trong cửa sổ = burst
const BURST_PENALTY_MS = 30_000  // khoá 30 giây khi phát hiện burst

// Ngày LOCAL (toISOString lệch múi giờ: trước 7h sáng giờ VN sẽ ra ngày hôm trước).
function todayValue() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function inclusiveDays(fromDate: string, toDate: string) {
  const [fy, fm, fd] = fromDate.split('-').map(Number)
  const [ty, tm, td] = toDate.split('-').map(Number)
  const from = new Date(fy, fm - 1, fd).getTime()
  const to = new Date(ty, tm - 1, td).getTime()
  return Math.round((to - from) / 86_400_000) + 1
}

type Submitted = { spec: ReportRequestSpec; fromDate: string; toDate: string }
type Option = { value: string; label: string }

/**
 * Trang báo cáo dùng chung cho mọi `ReportPageDef`.
 * Hiệu năng (handoff 4.8): KHÔNG tự fetch — chỉ gọi /rptv2 khi bấm "Xem báo cáo"; đổi combo/ngày không gọi;
 * không refetch khi quay lại tab. Lý do: g_MySQLConn là MỘT kết nối dùng chung, báo cáo nặng chặn mọi việc DB khác.
 */
export function ReportPage({ def }: { def: ReportPageDef }) {
  const isAdmin = useAuthStore((state) => state.isAdmin)
  const rights = useAuthStore((state) => state.rights)
  const staffId = useAuthStore((state) => state.staffId)
  const staffName = useAuthStore((state) => state.staffName)

  const has = (code: number) => isAdmin || rights.some((right) => right.code === code)
  const canView = def.dashboard ? isAdmin : isAdmin || reportViewCodes(def).some(has)
  const canAll = isAdmin || (def.allRight !== undefined && has(def.allRight))
  const selfId = staffId ?? 0
  const hasStaffControl = def.controls.includes('staff')

  const [fromDate, setFromDate] = useState(todayValue)
  const [toDate, setToDate] = useState(todayValue)
  const [display, setDisplay] = useState(def.defaultDisplay ?? '')
  const [staffSel, setStaffSel] = useState<string | null>(null)
  const [paymentType, setPaymentType] = useState('0')
  const [revenueSource, setRevenueSource] = useState('0')
  const [paymentMethod, setPaymentMethod] = useState('0')
  const [timeUsed, setTimeUsed] = useState('0')
  const [moneyUsed, setMoneyUsed] = useState('0')
  const [formError, setFormError] = useState('')
  const [submitted, setSubmitted] = useState<Submitted | null>(null)
  /** Timestamps (unix-ms) của các request thực — dùng để sliding-window burst detect. */
  const [hitTimes, setHitTimes] = useState<number[]>([])
  /** Unix-ms thời điểm hết penalty (0 = không bị khoá). */
  const [penaltyEnd, setPenaltyEnd] = useState(0)
  /** Tăng mỗi 500ms để trigger re-render countdown. */
  const [, forceRender] = useState(0)

  // Chế độ hiển thị: bỏ các mục cần quyền "xem tất cả" khi thiếu quyền.
  const allDisplays = def.displays ?? []

  // Countdown ticker — chỉ chạy khi đang bị penalty, tự dọn khi hết.
  useEffect(() => {
    if (penaltyEnd === 0) return
    const id = setInterval(() => {
      if (Date.now() >= penaltyEnd) {
        clearInterval(id)
        setPenaltyEnd(0)
      } else {
        forceRender((n) => n + 1)
      }
    }, 500)
    return () => clearInterval(id)
  }, [penaltyEnd])

  const penaltySec = penaltyEnd === 0 ? 0 : Math.max(0, Math.ceil((penaltyEnd - Date.now()) / 1000))
  const isPenalized = penaltySec > 0
  const displayOptions = allDisplays.filter((option) => !option.needsAll || canAll)
  const hiddenDisplays = allDisplays.length - displayOptions.length
  const effectiveDisplay = displayOptions.some((option) => option.value === display)
    ? display
    : (displayOptions[0]?.value ?? '')
  // Chế độ server bỏ qua nhân viên/nguồn thu/phương thức => khoá các combo đó ở "Tất cả".
  const lockedAll = Boolean(allDisplays.find((option) => option.value === effectiveDisplay)?.needsAll)

  const staffQuery = useQuery({
    queryKey: ['report-staff-list'],
    queryFn: () => getStaffList({ includeInactive: true }),
    enabled: canView && canAll && hasStaffControl,
    staleTime: REPORT_STALE_MS,
    refetchOnWindowFocus: false,
    retry: false,
  })

  const staffOptions = useMemo<Option[]>(() => {
    if (!canAll) {
      return [{ value: String(selfId), label: staffName ? `Chính tôi (${staffName})` : 'Chính tôi' }]
    }
    const list = Array.isArray(staffQuery.data) ? staffQuery.data : []
    const options: Option[] = []
    if (!def.noAllStaff) options.push({ value: '0', label: 'Tất cả' })
    // Tài khoản quản trị mặc định bị /staff loại khỏi danh sách — vẫn phải chọn được chính mình.
    if (selfId > 0 && !list.some((staff) => staff.id === selfId)) {
      options.push({ value: String(selfId), label: staffName || `NV#${selfId}` })
    }
    for (const staff of list) {
      options.push({
        value: String(staff.id),
        label: staff.active === false ? `${staff.username} (đã khoá)` : staff.username,
      })
    }
    return options
  }, [canAll, def.noAllStaff, selfId, staffName, staffQuery.data])

  // Giá trị nhân viên hiệu lực — LUÔN tính lại từ quyền, không tin state combo cũ:
  // thiếu quyền "tất cả" thì staffid gửi đi là staffId của session.
  const effectiveStaff = useMemo<string | undefined>(() => {
    if (!canAll) return String(selfId)
    if (lockedAll) return '0'
    if (staffSel !== null && staffOptions.some((option) => option.value === staffSel)) return staffSel
    if (def.noAllStaff) return selfId > 0 ? String(selfId) : staffOptions[0]?.value
    return '0'
  }, [canAll, lockedAll, selfId, staffOptions, staffSel, def.noAllStaff])

  const query = useQuery({
    queryKey: ['analysis-report', def.id, submitted],
    queryFn: () => {
      if (!submitted) throw new Error('Chưa chọn báo cáo')
      return fetchDynamicReport({
        type: submitted.spec.type,
        from_date: submitted.fromDate,
        to_date: submitted.toDate,
        from_time: '00:00:00',
        to_time: '23:59:59',
        staffid: submitted.spec.staffid,
        ...submitted.spec.extra,
      })
    },
    enabled: canView && submitted !== null,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: REPORT_STALE_MS,
    retry: false,
  })

  const submit = () => {
    setFormError('')
    if (!fromDate || !toDate) {
      setFormError('Hãy chọn khoảng ngày.')
      return
    }
    const limit = def.dateLimit
    if (limit && effectiveDisplay === limit.display && inclusiveDays(fromDate, toDate) > limit.days) {
      setFormError(limit.message)
      return
    }
    let timeUsedValue = 0
    let moneyUsedValue = 0
    if (def.controls.includes('timeUsed') || def.controls.includes('moneyUsed')) {
      if (!DIGITS_ONLY.test(timeUsed) || !DIGITS_ONLY.test(moneyUsed)) {
        setFormError('Giờ và tiền sử dụng phải là số nguyên không âm (tối đa 9 chữ số).')
        return
      }
      timeUsedValue = Number(timeUsed)
      moneyUsedValue = Number(moneyUsed)
    }
    if (hasStaffControl && effectiveStaff === undefined) {
      setFormError('Chưa có danh sách nhân viên để chọn.')
      return
    }

    const spec = def.resolve({
      display: effectiveDisplay,
      staffId: Number(effectiveStaff ?? 0),
      canAll,
      selfId,
      paymentType: Number(paymentType),
      revenueSource: Number(revenueSource),
      paymentMethod: Number(paymentMethod),
      timeUsed: timeUsedValue,
      moneyUsed: moneyUsedValue,
    })
    const next: Submitted = { spec, fromDate, toDate }
    if (submitted && JSON.stringify(submitted) === JSON.stringify(next)) {
      // Cùng tham số → kết quả đang cache trong React Query, không gọi thêm backend, không tính vào burst.
      return
    }

    // Burst detection: đếm số request thực trong cửa sổ trượt.
    const now = Date.now()
    const recentHits = hitTimes.filter((t) => now - t < BURST_WINDOW_MS)
    if (recentHits.length >= BURST_MAX_HITS) {
      setPenaltyEnd(now + BURST_PENALTY_MS)
      return
    }
    setHitTimes([...recentHits, now])
    setSubmitted(next)
  }

  const header = (
    <div className="page-header">
      <div>
        <p className="eyebrow">Phân tích</p>
        <h2 className="section-title">{def.title}</h2>
      </div>
    </div>
  )

  if (!canView) {
    return (
      <section className="page-card">
        {header}
        <InlineAlert tone="danger">
          Bạn không có quyền xem báo cáo này. Vui lòng liên hệ quản trị viên. (Nếu vừa được cấp quyền, hãy đăng
          nhập lại.)
        </InlineAlert>
      </section>
    )
  }

  const renderResult = () => {
    if (!submitted) return null
    if (query.isFetching) return <p className="status-text">Đang tải báo cáo...</p>
    if (query.isError) return <p className="status-text error-text">Lỗi: {(query.error as Error).message}</p>
    // Dashboard 34-40: mỗi type có component riêng — không qua ReportResultView generic
    // vì data là JSON object phức tạp, không phải flat array.
    if (def.dashboard) {
      switch (def.slug) {
        case 'income':            return <DashboardIncomeView data={query.data} />
        case 'income-mobile':     return <DashboardMobileView data={query.data} />
        case 'customers':         return <DashboardCustomersView data={query.data} />
        case 'customers-detail':  return <DashboardCustomersDetailView data={query.data} />
        case 'machine-usage':     return <DashboardMachineUsageView data={query.data} />
        case 'machine-usage-detail': return <DashboardMachineDetailView data={query.data} />
        case 'account-stats':     return <DashboardAccountStatsView data={query.data} />
        default: break
      }
    }
    const isIncomeSummaryDaily =
      def.id === 'income-summary' && (submitted.spec.extra.time_display ?? 0) === 0
    const isIncomeByStaff = def.id === 'income-by-staff'
    const isShiftReport = def.id === 'shift-report'
    const td = submitted.spec.extra.time_display ?? 0
    const isIncomePivot = def.id === 'income-summary' && (td === 1 || td === 2)
    const shiftStaffName = isShiftReport
      ? (staffOptions.find((o) => o.value === effectiveStaff)?.label ?? '')
      : ''
    return (
      <>
        {isIncomeSummaryDaily ? <IncomeSummaryStats data={query.data} /> : null}
        {isIncomePivot ? <IncomePivotChart data={query.data} timeDisplay={td} /> : null}
        {isIncomeByStaff ? <IncomeByStaffStats data={query.data} /> : null}
        {isShiftReport ? <ShiftReportStats data={query.data} staffName={shiftStaffName} /> : null}
        <ReportResultView
          type={submitted.spec.type}
          timeDisplay={submitted.spec.extra.time_display}
          data={query.data}
        />
      </>
    )
  }

  return (
    <section className="page-card">
      {header}
      <p className="page-description">{def.description}</p>

      <div className="report-filter-bar">
        <DateRangePicker
          fromDate={fromDate}
          toDate={toDate}
          onFromDateChange={setFromDate}
          onToDateChange={setToDate}
        />

        {hasStaffControl ? (
          <div className="ds-input-group">
            <span className="ds-input-group-separator">Nhân viên</span>
            <Select
              value={effectiveStaff ?? ''}
              disabled={!canAll || lockedAll}
              onChange={(event) => setStaffSel(String(event.target.value))}
            >
              {staffOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
        ) : null}

        {def.controls.includes('display') ? (
          <div className="ds-input-group">
            <span className="ds-input-group-separator">Hiển thị</span>
            <Select value={effectiveDisplay} onChange={(event) => setDisplay(String(event.target.value))}>
              {displayOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
        ) : null}

        {def.controls.includes('revenueSource') ? (
          <div className="ds-input-group">
            <span className="ds-input-group-separator">Nguồn thu</span>
            <Select
              value={lockedAll ? '0' : revenueSource}
              disabled={lockedAll}
              onChange={(event) => setRevenueSource(String(event.target.value))}
            >
              {REVENUE_SOURCE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
        ) : null}

        {def.controls.includes('paymentMethod') ? (
          <div className="ds-input-group">
            <span className="ds-input-group-separator">Phương thức</span>
            <Select
              value={lockedAll ? '0' : paymentMethod}
              disabled={lockedAll}
              onChange={(event) => setPaymentMethod(String(event.target.value))}
            >
              {PAYMENT_METHOD_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
        ) : null}

        {def.controls.includes('paymentType') ? (
          <div className="ds-input-group">
            <span className="ds-input-group-separator">Hình thức nạp</span>
            <Select value={paymentType} onChange={(event) => setPaymentType(String(event.target.value))}>
              {MEMBER_PAYMENT_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
        ) : null}

        {def.controls.includes('timeUsed') ? (
          <div className="ds-input-group">
            <span className="ds-input-group-separator">Thời gian tối thiểu (phút)</span>
            <input
              className="ds-input"
              inputMode="numeric"
              maxLength={9}
              value={timeUsed}
              onChange={(event) => setTimeUsed(event.target.value.replace(/\D/g, ''))}
            />
          </div>
        ) : null}

        {def.controls.includes('moneyUsed') ? (
          <div className="ds-input-group">
            <span className="ds-input-group-separator">Tiền tối thiểu</span>
            <input
              className="ds-input"
              inputMode="numeric"
              maxLength={9}
              value={moneyUsed}
              onChange={(event) => setMoneyUsed(event.target.value.replace(/\D/g, ''))}
            />
          </div>
        ) : null}

        <Button
          variant="primary"
          loading={query.isFetching}
          disabled={isPenalized}
          icon={<PaperPlaneRight size={18} weight="bold" aria-hidden="true" />}
          onClick={submit}
        >
          {isPenalized ? `Xem báo cáo (${penaltySec}s)` : 'Xem báo cáo'}
        </Button>
        {isPenalized ? (
          <InlineAlert tone="warning">
            Phát hiện nhiều yêu cầu liên tiếp. Chờ {penaltySec}s để bảo vệ hệ thống.
          </InlineAlert>
        ) : null}
      </div>

      {hasStaffControl && !canAll ? (
        <p className="status-text">Bạn chỉ xem được báo cáo của chính mình (chưa có quyền xem tất cả).</p>
      ) : null}
      {hiddenDisplays > 0 ? (
        <p className="status-text">
          Hiển thị hằng tuần/hằng tháng cần quyền xem tất cả của báo cáo này nên không hiện trong danh sách.
        </p>
      ) : null}
      {hasStaffControl && canAll && staffQuery.isError ? (
        <p className="status-text error-text">Không tải được danh sách nhân viên: {(staffQuery.error as Error).message}</p>
      ) : null}
      {formError ? <InlineAlert tone="warning">{formError}</InlineAlert> : null}

      <div style={{ marginTop: '24px' }}>{renderResult()}</div>
    </section>
  )
}
