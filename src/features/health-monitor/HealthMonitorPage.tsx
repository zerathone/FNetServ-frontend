import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowDown,
  ArrowUp,
  Cpu,
  GraphicsCard,
  HardDrive,
  Lightning,
  MagnifyingGlass,
  Memory,
  Network,
  Speedometer,
  Thermometer,
  X,
} from '@phosphor-icons/react'
import {
  getWorkstationsHardwareAll,
  getWorkstationsRuntime,
  type WorkstationHardware,
} from '../../api/workstations'
import { Button, PageHeader, StateView, type StatusTone } from '../../design-system/components'
import {
  dataVolume,
  LOAD_DANGER_PCT,
  LOAD_WARN_PCT,
  loadTone,
  num,
  TEMP_DANGER_C,
  TEMP_WARN_C,
  tempTone,
} from '../workstations/MachineTechExtras'
// Dung chung khung/ban/toolbar cua trang May tram (.ws-workspace, .ws-toolbar, .ws-content, .ws-table__*).
import '../workstations/workstations.css'
import './health-monitor.css'

// Trang "Theo doi hoat dong" (/health_monitor). Bang dang luoi (giong trang May tram): header LUON hien
// du cot, ke ca luc dang tai / loi / rong -- trang thai nam trong than bang. O du lieu chi dung CHU + MAU:
// binh thuong = chu thuong; warning/danger = cham tron mau + chu dam (mau chu van la mau thuong) + tooltip.
// Icon loai chi so (CPU/GPU/RAM..., nhiet ke, dong ho tai) nam o HEADER. Nguong mau DUNG CHUNG voi drawer
// chi tiet may (MachineTechExtras).

const NO_DATA = '—'
const POLL_MS = 30_000
const FLASH_MS = 3_000
const POLL_STEP_COUNT = 5
const POLL_STEP_FLASH_MS = 700

// 15 track: ten may | phien ban | CPU x3 | GPU x3 | RAM x2 | O cung x2 | Mang x2 | cap nhat
const GRID_COLUMNS = [
  'minmax(8.5rem, 1.15fr)',
  '7rem',
  ...Array(6).fill('minmax(5.5rem, 1fr)'),
  'minmax(5.5rem, 1fr)',
  '8.5rem',
  ...Array(2).fill('minmax(5.5rem, 1fr)'),
  ...Array(2).fill('minmax(6rem, 1fr)'),
  '6.5rem',
].join(' ')

const gridStyle = { '--hm-columns': GRID_COLUMNS } as CSSProperties

// ---- Thong ke canh bao (tren bang): moi nut = 1 chi so (nhiet/tai) cua 1 linh kien o 1 muc (danger/warning),
// hien so may dang o muc do. Chi nut co so may > 0 moi hien; khong co nut nao -> an ca khoi. Bam = loc bang. ----
type AlertTone = 'danger' | 'warning'

type AlertMetric = {
  id: string
  label: string
  icon: typeof Thermometer
  toneOf: (hw: WorkstationHardware) => StatusTone
  levels: Record<AlertTone, string>
  /** Nhan ngan tren tag loc o header cot. */
  tagLabel: Record<AlertTone, string>
}

type AlertDevice = {
  id: string
  label: string
  icon: typeof Cpu
  metrics: AlertMetric[]
}

const TEMP_LEVELS = {
  danger: `quá nhiệt, trên ${TEMP_DANGER_C}°C`,
  warning: `nóng, trên ${TEMP_WARN_C}°C`,
}

function tempMetric(read: (hw: WorkstationHardware) => number | null): AlertMetric {
  return {
    id: 'temp',
    label: 'nhiệt độ',
    icon: Thermometer,
    toneOf: (hw) => tempTone(read(hw)),
    levels: TEMP_LEVELS,
    tagLabel: { danger: 'Quá nhiệt', warning: 'Nóng' },
  }
}

const ALERT_DEVICES: AlertDevice[] = [
  { id: 'gpu', label: 'GPU', icon: GraphicsCard, metrics: [tempMetric((hw) => hw.gpu.tempC)] },
  { id: 'cpu', label: 'CPU', icon: Cpu, metrics: [tempMetric((hw) => hw.cpu.tempC)] },
]

