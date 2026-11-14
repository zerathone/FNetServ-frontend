// Dữ liệu GIẢ cho trang Theo dõi hoạt động (/health_monitor) — sửa thoải mái ở đây rồi xem kết quả trên UI.
//
// Bật mock (chỉ chạy `npm run dev`, không bao giờ vào bản build):
//   thêm vào `fnet-web/.env.development.local` (file *.local không commit) một dòng
//     VITE_HEALTH_MONITOR_MOCK=1
//   rồi khởi động lại `npm run dev`. Bỏ dòng đó (hoặc đặt 0) để quay về server thật.
//
// Giá trị của VITE_HEALTH_MONITOR_MOCK:
//   1         dữ liệu mẫu bên dưới, MỖI LẦN TẢI số nhảy nhẹ (nhiệt độ/tải ± vài đơn vị) — để thấy ô sáng màu + mũi tên
//             ▲/▼ khi giá trị đổi (trang tự tải lại mỗi 30 giây, hoặc bấm cụm "Làm mới")
//   static    như 1 nhưng số đứng yên — để chụp ảnh / so sánh
//   ok        mọi máy bình thường, không có cảnh báo — thanh thống kê và badge ở menu biến mất
//   hot       gần như máy nào cũng nóng / quạt quay mạnh — xem trang khi cảnh báo dày đặc
//   nodata    có danh sách máy nhưng CHƯA máy nào gửi phần cứng (hwm tắt / Server vừa khởi động) — toàn dấu "—"
//   empty     chưa có máy trạm nào
//   error     cả danh sách máy lẫn phần cứng trả lỗi — xem trạng thái lỗi + nút Thử lại
//   hwerror   chỉ API phần cứng lỗi (danh sách máy vẫn có) — trang không báo lỗi, ô phần cứng hiện "—"
//   slow      như 1 nhưng mỗi request trễ 3 giây
//   many      400 máy (PC-001…PC-400, 3 nhóm máy) trộn ONLINE / AVAILABLE / DISCONNECT + vài máy nóng / lỗi cảm biến /
//             chưa gửi phần cứng — để ĐO render (task web-render-diet: trang Máy trạm, Theo dõi hoạt động). Giống server thật:
//             mỗi lần gọi /workstations/runtime, MỌI máy có `updatedAtMs` mới và máy ONLINE đổi `usedSeconds` (nên mọi object
//             máy đều là tham chiếu mới sau mỗi poll). Cần bật kèm VITE_WORKSTATIONS_MOCK=1 để /machinegroup có nhóm máy.
//
// Danh sách máy = 6 máy mẫu của trang Đơn dịch vụ (ordersMock.ts) + 8 máy thêm ở đây, nên bật cùng
// VITE_WORKSTATIONS_MOCK / VITE_ORDERS_MOCK không làm vỡ kịch bản bên đó. Khi bật biến này, trang Máy trạm
// cũng thấy 14 máy này (chung đường dẫn /workstations/runtime) và ngăn kéo chi tiết máy lấy phần cứng từ đây.
//
// Kịch bản có chủ ý (mode 1 / static), đối chiếu ngưỡng ở features/workstations/MachineTechExtras.tsx:
//   PC-07   GPU 76°C                      → warning "Nóng"
//   PC-09   GPU 84°C + quạt 85%           → danger "Quá nhiệt" + "Quạt rất mạnh"
//   PC-12   CPU 85°C, tải CPU 95%         → danger CPU
//   PC-01   CPU 73°C                      → warning CPU
//   VIP-01  quạt GPU 75%, GPU tải 88%     → warning quạt + tải cao
//   PC-04   hwm.exe hỏng phần 'hardware'  → danger "Lỗi cảm biến" (mất sạch số liệu)
//   PC-10   hwm.exe hỏng phần 'winlicense'→ warning "Thiếu dữ liệu" (cảm biến vẫn có)
//   PC-08   gửi dữ liệu cách đây 25 phút  → chấm vàng "quá 10 phút", server cũ không có quạt
//   PC-05   máy đã tắt (DISCONNECT)       → chấm xám, nhãn "Đã tắt"
//   PC-06   chưa từng gửi phần cứng       → cả hàng "—"

import { ApiError } from './client'
import { station, workstations, type MockResult } from './ordersMock'
import type {
  WorkstationHardware,
  WorkstationHardwareAllResponse,
  WorkstationHardwareResponse,
  WorkstationRuntime,
  WorkstationsRuntimeSnapshot,
} from './workstations'

