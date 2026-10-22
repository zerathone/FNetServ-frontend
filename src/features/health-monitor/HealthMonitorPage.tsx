import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowDown,
  ArrowUp,
  CaretRight,
  Circuitry,
  Cpu,
  Fan,
  GraphicsCard,
  HardDrive,
  Lightning,
  MagnifyingGlass,
  Memory,
  Network,
  Speedometer,
  Thermometer,
  Warning,
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
  FAN_DANGER_PCT,
  FAN_WARN_PCT,
  fanTone,
  hardwareErrorsTitle,
  joinParts,
  LOAD_DANGER_PCT,
  LOAD_WARN_PCT,
  loadTone,
  num,
  TEMP_DANGER_C,
  TEMP_WARN_C,
  tempTone,
} from '../workstations/MachineTechExtras'
import { WORKSTATION_STATUS } from '../workstations/workstationModel'
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

// 14 track: ten may (+ phien ban mo duoi ten, thoi diem cap nhat can phai) | CPU x3 | GPU x4
// (nhiet/tai/cong suat/quat) | RAM x2 | O cung x2 | Mang x2. `min` (rem) = do rong toi thieu cua track --
// dung de tinh min-width chung cho header + than (2 luoi rieng phai bang nhau moi thang cot), KHONG go tay.
const flex = (min: number, fr = 1) => ({ min, track: `minmax(${min}rem, ${fr}fr)` })
const fixed = (rem: number) => ({ min: rem, track: `${rem}rem` })
// Cac cot SO LIEU (sau cot ten may).
const DATA_TRACKS = [
  ...Array.from({ length: 7 }, () => flex(5.5)),
  flex(5.5),
  fixed(8.5),
  ...Array.from({ length: 2 }, () => flex(5.5)),
  ...Array.from({ length: 2 }, () => flex(6)),
]
const GRID_GAP_REM = 0.5 // column-gap: var(--space-2)
const GRID_PAD_REM = 0.75 // padding ngang .hm-head/.hm-row: var(--space-3) moi ben
const DATA_MIN_REM = DATA_TRACKS.reduce((sum, t) => sum + t.min, 0) + GRID_GAP_REM * DATA_TRACKS.length + GRID_PAD_REM * 2
// Cot ten may CO GIAN THEO NOI DUNG: rong dung bang dong dai nhat (cham + ten + canh bao + thoi gian can
// phai) -- do bang DOM sau khi render (moi dong la 1 luoi rieng nen CSS khong tu dong bo duoc). Chua do
// xong (render dau) -> tam NAME_FALLBACK_REM.
const NAME_FALLBACK_REM = 11

function gridStyleFor(nameColPx: number | null) {
  const nameTrack = nameColPx ? `${nameColPx}px` : `${NAME_FALLBACK_REM}rem`
  return {
    '--hm-columns': [nameTrack, ...DATA_TRACKS.map((t) => t.track)].join(' '),
    '--hm-min-width': `calc(${nameTrack} + ${DATA_MIN_REM}rem)`,
  } as CSSProperties
}

/** Do rong tu nhien (khong bi cat) cua o ten may o tung dong -> lay lon nhat. Cong scrollWidth cua tung
    phan tu con tren dong ten (ten / canh bao / thoi gian -- khoang cach giua chung la PADDING nen da nam
    trong scrollWidth) + dong phien ban, cong o cham dau dong. */
function measureNameColumn(table: HTMLElement): number {
  let max = 0
  table.querySelectorAll<HTMLElement>('.hm-row').forEach((row) => {
    const expandBtn = row.querySelector<HTMLElement>('.hm-expand-btn')
    const dot = row.querySelector<HTMLElement>('.hm-fresh')
    const line = row.querySelector<HTMLElement>('.hm-name-line')
    const version = row.querySelector<HTMLElement>('.hm-version')
    let lineW = 0
    if (line) {
      for (const child of Array.from(line.children) as HTMLElement[]) lineW += child.scrollWidth
    }
    const expandW = expandBtn ? expandBtn.offsetWidth + parseFloat(getComputedStyle(expandBtn).marginRight || '0') : 0
    const dotW = dot ? dot.offsetWidth + parseFloat(getComputedStyle(dot).marginRight || '0') : 0
    max = Math.max(max, expandW + dotW + Math.max(lineW, version?.scrollWidth ?? 0))
  })
  // Chi theo noi dung cac dong; header "Ten may" khong tham gia (can giua, tag loc tu cat "..." neu chat).
  return max > 0 ? Math.ceil(max) + 2 : 0
}

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