const ALERT_TONES: AlertTone[] = ['danger', 'warning']

const alertKey = (device: AlertDevice, metric: AlertMetric, tone: AlertTone) => `${device.id}.${metric.id}.${tone}`

function Empty() {
  return <span className="hm-empty">{NO_DATA}</span>
}

type FlashArrow = 'up' | 'down' | null

/** `text` doi so voi lan render truoc -> flash=true trong FLASH_MS (sang mau chu) roi tu tat.
    Neu co `numeric` va no doi, kem huong tang/giam (▲/▼); numeric giu nguyen/khong co -> khong mui ten. */
function useFlashDirection(text: string | null, numeric?: number | null) {
  const [flash, setFlash] = useState(false)
  const [arrow, setArrow] = useState<FlashArrow>(null)
  const prevTextRef = useRef(text)
  const prevNumRef = useRef(numeric)

  useEffect(() => {
    if (prevTextRef.current === text) return
    const prevNum = prevNumRef.current
    const dir: FlashArrow =
      numeric != null && prevNum != null && numeric !== prevNum ? (numeric > prevNum ? 'up' : 'down') : null
    prevTextRef.current = text
    prevNumRef.current = numeric
    setFlash(true)
    setArrow(dir)
    const timer = setTimeout(() => {
      setFlash(false)
      setArrow(null)
    }, FLASH_MS)
    return () => clearTimeout(timer)
  }, [text, numeric])

  return { flash, arrow }
}

/** O du lieu: binh thuong = chu thuong; warning/danger = cham tron mau + chu dam + tooltip.
    Gia tri vua doi so voi lan cap nhat truoc -> chu sang mau trong FLASH_MS roi tu mo dan ve binh
    thuong; neu truyen kem `value` so va no tang/giam thi them ▲/▼ trong luc sang mau. */
function Cell({
  text,
  tone = 'neutral',
  tip,
  value,
}: {
  text: string | null
  tone?: StatusTone
  tip?: string
  value?: number | null
}) {
  const { flash, arrow } = useFlashDirection(text, value)
  if (text === null) return <Empty />
  const arrowGlyph = arrow === 'up' ? '▲ ' : arrow === 'down' ? '▼ ' : ''
  // Mau flash theo huong: tang = xanh, giam = do, doi ma khong ro huong (vd text thuong) = xanh duong.
  const flashClass = flash ? `hm-flash${arrow ? ` hm-flash--${arrow}` : ''}` : undefined
  if (tone !== 'warning' && tone !== 'danger') {
    return (
      <span className={flashClass}>
        {arrowGlyph}
        {text}
      </span>
    )
  }
  return (
    <span className="hm-cell" title={tip}>
      <span className={`hm-dot hm-dot--${tone}`} aria-hidden="true" />
      <strong className={flashClass}>
        {arrowGlyph}
        {text}
      </strong>
    </span>
  )
}

function TempCell({ value }: { value: number | null | undefined }) {
  const tone = tempTone(value ?? null)
  return (
    <Cell
      text={num(value, '°C')}
      value={value ?? null}
      tone={tone}
      tip={tone === 'danger' ? `Quá nhiệt: trên ${TEMP_DANGER_C}°C` : `Nóng: trên ${TEMP_WARN_C}°C`}
    />
  )
}

function LoadCell({ value }: { value: number | null | undefined }) {
  const tone = loadTone(value ?? null)
  return (
    <Cell
      text={num(value, '%')}
      value={value ?? null}
      tone={tone}
      tip={tone === 'danger' ? `Quá tải: trên ${LOAD_DANGER_PCT}%` : `Tải cao: trên ${LOAD_WARN_PCT}%`}
    />
  )
}

function ramUsage(ram: WorkstationHardware['ram'] | undefined) {
  if (!ram || ram.usedGB === null || ram.availableGB === null) return null
  return `${ram.usedGB.toFixed(1)} / ${(ram.usedGB + ram.availableGB).toFixed(1)} GB`
}