const MIN_SEC = 60

type HardwareSpec = {
  cpuTemp?: number
  cpuLoad?: number
  gpuTemp?: number
  gpuLoad?: number
  /** undefined = server cũ không có trường quạt */
  gpuFan?: number
  ramUsed?: number
  netLoad?: number
  ssdLoad?: number
  ssdTemp?: number
  errors?: WorkstationHardware['errors']
  /** Dữ liệu cũ bao nhiêu phút (tính từ lúc request). */
  ageMin?: number
}

type Profile = {
  hostName: string
  /** null = máy chưa từng gửi phần cứng → KHÔNG nằm trong items của /hardware/all. */
  spec: HardwareSpec | null
  /** Máy thêm ở đây; máy lấy từ ordersMock thì để trống. */
  extra?: WorkstationRuntime
}

const RAM_TOTAL_GB = 16

function buildHardware(spec: HardwareSpec, nowSec: number): WorkstationHardware {
  const {
    cpuTemp = 52,
    cpuLoad = 28,
    gpuTemp = 58,
    gpuLoad = 41,
    gpuFan = 46,
    ramUsed = 7.4,
    netLoad = 6,
    ssdLoad = 12,
    ssdTemp = 41,
    errors,
    ageMin = 1,
  } = spec
  // Hỏng phần 'hardware' = mất sạch số liệu cảm biến (đúng như hwm.exe thật khi crash/timeout).
  const lostSensors = errors?.some((e) => e.part === 'hardware') ?? false
  const sensor = <T>(value: T): T | null => (lostSensors ? null : value)
  return {
    updatedAtSec: nowSec - ageMin * MIN_SEC,
    cpu: {
      name: 'Intel Core i5-12400F',
      cores: 6,
      threads: 12,
      loadPct: sensor(cpuLoad),
      tempC: sensor(cpuTemp),
      powerW: sensor(48),
    },
    gpu: {
      name: 'NVIDIA GeForce RTX 3060',
      loadPct: sensor(gpuLoad),
      tempC: sensor(gpuTemp),
      memoryMB: sensor(3_400),
      powerW: sensor(96),
      // Máy server cũ không gửi quạt: bỏ hẳn trường (undefined) chứ không phải null.
      ...(spec.gpuFan === undefined && 'gpuFan' in spec ? {} : { fanPct: sensor(gpuFan), fanRpm: sensor(Math.round(gpuFan * 22)) }),
    },
    ram: {
      name: 'DDR4 3200',
      usedGB: sensor(ramUsed),
      availableGB: sensor(RAM_TOTAL_GB - ramUsed),
      loadPct: sensor(Math.round((ramUsed / RAM_TOTAL_GB) * 100)),
    },
    motherboard: 'MSI PRO B660M-A',
    network: { name: 'Realtek PCIe GbE', loadPct: sensor(netLoad), uploadGB: sensor(2.6), downloadGB: sensor(11.8) },
    storage: { name: 'Samsung SSD 980 500GB', loadPct: sensor(ssdLoad), tempC: sensor(ssdTemp) },
    ...(errors && errors.length > 0 ? { errors } : {}),
  }
}