// Quat GPU (% dieu khien): may khong bao quat (fanPct null/khong co) -> fanTone 'neutral' -> khong dem,
// khong hien nut -- dung "khong co data thi thoi".
const FAN_METRIC: AlertMetric = {
  id: 'fan',
  label: 'quạt',
  icon: Fan,
  toneOf: (hw) => fanTone(hw.gpu.fanPct ?? null),
  levels: {
    danger: `quay rất mạnh, trên ${FAN_DANGER_PCT}%`,
    warning: `quay mạnh, trên ${FAN_WARN_PCT}%`,
  },
  tagLabel: { danger: 'Quạt rất mạnh', warning: 'Quạt mạnh' },
}

// hwm.exe bao phan lay hong (hardware.errors): hong 'hardware' = mat sach so lieu cam bien (vd crash
// 0xE0434352 cua thu vien .NET, timeout) -> danger; chi hong phan khac (vd 'winlicense') -> warning.
function hwErrorTone(hw: WorkstationHardware | null | undefined): StatusTone {
  const errors = hw?.errors
  if (!errors || errors.length === 0) return 'neutral'
  return errors.some((e) => e.part === 'hardware') ? 'danger' : 'warning'
}

const HW_ERROR_METRIC: AlertMetric = {
  id: 'error',
  label: 'đọc dữ liệu',
  icon: Warning,
  toneOf: (hw) => hwErrorTone(hw),
  levels: {
    danger: 'lỗi, không đọc được cảm biến',
    warning: 'thiếu một phần',
  },
  tagLabel: { danger: 'Lỗi cảm biến', warning: 'Thiếu dữ liệu' },
}