/** "Vừa xong" / "1 phút trước" / "2 giờ trước"...; qua 24h thi hien ngay gio tuyet doi. */
function formatUpdated(sec: number | null | undefined) {
  if (!sec) return null
  const ms = sec * 1000
  const diffMinutes = Math.round((ms - Date.now()) / 60_000)
  if (Math.abs(diffMinutes) < 1) return 'vừa xong'
  if (Math.abs(diffMinutes) < 60) {
    return new Intl.RelativeTimeFormat('vi', { numeric: 'auto' }).format(diffMinutes, 'minute')
  }
  const diffHours = Math.round(diffMinutes / 60)
  if (Math.abs(diffHours) < 24) {
    return new Intl.RelativeTimeFormat('vi', { numeric: 'auto' }).format(diffHours, 'hour')
  }
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(ms)
}

/** O tieu de dat TUONG MINH vao luoi 2 hang (nhom o hang 1, cot con o hang 2, cot don chiem ca 2 hang). */
function Head({
  col,
  span = 1,
  row,
  icon: Icon,
  start,
  group,
  divider,
  children,
}: {
  col: number
  span?: number
  row: 1 | 2 | 'both'
  icon?: typeof Thermometer
  start?: boolean
  group?: boolean
  /** Vien doc nhe o canh trai o nay -- danh dau ranh gioi giua cac cum cot chinh (CPU/GPU/RAM...). */
  divider?: boolean
  children: ReactNode
}) {
  return (
    <div
      role="columnheader"
      className={`hm-hc${start ? ' hm-hc--start' : ''}${group ? ' hm-hc--group' : ''}${divider ? ' hm-hc--divider' : ''}`}
      style={{
        gridColumn: span > 1 ? `${col} / span ${span}` : col,
        gridRow: row === 'both' ? '1 / span 2' : row,
      }}
    >
      {Icon ? <Icon size={14} weight="bold" aria-hidden="true" /> : null}
      {children}
    </div>
  )
}

function Body({
  children,
  start,
  divider,
}: {
  children: ReactNode
  start?: boolean
  /** Vien doc nhe o canh trai o nay -- danh dau ranh gioi giua cac cum cot chinh (CPU/GPU/RAM...). */
  divider?: boolean
}) {
  return (
    <div role="cell" className={`hm-cw${start ? ' hm-cw--start' : ''}${divider ? ' hm-cw--divider' : ''}`}>
      {children}
    </div>
  )
}

/** "Dang tai" / "X truoc" khi loi -- giong format cua PollingStatus dung chung (component.tsx rieng,
    khong export ham nay nen copy local cho gon). */
function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1_000))
  if (totalSec < 60) return `${totalSec} giây`
  const totalMin = Math.floor(totalSec / 60)
  if (totalMin < 60) return `${totalMin} phút`
  return `${Math.floor(totalMin / 60)} giờ`
}

/** Cum "Lam moi" cho trang nay: trang CHI polling thuan (khong co WS day su kien rieng). Truoc day
    vach tien trinh dua vao dataUpdatedAt cua 2 query (runtimeQuery/hardwareQuery) -- nhung 2 query
    nay refetchInterval RIENG, moi cai tinh 30s ke tu lan FETCH XONG cua chinh no (khong phai tu mot
    moc chung), nen lech pha nhau dan theo jitter mang -> vach reset/chop vao nhung thoi diem khac
    nhau, nhin nhu vo nguyen tac. Sua: component nay la DONG HO DUY NHAT -- tu dem gio va la noi GOI
    onRefresh moi intervalMs (xem usage: 2 query khong con tu dong refetchInterval nua), vach la tien
    trinh toi lan tu goi ke tiep CUA CHINH NO, het 5 vach thi chop + goi onRefresh + reset. Bam cum =
    lam moi thu cong, dong thoi doi lich cho chu ky ke tiep bat dau lai tu luc bam. Mat polling (dang
    goi lai REST) hoac loi -- hien spinner "Dang tai" / chu "X truoc" mau do, giong trang May tram luc
    mat WS (xem PollingStatus.tsx). */