const PROFILES: Profile[] = [
  { hostName: 'PC-02', spec: {} },
  { hostName: 'PC-03', spec: { cpuLoad: 45, gpuLoad: 72, gpuTemp: 66, ramUsed: 9.8 } },
  { hostName: 'PC-07', spec: { gpuLoad: 83, gpuTemp: 76, gpuFan: 62 } },
  { hostName: 'PC-09', spec: { cpuTemp: 66, cpuLoad: 71, gpuLoad: 96, gpuTemp: 84, gpuFan: 85, ramUsed: 12.1 } },
  { hostName: 'PC-11', spec: { cpuLoad: 3, gpuLoad: 1, gpuTemp: 38, gpuFan: 28, cpuTemp: 36, ramUsed: 3.1, netLoad: 0 } },
  { hostName: 'VIP-04', spec: { cpuLoad: 52, gpuLoad: 64, gpuTemp: 63, ramUsed: 10.4 } },
  { hostName: 'PC-01', spec: { cpuTemp: 73, cpuLoad: 62, ramUsed: 8.9 }, extra: station('PC-01', 3, { userId: 9002, userName: null, userGroupType: 1 }, 1) },
  { hostName: 'PC-04', spec: { errors: [{ part: 'hardware', message: 'crash 0xE0434352' }] }, extra: station('PC-04', 3, { userId: 515, userName: 'baoanh', userGroupType: 2 }, 4) },
  { hostName: 'PC-05', spec: { ageMin: 180 }, extra: station('PC-05', 2, { userId: 0, userName: null, userGroupType: 0 }, 5) },
  { hostName: 'PC-06', spec: null, extra: station('PC-06', 1, { userId: 0, userName: null, userGroupType: 0 }, 6) },
  { hostName: 'PC-08', spec: { ageMin: 25, cpuLoad: 34, gpuFan: undefined }, extra: station('PC-08', 3, { userId: 633, userName: 'tuankiet', userGroupType: 2 }, 8) },
  { hostName: 'PC-10', spec: { errors: [{ part: 'winlicense', message: 'connect 0x80041003' }] }, extra: station('PC-10', 3, { userId: 9003, userName: null, userGroupType: 1 }, 10) },
  { hostName: 'PC-12', spec: { cpuTemp: 85, cpuLoad: 95, gpuLoad: 55, ramUsed: 14.2 }, extra: station('PC-12', 3, { userId: 701, userName: 'ngocmai', userGroupType: 2 }, 12) },
  { hostName: 'VIP-01', spec: { gpuLoad: 88, gpuTemp: 69, gpuFan: 75, cpuLoad: 58, ramUsed: 11.0 }, extra: station('VIP-01', 3, { userId: 9101, userName: 'ob-vip01', userGroupType: 5 }, 1) },
]

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const jitter = (value: number, spread: number, min: number, max: number) =>
  clamp(Math.round(value + (Math.random() * 2 - 1) * spread), min, max)

/** Làm số nhảy nhẹ để thấy hiệu ứng ô sáng màu + ▲/▼ khi giá trị đổi giữa 2 lần tải. */
function jittered(spec: HardwareSpec): HardwareSpec {
  return {
    ...spec,
    ...(spec.cpuTemp !== undefined && { cpuTemp: jitter(spec.cpuTemp, 2, 30, 95) }),
    ...(spec.gpuTemp !== undefined && { gpuTemp: jitter(spec.gpuTemp, 2, 30, 95) }),
    cpuLoad: jitter(spec.cpuLoad ?? 28, 6, 0, 100),
    gpuLoad: jitter(spec.gpuLoad ?? 41, 8, 0, 100),
    ...(spec.gpuFan !== undefined && { gpuFan: jitter(spec.gpuFan, 3, 20, 100) }),
  }
}

function calm(spec: HardwareSpec): HardwareSpec {
  return {
    ...spec,
    cpuTemp: Math.min(spec.cpuTemp ?? 52, 62),
    cpuLoad: Math.min(spec.cpuLoad ?? 28, 60),
    gpuTemp: Math.min(spec.gpuTemp ?? 58, 64),
    gpuLoad: Math.min(spec.gpuLoad ?? 41, 70),
    ...(spec.gpuFan !== undefined && { gpuFan: Math.min(spec.gpuFan, 55) }),
    errors: undefined,
  }
}

function hot(spec: HardwareSpec): HardwareSpec {
  return {
    ...spec,
    cpuTemp: Math.max(spec.cpuTemp ?? 52, 74 + Math.round(Math.random() * 14)),
    gpuTemp: Math.max(spec.gpuTemp ?? 58, 72 + Math.round(Math.random() * 16)),
    ...(spec.gpuFan !== undefined && { gpuFan: Math.max(spec.gpuFan, 72 + Math.round(Math.random() * 20)) }),
  }
}

function specFor(mode: string, spec: HardwareSpec): HardwareSpec {
  if (mode === 'static') return spec
  if (mode === 'ok') return calm(spec)
  if (mode === 'hot') return hot(jittered(spec))
  return jittered(spec)
}

// ----- Kịch bản `many`: 400 máy sinh theo công thức (xác định, không random trừ phần jitter như server thật) -----
const MANY_COUNT = 400

type ManyMachine = {
  hostName: string
  status: number
  who: { userId: number; userName: string | null; userGroupType: number }
  index: number
  groupId: number
  spec: HardwareSpec | null
}

