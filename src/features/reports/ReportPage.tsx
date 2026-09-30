import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchDynamicReport } from '../../api/dynamic-reports'
import { getStaffList } from '../../api/staff'
import { useAuthStore } from '../../store/auth'
import { Button, DateRangePicker, InlineAlert, Select } from '../../design-system/components'
import { ReportResultView } from './ReportResultView'
import {
  MEMBER_PAYMENT_TYPE_OPTIONS,
  PAYMENT_METHOD_OPTIONS,
  REVENUE_SOURCE_OPTIONS,
  reportViewCodes,
  type ReportPageDef,
  type ReportRequestSpec,
} from './reportCatalog'

const REPORT_STALE_MS = 5 * 60 * 1000
const DIGITS_ONLY = /^\d{1,9}$/

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

  // Chế độ hiển thị: bỏ các mục cần quyền "xem tất cả" khi thiếu quyền (Select không hỗ trợ option disabled).
  const allDisplays = def.displays ?? []
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
      void query.refetch() // cùng tham số: bấm lại = người dùng muốn số liệu mới
    } else {
      setSubmitted(next)
    }
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
    if (!submitted) return <p className="status-text">Chọn tham số rồi bấm “Xem báo cáo”.</p>
    if (query.isFetching) return <p className="status-text">Đang tải báo cáo...</p>
    if (query.isError) return <p className="status-text error-text">Lỗi: {(query.error as Error).message}</p>
    return (
      <ReportResultView
        type={submitted.spec.type}
        timeDisplay={submitted.spec.extra.time_display}
        data={query.data}
      />
    )
  }

  return (
    <section className="page-card">
      {header}
      <p className="page-description">{def.description}</p>

      <div className="toolbar-grid toolbar-grid-3">
        <DateRangePicker
          fromDate={fromDate}
          toDate={toDate}
          onFromDateChange={setFromDate}
          onToDateChange={setToDate}
        />

        {hasStaffControl ? (
          <label className="field compact-field">
            <span>Nhân viên quản lý</span>
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
          </label>
        ) : null}

        {def.controls.includes('display') ? (
          <label className="field compact-field">
            <span>Hiển thị</span>
            <Select value={effectiveDisplay} onChange={(event) => setDisplay(String(event.target.value))}>
              {displayOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </label>
        ) : null}

        {def.controls.includes('revenueSource') ? (
          <label className="field compact-field">
            <span>Nguồn thu</span>
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
          </label>
        ) : null}

        {def.controls.includes('paymentMethod') ? (
          <label className="field compact-field">
            <span>Phương thức</span>
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
          </label>
        ) : null}

        {def.controls.includes('paymentType') ? (
          <label className="field compact-field">
            <span>Hình thức nạp</span>
            <Select value={paymentType} onChange={(event) => setPaymentType(String(event.target.value))}>
              {MEMBER_PAYMENT_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </label>
        ) : null}

        {def.controls.includes('timeUsed') ? (
          <label className="field compact-field">
            <span>Thời gian sử dụng tối thiểu (phút)</span>
            <input
              inputMode="numeric"
              maxLength={9}
              value={timeUsed}
              onChange={(event) => setTimeUsed(event.target.value.replace(/\D/g, ''))}
            />
          </label>
        ) : null}

        {def.controls.includes('moneyUsed') ? (
          <label className="field compact-field">
            <span>Số tiền sử dụng tối thiểu</span>
            <input
              inputMode="numeric"
              maxLength={9}
              value={moneyUsed}
              onChange={(event) => setMoneyUsed(event.target.value.replace(/\D/g, ''))}
            />
          </label>
        ) : null}

        <div className="field compact-field" style={{ alignSelf: 'end' }}>
          <Button variant="primary" loading={query.isFetching} onClick={submit}>
            Xem báo cáo
          </Button>
        </div>
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