function PollSteps({
  intervalMs,
  isFetching,
  isError,
  onRefresh,
  className = '',
}: {
  intervalMs: number
  isFetching: boolean
  isError: boolean
  onRefresh: () => void
  className?: string
}) {
  const [now, setNow] = useState(() => Date.now())
  const [justPolled, setJustPolled] = useState(false)
  const anchorRef = useRef(Date.now())
  const errorSinceRef = useRef<number | null>(null)
  const cycleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Luon goi ban onRefresh moi nhat ma khong bat effect lich chay lai (tranh reset dong ho giua chung).
  const onRefreshRef = useRef(onRefresh)
  onRefreshRef.current = onRefresh

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    if (isError) errorSinceRef.current ??= Date.now()
    else errorSinceRef.current = null
  }, [isError])

  const poll = useCallback(() => {
    anchorRef.current = Date.now()
    setNow(anchorRef.current)
    setJustPolled(true)
    onRefreshRef.current()
    if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current)
    flashTimeoutRef.current = setTimeout(() => setJustPolled(false), POLL_STEP_FLASH_MS)
  }, [])

  const scheduleNext = useCallback(() => {
    cycleTimeoutRef.current = setTimeout(() => {
      poll()
      scheduleNext()
    }, intervalMs)
  }, [poll, intervalMs])

  useEffect(() => {
    scheduleNext()
    return () => {
      if (cycleTimeoutRef.current) clearTimeout(cycleTimeoutRef.current)
    }
  }, [scheduleNext])

  useEffect(
    () => () => {
      if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current)
    },
    [],
  )

  function handleManualRefresh() {
    if (cycleTimeoutRef.current) clearTimeout(cycleTimeoutRef.current)
    poll()
    scheduleNext()
  }

  const fraction = Math.min(1, Math.max(0, (now - anchorRef.current) / intervalMs))
  const filled = Math.min(POLL_STEP_COUNT, Math.floor(fraction * POLL_STEP_COUNT))
  // Dang goi lai REST thuc su (khong tinh luc dang loi, da co chu "X truoc" rieng) -> spinner.
  const showSpinner = isFetching && !isError

  let status: ReactNode
  let statusLabel: string
  if (isError) {
    const elapsed = formatElapsed(now - (errorSinceRef.current ?? now))
    status = <span className="hm-poll__error">{elapsed} trước</span>
    statusLabel = `lỗi ${elapsed} trước`
  } else if (showSpinner) {
    status = (
      <span className="hm-poll__loading">
        <span className="ds-spinner" aria-hidden="true" />
        Đang tải
      </span>
    )
    statusLabel = 'đang tải'
  } else {
    status = (
      <span className={`hm-poll__steps${justPolled ? ' hm-poll__steps--flash' : ''}`} aria-hidden="true">
        {Array.from({ length: POLL_STEP_COUNT }, (_, i) => (
          <span key={i} className={`hm-poll__step${i < filled ? ' is-filled' : ''}`} />
        ))}
      </span>
    )
    statusLabel = `đã qua ${filled}/${POLL_STEP_COUNT} vạch tới lần tự làm mới kế tiếp`
  }

  return (
    <button
      type="button"
      className={`hm-poll${isError ? ' hm-poll--error' : ''} ${className}`.trim()}
      onClick={handleManualRefresh}
      disabled={isFetching}
      title="Làm mới"
      aria-label={`Làm mới. Trạng thái: ${statusLabel}.`}
    >
      <span className="hm-poll__label">Làm mới</span>
      <span className="hm-poll__status">{status}</span>
    </button>
  )
}

