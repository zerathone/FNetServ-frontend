import { wsClient } from '../ws/wsClient'
import { apiPostBlob } from './client'

// task 2.44-B6/B7 (§17-IMPL): danh sách app đang chạy + đóng app trên máy trạm, qua WebSocket
// (không phải REST) vì cần round-trip với client. `apps.get` mở MODAL chặn UI MFC ở quầy --
// GỌI KHI NGƯỜI DÙNG BẤM, KHÔNG poll định kỳ (xem cảnh báo §17-IMPL).

export type WorkstationApp = {
  pid: number
  title: string
  visible: boolean
  filePath: string
  closable: boolean
}

type AppsGetData = { hostName: string; status: string; apps: WorkstationApp[] }
type AppsCloseData = { hostName: string; status: string }

export function getWorkstationApps(hostName: string) {
  return wsClient
    .request<AppsGetData>('workstation.apps.get', { hostName })
    .then((data) => data.apps)
}

export function closeWorkstationApp(
  hostName: string,
  app: Pick<WorkstationApp, 'pid' | 'title' | 'filePath' | 'visible'>,
) {
  return wsClient.request<AppsCloseData>(
    'workstation.apps.close',
    { hostName, app },
    undefined,
    'workstation.apps.close.result',
  )
}

// task 2.22r-B: chụp màn hình = ảnh tĩnh, bấm mới chụp, KHÔNG poll. Lệnh WS chỉ trả `imageId`;
// ảnh tải qua REST (không qua frame WS — tránh làm trễ event tiền của mọi phiên).
// Server chờ máy trạm tối đa ~10 s + pending 12 s => client đợi 15 s.
const SCREEN_CAPTURE_TIMEOUT_MS = 15_000

type ScreenCaptureData = {
  hostName: string
  status: string
  imageId: string
  mime: string
  width: number
  height: number
  originalWidth: number
  originalHeight: number
  bytes: number
}

export type WorkstationScreenshot = Omit<ScreenCaptureData, 'status' | 'imageId' | 'mime'> & {
  blob: Blob
  /** ms từ lúc bấm tới khi có ảnh (phục vụ so sánh/đo). */
  elapsedMs: number
}

export async function captureWorkstationScreen(hostName: string): Promise<WorkstationScreenshot> {
  const started = performance.now()
  const data = await wsClient.request<ScreenCaptureData>(
    'workstation.screen.capture',
    { hostName },
    SCREEN_CAPTURE_TIMEOUT_MS,
  )
  const blob = await apiPostBlob('/workstations/screen/image', { imageId: data.imageId })
  return {
    hostName: data.hostName,
    width: data.width,
    height: data.height,
    originalWidth: data.originalWidth,
    originalHeight: data.originalHeight,
    bytes: data.bytes,
    blob,
    elapsedMs: Math.round(performance.now() - started),
  }
}

// task 2.22r-C/D: điều khiển từ xa — 2 engine để user TEST SO SÁNH (quyết định #3):
//   legacy = server mở winviewer trên MÁY QUẦY (như menu MFC);
//   novnc  = xem/điều khiển ngay trong trình duyệt qua cầu nối /ws/vnc (ticket dùng 1 lần, ~30 s).
// Client phải tắt + mở lại winshower nên server chờ tới 15 s => client đợi 20 s.
const REMOTE_START_TIMEOUT_MS = 20_000

export type RemoteEngine = 'legacy' | 'novnc'
export type RemoteMode = 'view' | 'control'

export type RemoteStartResult = {
  hostName: string
  status: string
  engine: RemoteEngine
  mode: RemoteMode
  /** chỉ engine novnc: vé dùng 1 lần để mở /ws/vnc. */
  ticket?: string
  /** chỉ engine novnc: mật khẩu VNC — KHÔNG log, KHÔNG lưu. */
  password?: string
  /** true = winshower đã chạy sẵn, server KHÔNG khởi động lại (không làm rớt viewer khác). */
  vncReused?: boolean
  /** ms từ lúc bấm tới khi server trả kết quả. */
  elapsedMs: number
}

export async function startWorkstationRemote(
  hostName: string,
  engine: RemoteEngine,
  mode: RemoteMode,
): Promise<RemoteStartResult> {
  const started = performance.now()
  const data = await wsClient.request<Omit<RemoteStartResult, 'elapsedMs'>>(
    'workstation.remote.start',
    { hostName, data: { engine, mode } },
    REMOTE_START_TIMEOUT_MS,
  )
  return { ...data, elapsedMs: Math.round(performance.now() - started) }
}

export function closeAllWorkstationApps(hostName: string) {
  return wsClient.request<AppsCloseData>(
    'workstation.apps.close',
    { hostName, all: true },
    undefined,
    'workstation.apps.close.result',
  )
}
