import { wsClient } from '../ws/wsClient'

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

export function closeAllWorkstationApps(hostName: string) {
  return wsClient.request<AppsCloseData>(
    'workstation.apps.close',
    { hostName, all: true },
    undefined,
    'workstation.apps.close.result',
  )
}