export function HealthMonitorPage() {
  const [search, setSearch] = useState('')

  // Cung queryKey/queryFn voi trang May tram -> dung chung cache danh sach may. KHONG tu
  // refetchInterval o day: cum PollSteps la dong ho duy nhat, tu goi lai ca 2 query moi POLL_MS
  // (xem PollSteps) de vach tien trinh khop dung voi lan goi that, khong lech pha giua 2 query.
  const runtimeQuery = useQuery({
    queryKey: ['workstations'],
    queryFn: getWorkstationsRuntime,
  })
  // Loi goi API phan cung (vd mang/gateway) khong bao ra man hinh: o phan cung don gian hien "—".
  const hardwareQuery = useQuery({
    queryKey: ['workstations-hardware-all'],
    queryFn: getWorkstationsHardwareAll,
  })

  // Nhan "x phut truoc" o cot Cap nhat phai tu tru thoi gian ke ca khi data khong doi (hardwareQuery
  // tra ve cung tham chieu do structural sharing) -> tu dem gio moi 15s de ep render lai nhan.
  const [, forceTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => forceTick((tick) => tick + 1), 15_000)
    return () => clearInterval(id)
  }, [])

  const [activeAlert, setActiveAlert] = useState<string | null>(null)

  // Ghep danh sach may (runtime) voi phan cung theo hostName.
  const allRows = useMemo(() => {
    const snapshot = Array.isArray(runtimeQuery.data) ? null : runtimeQuery.data
    const machines = snapshot?.items ?? []
    const hardwareByHost = new Map<string, WorkstationHardware>()
    for (const item of hardwareQuery.data?.items ?? []) {
      hardwareByHost.set(item.hostName.toLowerCase(), item.hardware)
    }
    return machines
      .map((machine) => ({
        machine,
        hw: hardwareByHost.get(machine.hostName.toLowerCase()) ?? null,
      }))
      .sort((a, b) =>
        a.machine.hostName.localeCompare(b.machine.hostName, 'vi', { numeric: true, sensitivity: 'base' }),
      )
  }, [runtimeQuery.data, hardwareQuery.data])

  // So may o tung muc canh bao -- dem tren TOAN BO may (khong theo o tim kiem) de so khong nhay khi go chu.
  const alertCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const { hw } of allRows) {
      if (!hw) continue
      for (const device of ALERT_DEVICES) {
        for (const metric of device.metrics) {
          const tone = metric.toneOf(hw)
          if (tone === 'danger' || tone === 'warning') {
            const key = alertKey(device, metric, tone)
            counts.set(key, (counts.get(key) ?? 0) + 1)
          }
        }
      }
    }
    return counts
  }, [allRows])

  // Bo loc dang bat ma khong con may nao (du lieu vua doi) -> coi nhu tat, tranh bang rong khong co nut de bo.
  const effectiveAlert = activeAlert && (alertCounts.get(activeAlert) ?? 0) > 0 ? activeAlert : null
  const hasAlerts = alertCounts.size > 0

  // Bo loc dang bat -> tag co nut x hien tren header cot tuong ung (CPU / GPU) de biet dang loc + go loc.
  let activeFilter: { device: AlertDevice; metric: AlertMetric; tone: AlertTone } | null = null
  if (effectiveAlert) {
    for (const device of ALERT_DEVICES) {
      for (const metric of device.metrics) {
        for (const tone of ALERT_TONES) {
          if (alertKey(device, metric, tone) === effectiveAlert) activeFilter = { device, metric, tone }
        }
      }
    }
  }
  const filterTag = (deviceId: string) =>
    activeFilter && activeFilter.device.id === deviceId ? (
      <span
        className={`hm-filter-tag hm-filter-tag--${activeFilter.tone}`}
        title={`Đang lọc: ${activeFilter.device.label} ${activeFilter.metric.label} ${activeFilter.metric.levels[activeFilter.tone]}`}
      >
        <span className={`hm-dot hm-dot--${activeFilter.tone}`} aria-hidden="true" />
        {activeFilter.metric.tagLabel[activeFilter.tone]}
        <button
          type="button"
          className="hm-filter-tag__clear"
          aria-label={`Bỏ lọc ${activeFilter.device.label} ${activeFilter.metric.label}`}
          onClick={() => setActiveAlert(null)}
        >
          <X size={12} weight="bold" aria-hidden="true" />
        </button>
      </span>
    ) : null

  const rows = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    return allRows.filter(({ machine, hw }) => {
      if (
        keyword &&
        !machine.hostName.toLowerCase().includes(keyword) &&
        !(machine.ip ?? '').toLowerCase().includes(keyword)
      ) {
        return false
      }
      if (!effectiveAlert) return true
      if (!hw) return false
      return ALERT_DEVICES.some((device) =>
        device.metrics.some((metric) =>
          ALERT_TONES.some((tone) => alertKey(device, metric, tone) === effectiveAlert && metric.toneOf(hw) === tone),
        ),
      )
    })
  }, [allRows, search, effectiveAlert])
  const totalMachines = allRows.length

  const withDataCount = rows.filter((row) => row.hw !== null).length

  return (
    <section className="ws-workspace">
      <PageHeader
        eyebrow="Vận hành"
        title="Theo dõi hoạt động"
        actions={
          <div className="ws-page-actions">
            <PollSteps
              className="ws-page-actions__push-right"
              isError={runtimeQuery.isError || hardwareQuery.isError}
              isFetching={runtimeQuery.isFetching || hardwareQuery.isFetching}
              intervalMs={POLL_MS}
              onRefresh={() => {
                void runtimeQuery.refetch()
                void hardwareQuery.refetch()
              }}
            />
          </div>
        }
      />

      {/* Chi hien khi co it nhat 1 may warning/danger; nut nao 0 may thi khong hien. */}
      {hasAlerts ? (
        <div className="hm-alerts" aria-label="Thống kê cảnh báo phần cứng">
          {ALERT_DEVICES.map((device) => {
            const DeviceIcon = device.icon
            const buttons = device.metrics.flatMap((metric) =>
              ALERT_TONES.map((tone) => ({ metric, tone, key: alertKey(device, metric, tone) })).filter(
                (item) => (alertCounts.get(item.key) ?? 0) > 0,
              ),
            )
            if (buttons.length === 0) return null
            return (
              <div key={device.id} className="hm-alerts__group">
                <span className="hm-alerts__device">
                  <DeviceIcon size={22} weight="fill" aria-hidden="true" />
                  <span className="hm-alerts__device-label">{device.label}</span>
                </span>
                {buttons.map(({ metric, tone, key }) => {
                  const MetricIcon = metric.icon
                  const count = alertCounts.get(key) ?? 0
                  const active = effectiveAlert === key
                  return (
                    <button
                      key={key}
                      type="button"
                      className={`hm-alerts__btn hm-alerts__btn--${tone}${active ? ' is-active' : ''}`}
                      aria-pressed={active}
                      title={`${device.label} ${metric.label} ${metric.levels[tone]}: ${count} máy`}
                      onClick={() => setActiveAlert(active ? null : key)}
                    >
                      <MetricIcon size={18} weight="bold" aria-hidden="true" />
                      <strong>{count}</strong>
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      ) : null}

      <div className="ws-toolbar">
        <div className="ds-field ws-search">
          <span className="ds-field__label ds-visually-hidden">Tìm nhanh</span>
          <div className="ds-input-group ds-input-group--search">
            <div className="ds-search-input">
              <MagnifyingGlass className="ds-search-input__icon" size={18} weight="bold" aria-hidden="true" />
              <input
                className="ds-input"
                type="search"
                value={search}
                placeholder="Tên máy hoặc IP"
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          </div>
        </div>
        <div className="ws-toolbar__end">
          <div className="ws-toolbar__count" aria-live="polite">
            <strong>{rows.length}</strong>
            <span>
              / {totalMachines} máy · {withDataCount} có dữ liệu phần cứng
            </span>
          </div>
        </div>
      </div>

      <div className="ws-content">
        <div className="hm-table" role="table" aria-rowcount={rows.length + 2} style={gridStyle}>
          {/* Header LUON hien du cot, bat ke trang thai tai du lieu. */}
          <div className="hm-head ws-table__header" role="rowgroup">
            <Head col={1} row="both" start>Tên máy</Head>
            <Head col={2} row="both" start>Phiên bản</Head>
            <Head col={3} span={3} row={1} icon={Cpu} group divider>CPU{filterTag('cpu')}</Head>
            <Head col={6} span={3} row={1} icon={GraphicsCard} group divider>GPU{filterTag('gpu')}</Head>
            <Head col={9} span={2} row={1} icon={Memory} group divider>RAM</Head>
            <Head col={11} span={2} row={1} icon={HardDrive} group divider>Ổ cứng</Head>
            <Head col={13} span={2} row={1} icon={Network} group divider>Mạng</Head>
            <Head col={15} row="both" divider>Cập nhật</Head>

            <Head col={3} row={2} icon={Thermometer} divider>Nhiệt độ</Head>
            <Head col={4} row={2} icon={Speedometer}>Tải</Head>
            <Head col={5} row={2} icon={Lightning}>Công suất</Head>
            <Head col={6} row={2} icon={Thermometer} divider>Nhiệt độ</Head>
            <Head col={7} row={2} icon={Speedometer}>Tải</Head>
            <Head col={8} row={2} icon={Lightning}>Công suất</Head>
            <Head col={9} row={2} icon={Speedometer} divider>Tải</Head>
            <Head col={10} row={2}>Dùng / Tổng</Head>
            <Head col={11} row={2} icon={Thermometer} divider>Nhiệt độ</Head>
            <Head col={12} row={2} icon={Speedometer}>Tải</Head>
            <Head col={13} row={2} icon={ArrowUp} divider>Tải lên</Head>
            <Head col={14} row={2} icon={ArrowDown}>Tải xuống</Head>
          </div>

          {runtimeQuery.isLoading ? (
            <div className="ws-table__empty">
              <StateView title="Đang tải danh sách máy" />
            </div>
          ) : runtimeQuery.isError ? (
            <div className="ws-table__empty">
              <StateView
                title="Chưa tải được danh sách máy"
                description="Vui lòng thử lại."
                action={<Button onClick={() => void runtimeQuery.refetch()}>Thử lại</Button>}
              />
            </div>
          ) : rows.length === 0 ? (
            <div className="ws-table__empty">
              {search || effectiveAlert ? (
                <StateView
                  title="Không có máy phù hợp"
                  description="Hãy đổi bộ lọc hoặc từ khóa tìm kiếm."
                  action={<Button onClick={() => { setSearch(''); setActiveAlert(null) }}>Xóa bộ lọc</Button>}
                />
              ) : (
                <StateView title="Chưa có máy trạm nào" />
              )}
            </div>
          ) : (
            <div className="hm-body">
              {rows.map(({ machine, hw }) => (
                <div key={machine.hostName} className="hm-row" role="row">
                  <Body start>
                    <strong className="hm-name">{machine.hostName}</strong>
                  </Body>
                  <Body start>
                    <Cell
                      text={machine.version || null}
                      tone={machine.verNew ? 'warning' : 'neutral'}
                      tip="Có bản FNet mới hơn"
                    />
                  </Body>
                  <Body divider><TempCell value={hw?.cpu.tempC} /></Body>
                  <Body><LoadCell value={hw?.cpu.loadPct} /></Body>
                  <Body><Cell text={num(hw?.cpu.powerW, ' W')} value={hw?.cpu.powerW ?? null} /></Body>
                  <Body divider><TempCell value={hw?.gpu.tempC} /></Body>
                  <Body><LoadCell value={hw?.gpu.loadPct} /></Body>
                  <Body><Cell text={num(hw?.gpu.powerW, ' W')} value={hw?.gpu.powerW ?? null} /></Body>
                  <Body divider><LoadCell value={hw?.ram.loadPct} /></Body>
                  <Body><Cell text={ramUsage(hw?.ram)} value={hw?.ram.usedGB ?? null} /></Body>
                  <Body divider><TempCell value={hw?.storage.tempC} /></Body>
                  <Body><LoadCell value={hw?.storage.loadPct} /></Body>
                  <Body divider><Cell text={dataVolume(hw?.network.uploadGB)} value={hw?.network.uploadGB ?? null} /></Body>
                  <Body><Cell text={dataVolume(hw?.network.downloadGB)} value={hw?.network.downloadGB ?? null} /></Body>
                  <Body divider>
                    <span
                      className="hm-updated"
                      title={hw?.updatedAtSec ? new Date(hw.updatedAtSec * 1000).toLocaleString('vi-VN') : undefined}
                    >
                      {formatUpdated(hw?.updatedAtSec) ?? NO_DATA}
                    </span>
                  </Body>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