const MANY_MACHINES: ManyMachine[] = Array.from({ length: MANY_COUNT }, (_, i) => {
  const n = i + 1
  const status = n % 10 === 0 ? 2 : n % 4 === 0 ? 1 : 3 // DISCONNECT / AVAILABLE / ONLINE
  const member = n % 3 !== 0
  const who =
    status === 3
      ? member
        ? { userId: 1000 + n, userName: `hoivien${n}`, userGroupType: 2 }
        : { userId: 9000 + n, userName: null, userGroupType: 1 }
      : { userId: 0, userName: null, userGroupType: 0 }
  let spec: HardwareSpec | null = { cpuLoad: 20 + (n % 50), gpuLoad: 15 + ((n * 7) % 60), ramUsed: 4 + (n % 10) }
  if (n % 61 === 0) spec = null // chưa từng gửi phần cứng
  else if (n % 53 === 0) spec = { errors: [{ part: 'hardware', message: 'crash 0xE0434352' }] }
  else if (n % 37 === 0) spec = { cpuTemp: 85, cpuLoad: 95, gpuTemp: 84, gpuFan: 85 }
  else if (n % 29 === 0) spec = { gpuTemp: 76, gpuFan: 62 }
  return {
    hostName: `PC-${String(n).padStart(3, '0')}`,
    status,
    who,
    index: n % 200,
    groupId: 1 + (n % 3),
    spec: status === 2 ? { ...(spec ?? {}), ageMin: 90 } : spec,
  }
})

function manySnapshot(): WorkstationsRuntimeSnapshot {
  return {
    serverTimeMs: Date.now(),
    items: MANY_MACHINES.map((m) => {
      // station() gán updatedAtMs = Date.now() mỗi lần gọi; máy ONLINE thêm usedSeconds đổi như server thật.
      const machine = station(m.hostName, m.status, m.who, m.index, m.groupId)
      return machine.session
        ? { ...machine, session: { ...machine.session, usedSeconds: (machine.session.usedSeconds ?? 0) + Math.floor(Math.random() * 60) } }
        : machine
    }),
  }
}

function runtimeSnapshot(mode: string): WorkstationsRuntimeSnapshot {
  if (mode === 'many') return manySnapshot()
  if (mode === 'empty') return { serverTimeMs: Date.now(), items: [] }
  const base = workstations()
  const known = new Set(base.items.map((m) => m.hostName))
  const extras = PROFILES.flatMap((p) => (p.extra && !known.has(p.hostName) ? [p.extra] : []))
  return { serverTimeMs: base.serverTimeMs, items: [...base.items, ...extras] }
}

function hardwareAll(mode: string): WorkstationHardwareAllResponse {
  if (mode === 'empty' || mode === 'nodata') return { items: [] }
  const nowSec = Math.floor(Date.now() / 1000)
  const profiles: Profile[] = mode === 'many' ? MANY_MACHINES : PROFILES
  return {
    items: profiles.flatMap((p) =>
      p.spec ? [{ hostName: p.hostName, hardware: buildHardware(specFor(mode, p.spec), nowSec) }] : [],
    ),
  }
}

function hardwareOne(mode: string, hostName: string): WorkstationHardwareResponse {
  const found = hardwareAll(mode).items.find((i) => i.hostName.toLowerCase() === hostName.toLowerCase())
  return { hostName, hardware: found?.hardware ?? null }
}

const delay = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms))

/** Gọi từ api/client.ts. `handled:false` = endpoint không thuộc mock, client tự gọi server thật. */
export async function mockHealthRequest(mode: string, path: string): Promise<MockResult> {
  const url = new URL(path, 'http://mock.local')
  const isRuntime = url.pathname === '/workstations/runtime'
  const isHardwareAll = url.pathname === '/workstations/hardware/all'
  const isHardwareOne = url.pathname === '/workstations/hardware'
  if (!isRuntime && !isHardwareAll && !isHardwareOne) return { handled: false }

  await delay(mode === 'slow' ? 3000 : 200)
  const failing = mode === 'error' || (mode === 'hwerror' && !isRuntime)
  if (failing) throw new ApiError('Mock: server trả lỗi', { httpStatus: 500 })

  if (isRuntime) return { handled: true, data: runtimeSnapshot(mode) }
  if (isHardwareAll) return { handled: true, data: hardwareAll(mode) }
  return { handled: true, data: hardwareOne(mode, url.searchParams.get('hostName') ?? '') }
}
