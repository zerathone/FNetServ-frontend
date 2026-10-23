import { Cpu, Fan, GraphicsCard, Thermometer, Warning } from '@phosphor-icons/react'
import type { WorkstationHardware } from '../../api/workstations'
import type { StatusTone } from '../../design-system/components'
import {
  FAN_DANGER_PCT,
  FAN_WARN_PCT,
  fanTone,
  TEMP_DANGER_C,
  TEMP_WARN_C,
  tempTone,
} from '../workstations/MachineTechExtras'

// Luật cảnh báo phần cứng của trang "Theo dõi hoạt động" -- 1 nguồn cho cả trang (thanh thống kê + lọc bảng)
// lẫn badge ở menu trái (useHealthAlertSummary). Đổi ngưỡng/luật ở MachineTechExtras hoặc ở đây là cả 2 nơi cùng đổi.

// ---- Thong ke canh bao: moi nut = 1 chi so (nhiet/quat/loi) cua 1 linh kien o 1 muc (danger/warning),
// hien so may dang o muc do. ----
export type AlertTone = 'danger' | 'warning'

export type AlertMetric = {
  id: string
  label: string
  icon: typeof Thermometer
  toneOf: (hw: WorkstationHardware) => StatusTone
  levels: Record<AlertTone, string>
  /** Nhan ngan tren tag loc o header cot. */
  tagLabel: Record<AlertTone, string>
}

export type AlertDevice = {
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
export function hwErrorTone(hw: WorkstationHardware | null | undefined): StatusTone {
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

// Thu tu mang = thu tu uu tien (GPU -> CPU -> loi may tram); badge o menu chi hien nhom dau tien co may bi.
export const ALERT_DEVICES: AlertDevice[] = [
  { id: 'gpu', label: 'GPU', icon: GraphicsCard, metrics: [tempMetric((hw) => hw.gpu.tempC), FAN_METRIC] },
  { id: 'cpu', label: 'CPU', icon: Cpu, metrics: [tempMetric((hw) => hw.cpu.tempC)] },
  // Tag loc cua nhom nay gan o header cot "Ten may" (filterTag('hwm')).
  { id: 'hwm', label: 'Máy trạm', icon: Warning, metrics: [HW_ERROR_METRIC] },
]

export const ALERT_TONES: AlertTone[] = ['danger', 'warning']

export const alertKey = (device: AlertDevice, metric: AlertMetric, tone: AlertTone) =>
  `${device.id}.${metric.id}.${tone}`

export type HealthAlertSummary = {
  device: AlertDevice
  /** So may co it nhat 1 chi so o muc warning/danger cua nhom nay (moi may dem 1 lan). */
  count: number
  /** 'danger' neu co it nhat 1 may o muc danger, nguoc lai 'warning'. */
  tone: AlertTone
}

/**
 * Tom tat cho menu: chi 1 nhom, theo thu tu uu tien GPU -> CPU -> loi may tram; nhom khong co may nao
 * thi bo qua, khong nhom nao co may thi tra null (UI khong hien gi).
 */
export function summarizeHealthAlerts(hardwares: Array<WorkstationHardware | null>): HealthAlertSummary | null {
  for (const device of ALERT_DEVICES) {
    let count = 0
    let hasDanger = false
    for (const hw of hardwares) {
      if (!hw) continue
      let machineTone: AlertTone | null = null
      for (const metric of device.metrics) {
        const tone = metric.toneOf(hw)
        if (tone === 'danger') machineTone = 'danger'
        else if (tone === 'warning' && machineTone === null) machineTone = 'warning'
      }
      if (machineTone) {
        count += 1
        if (machineTone === 'danger') hasDanger = true
      }
    }
    if (count > 0) return { device, count, tone: hasDanger ? 'danger' : 'warning' }
  }
  return null
}