const ALERT_DEVICES: AlertDevice[] = [
  { id: 'gpu', label: 'GPU', icon: GraphicsCard, metrics: [tempMetric((hw) => hw.gpu.tempC), FAN_METRIC] },
  { id: 'cpu', label: 'CPU', icon: Cpu, metrics: [tempMetric((hw) => hw.cpu.tempC)] },
  // Tag loc cua nhom nay gan o header cot "Ten may" (filterTag('hwm')).
  { id: 'hwm', label: 'Máy trạm', icon: Warning, metrics: [HW_ERROR_METRIC] },
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

function FanCell({ value }: { value: number | null | undefined }) {
  const tone = fanTone(value ?? null)
  return (
    <Cell
      text={num(value, '%')}
      value={value ?? null}
      tone={tone}
      tip={tone === 'danger' ? `Quạt quay rất mạnh: trên ${FAN_DANGER_PCT}%` : `Quạt quay mạnh: trên ${FAN_WARN_PCT}%`}
    />
  )
}

// hwm.exe gui moi ~3,5-4 phut (timer 213s cua Scheduler) -> trong 10 phut van co du lieu = gui deu.
const DATA_FRESH_MS = 10 * 60_000

/** Cham DO TUOI du lieu phan cung o DAU dong (truoc ten may): xanh = nhan du lieu trong 10 phut,
    vang = lau hon, xam mo = may da tat. Chua tung co du lieu (hwm tat / Server vua khoi dong) ->
    o trong cung kich thuoc (giu ten may thang hang). */
function DataFreshDot({
  hw,
  offline,
  nowMs,
}: {
  hw: WorkstationHardware | null
  offline: boolean
  nowMs: number
}) {
  let dot: 'success' | 'warning' | 'off' | null = null
  let tip: string | undefined
  if (offline) {
    dot = 'off'
    tip = 'Máy đã tắt / mất kết nối'
  } else if (hw?.updatedAtSec) {
    const fresh = nowMs - hw.updatedAtSec * 1000 <= DATA_FRESH_MS
    const last = formatUpdated(hw.updatedAtSec, nowMs)
    dot = fresh ? 'success' : 'warning'
    tip = fresh
      ? `Máy trạm gửi dữ liệu phần cứng đều đặn (lần gần nhất: ${last})`
      : `Quá ${DATA_FRESH_MS / 60_000} phút chưa nhận dữ liệu phần cứng (lần gần nhất: ${last})`
  }
  return (
    <span
      className={`hm-dot hm-fresh${dot ? ` hm-dot--${dot}` : ''}`}
      title={tip}
      role={tip ? 'img' : undefined}
      aria-label={tip}
      aria-hidden={tip ? undefined : true}
    />
  )
}

function ramUsage(ram: WorkstationHardware['ram'] | undefined) {
  if (!ram || ram.usedGB === null || ram.availableGB === null) return null
  return `${ram.usedGB.toFixed(1)} / ${(ram.usedGB + ram.availableGB).toFixed(1)} GB`
}

/** "Vừa xong" / "1 ph trước" / "2 giờ trước"...; qua 24h thi hien ngay gio tuyet doi. Dang thu gon
    (vd "phút" -> "ph") cho vua cot hep -- Intl.RelativeTimeFormat 'vi' khong co dang ngan nay.
    nowMs = gio SERVER uoc tinh (updatedAtSec la gio Server nhan du lieu; trinh duyet co the lech gio). */
function formatUpdated(sec: number | null | undefined, nowMs: number) {
  if (!sec) return null
  const ms = sec * 1000
  const diffMinutes = Math.round((ms - nowMs) / 60_000)
  if (Math.abs(diffMinutes) < 1) return 'vừa xong'
  if (Math.abs(diffMinutes) < 60) return `${Math.abs(diffMinutes)} ph trước`
  const diffHours = Math.round(diffMinutes / 60)
  if (Math.abs(diffHours) < 24) return `${Math.abs(diffHours)} giờ trước`
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
  stack,
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
  /** Xep doc (tieu de tren, tag loc duoi) -- cho cot hep chiem ca 2 hang header (vd "Ten may"),
      tag nam ngang se tran sang cot ben canh. */
  stack?: boolean
  children: ReactNode
}) {
  return (
    <div
      role="columnheader"
      className={`hm-hc${start ? ' hm-hc--start' : ''}${group ? ' hm-hc--group' : ''}${divider ? ' hm-hc--divider' : ''}${stack ? ' hm-hc--stack' : ''}`}
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

// Cac ten/model phan cung CHUA co cot rieng trong luoi (chi hien tri so nhu nhiet/tai/cong suat o cot) --
// bam nut mo rong o cot "Ten may" moi thay. fanRpm la so vong/phut, khac fanPct (%) da co cot.
function hardwareDetailItems(hw: WorkstationHardware | null) {
  if (!hw) return null
  return [
    {
      id: 'cpu',
      icon: Cpu,
      label: 'CPU',
      value: joinParts([
        hw.cpu.name,
        hw.cpu.cores !== null && hw.cpu.threads !== null ? `${hw.cpu.cores} nhân / ${hw.cpu.threads} luồng` : null,
      ]),
    },
    {
      id: 'gpu',
      icon: GraphicsCard,
      label: 'GPU',
      value: joinParts([hw.gpu.name, num(hw.gpu.memoryMB, ' MB VRAM'), num(hw.gpu.fanRpm, ' RPM quạt')]),
    },
    { id: 'ram', icon: Memory, label: 'RAM', value: hw.ram.name ?? NO_DATA },
    { id: 'storage', icon: HardDrive, label: 'Ổ cứng', value: hw.storage.name ?? NO_DATA },
    { id: 'network', icon: Network, label: 'Mạng', value: hw.network.name ?? NO_DATA },
    { id: 'motherboard', icon: Circuitry, label: 'Bo mạch', value: hw.motherboard ?? NO_DATA },
  ]
}

export function HealthMonitorPage() {
  const [search, setSearch] = useState('')
  const [expandedHosts, setExpandedHosts] = useState<Set<string>>(new Set())
  const toggleExpand = (hostName: string) =>
    setExpandedHosts((current) => {
      const next = new Set(current)
      if (next.has(hostName)) next.delete(hostName)
      else next.add(hostName)
      return next
    })

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

  // Gio SERVER uoc tinh = gio trinh duyet + do lech do duoc o lan tai runtime gan nhat (serverTimeMs la
  // gio Server luc tra ve, dataUpdatedAt la gio trinh duyet luc nhan). updatedAtSec cua phan cung la gio
  // Server -> so voi gio Server, khong bi lech khi may xem web chay sai gio. Render lai moi 15s (forceTick).
  const runtimeSnapshot = Array.isArray(runtimeQuery.data) ? null : runtimeQuery.data
  const serverOffsetMs = runtimeSnapshot?.serverTimeMs ? runtimeSnapshot.serverTimeMs - runtimeQuery.dataUpdatedAt : 0
  const nowServerMs = Date.now() + serverOffsetMs

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
        <span className="hm-filter-tag__label">{activeFilter.metric.tagLabel[activeFilter.tone]}</span>
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
  // Cot ten may rong theo dong dai nhat (xem measureNameColumn). Do lai khi danh sach dong doi (them/bot
  // may, loc, ten/canh bao doi). Do rong do duoc KHONG phu thuoc do rong cot hien tai (scrollWidth = noi
  // dung tu nhien, o thoi gian co min-width co dinh) nen khong lap vo han.
  const tableRef = useRef<HTMLDivElement>(null)
  const [nameColPx, setNameColPx] = useState<number | null>(null)
  useLayoutEffect(() => {
    if (!tableRef.current) return
    const width = measureNameColumn(tableRef.current)
    if (width > 0) setNameColPx(width)
  }, [rows])

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
        <div
          ref={tableRef}
          className="hm-table"
          role="table"
          aria-rowcount={rows.length + 2}
          style={gridStyleFor(nameColPx)}
        >
          {/* Header LUON hien du cot, bat ke trang thai tai du lieu. */}
          <div className="hm-head ws-table__header" role="rowgroup">
            <Head col={1} row="both" stack>
              <span>Tên máy</span>
              {filterTag('hwm')}
            </Head>
            <Head col={2} span={3} row={1} icon={Cpu} group divider>CPU{filterTag('cpu')}</Head>
            <Head col={5} span={4} row={1} icon={GraphicsCard} group divider>GPU{filterTag('gpu')}</Head>
            <Head col={9} span={2} row={1} icon={Memory} group divider>RAM</Head>
            <Head col={11} span={2} row={1} icon={HardDrive} group divider>Ổ cứng</Head>
            <Head col={13} span={2} row={1} icon={Network} group divider>Mạng</Head>

            <Head col={2} row={2} icon={Thermometer} divider>Nhiệt độ</Head>
            <Head col={3} row={2} icon={Speedometer}>Tải</Head>
            <Head col={4} row={2} icon={Lightning}>Công suất</Head>
            <Head col={5} row={2} icon={Thermometer} divider>Nhiệt độ</Head>
            <Head col={6} row={2} icon={Speedometer}>Tải</Head>
            <Head col={7} row={2} icon={Lightning}>Công suất</Head>
            <Head col={8} row={2} icon={Fan}>Quạt</Head>
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
              {rows.map(({ machine, hw }) => {
                const offline = machine.status === WORKSTATION_STATUS.DISCONNECT
                const errTone = hwErrorTone(hw)
                const errTitle = hardwareErrorsTitle(hw?.errors)
                const isExpanded = expandedHosts.has(machine.hostName)
                const detailItems = isExpanded ? hardwareDetailItems(hw) : null
                return (
                <Fragment key={machine.hostName}>
                <div className="hm-row" role="row">
                  <Body start>
                    <button
                      type="button"
                      className="hm-expand-btn"
                      aria-expanded={isExpanded}
                      aria-label={isExpanded ? `Thu gọn thông tin phần cứng ${machine.hostName}` : `Xem tên/model phần cứng ${machine.hostName}`}
                      onClick={() => toggleExpand(machine.hostName)}
                    >
                      <CaretRight size={12} weight="bold" className={`hm-expand-icon${isExpanded ? ' hm-expand-icon--open' : ''}`} aria-hidden="true" />
                    </button>
                    <DataFreshDot hw={hw} offline={offline} nowMs={nowServerMs} />
                    {/* Ten may (+ canh bao loi doc du lieu) o dong tren, phien ban FNet chu nho mo o duoi. */}
                    <span className="hm-name-block">
                      <span className="hm-name-line">
                        <strong
                          className={`hm-name${offline ? ' hm-name--offline' : ''}`}
                          title={offline ? 'Máy đã tắt / mất kết nối' : undefined}
                        >
                          {machine.hostName}
                        </strong>
                        {errTitle ? (
                          <span
                            className={`hm-hwerr hm-hwerr--${errTone}`}
                            title={`Máy trạm gửi thiếu dữ liệu:\n${errTitle}`}
                            aria-label={`Máy trạm gửi thiếu dữ liệu: ${errTitle}`}
                          >
                            <Warning size={14} weight="fill" aria-hidden="true" />
                          </span>
                        ) : null}
                        {/* Thoi diem nhan du lieu phan cung gan nhat -- ngay sau ten may (gop cot "Cap nhat" cu). */}
                        {offline ? (
                          <span className="hm-updated hm-updated--offline">Đã tắt</span>
                        ) : (
                          <span
                            className="hm-updated"
                            title={hw?.updatedAtSec ? new Date(hw.updatedAtSec * 1000).toLocaleString('vi-VN') : undefined}
                          >
                            {formatUpdated(hw?.updatedAtSec, nowServerMs) ?? NO_DATA}
                          </span>
                        )}
                      </span>
                      {machine.version ? (
                        <span className="hm-version" title="Phiên bản FNet trên máy trạm">
                          {machine.version}
                        </span>
                      ) : null}
                    </span>
                  </Body>
                  <Body divider><TempCell value={hw?.cpu.tempC} /></Body>
                  <Body><LoadCell value={hw?.cpu.loadPct} /></Body>
                  <Body><Cell text={num(hw?.cpu.powerW, ' W')} value={hw?.cpu.powerW ?? null} /></Body>
                  <Body divider><TempCell value={hw?.gpu.tempC} /></Body>
                  <Body><LoadCell value={hw?.gpu.loadPct} /></Body>
                  <Body><Cell text={num(hw?.gpu.powerW, ' W')} value={hw?.gpu.powerW ?? null} /></Body>
                  <Body><FanCell value={hw?.gpu.fanPct} /></Body>
                  <Body divider><LoadCell value={hw?.ram.loadPct} /></Body>
                  <Body><Cell text={ramUsage(hw?.ram)} value={hw?.ram.usedGB ?? null} /></Body>
                  <Body divider><TempCell value={hw?.storage.tempC} /></Body>
                  <Body><LoadCell value={hw?.storage.loadPct} /></Body>
                  <Body divider><Cell text={dataVolume(hw?.network.uploadGB)} value={hw?.network.uploadGB ?? null} /></Body>
                  <Body><Cell text={dataVolume(hw?.network.downloadGB)} value={hw?.network.downloadGB ?? null} /></Body>
                </div>
                {isExpanded ? (
                  <div className="hm-detail">
                    {detailItems === null ? (
                      <span className="hm-detail__empty">Chưa có dữ liệu phần cứng.</span>
                    ) : (
                      detailItems.map((item) => {
                        const Icon = item.icon
                        return (
                          <span key={item.id} className="hm-detail__item">
                            <span className="hm-detail__label"><Icon size={16} weight="light" aria-hidden="true" /> {item.label}</span>
                            <span className="hm-detail__value">{item.value}</span>
                          </span>
                        )
                      })
                    )}
                  </div>
                ) : null}
                </Fragment>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
