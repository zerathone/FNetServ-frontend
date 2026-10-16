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

export function closeAllWorkstationApps(hostName: string) {
  return wsClient.request<AppsCloseData>(
    'workstation.apps.close',
    { hostName, all: true },
    undefined,
    'workstation.apps.close.result',
  )
}
