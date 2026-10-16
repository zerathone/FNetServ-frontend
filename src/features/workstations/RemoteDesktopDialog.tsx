import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  startWorkstationRemote,
  type RemoteEngine,
  type RemoteMode,
  type RemoteStartResult,
} from '../../api/workstationRealtime'
import { Button, Dialog, InlineAlert, Segmented } from '../../design-system/components'
import { useWsStatusStore } from '../../store/wsStatus'

// task 2.22r-C/D: hộp thoại "Điều khiển từ xa" — TÍNH NĂNG THỬ NGHIỆM, cho user chọn engine để
// SO SÁNH TRỰC TIẾP (quyết định #3): VNC legacy (viewer mở trên máy quầy) vs noVNC (ngay trong
// trình duyệt), mỗi engine 2 chế độ Chỉ xem / Điều khiển. Mọi lệnh đi qua server (WS), quyền
// R_REMOTE_MACHINE kiểm ở server.
//
// Parent chỉ MOUNT khi mở. Kết quả noVNC (vé + mật khẩu) trả lên qua `onNoVncReady` để parent mở
// trình xem toàn màn hình — vé/mật khẩu chỉ nằm trong bộ nhớ, không vào URL trang/lịch sử.

type Props = {
  hostName: string
  onClose: () => void
  onNoVncReady: (result: RemoteStartResult & { startedAt: number }) => void
}

export function RemoteDesktopDialog({ hostName, onClose, onNoVncReady }: Props) {
  const capabilities = useWsStatusStore((state) => state.capabilities)
  const legacyAvailable = capabilities?.remoteLegacyViewer === true
  const noVncAvailable = capabilities?.remoteNoVnc === true
  const [engine, setEngine] = useState<RemoteEngine>(noVncAvailable || !legacyAvailable ? 'novnc' : 'legacy')
  const [mode, setMode] = useState<RemoteMode>('view')
  const [legacyResult, setLegacyResult] = useState<RemoteStartResult | null>(null)

  const start = useMutation({
    mutationFn: (args: { engine: RemoteEngine; mode: RemoteMode; startedAt: number }) =>
      startWorkstationRemote(hostName, args.engine, args.mode).then((result) => ({
        ...result,
        startedAt: args.startedAt,
      })),
    onSuccess: (result) => {
      if (result.engine === 'novnc' && result.ticket && result.password) {
        onNoVncReady(result)
      } else {
        setLegacyResult(result)
      }
    },
  })

  const engineAvailable = engine === 'legacy' ? legacyAvailable : noVncAvailable
  const errorMessage = start.error instanceof Error ? start.error.message : null

  return (
    <Dialog
      open
      title="Điều khiển từ xa (thử nghiệm)"
      description={hostName}
      size="md"
      onClose={() => {
        if (!start.isPending) onClose()
      }}
      footer={
        <Button
          type="button"
          variant="primary"
          loading={start.isPending}
          disabled={!engineAvailable}
          onClick={() => {
            setLegacyResult(null)
            start.mutate({ engine, mode, startedAt: performance.now() })
          }}
        >
          Kết nối
        </Button>
      }
    >
      <div className="ws-remote">
        <div className="ws-remote__row">
          <span className="ws-remote__label">Engine</span>
          <Segmented<RemoteEngine>
            ariaLabel="Chọn engine điều khiển từ xa"
            value={engine}
            onChange={setEngine}
            disabled={start.isPending}
            options={[
              {
                value: 'legacy',
                label: 'VNC legacy',
                disabled: !legacyAvailable,
                title: legacyAvailable ? undefined : 'Máy chủ không có màn hình quầy để mở viewer',
              },
              {
                value: 'novnc',
                label: 'noVNC',
                disabled: !noVncAvailable,
                title: noVncAvailable ? undefined : 'Cầu nối noVNC đang tắt trên máy chủ (INT_WS_VNC)',
              },
            ]}
          />
        </div>
        <p className="ws-remote__hint">
          {engine === 'legacy'
            ? 'Viewer mở trên máy quầy (máy chạy phần mềm quản lý), không mở trên thiết bị này.'
            : 'Xem và điều khiển ngay trong trình duyệt này.'}
        </p>
        <div className="ws-remote__row">
          <span className="ws-remote__label">Chế độ</span>
          <Segmented<RemoteMode>
            ariaLabel="Chọn chế độ điều khiển từ xa"
            value={mode}
            onChange={setMode}
            disabled={start.isPending}
            options={[
              { value: 'view', label: 'Chỉ xem' },
              { value: 'control', label: 'Điều khiển' },
            ]}
          />
        </div>
        {capabilities === null ? (
          <InlineAlert tone="warning">Máy chủ chưa hỗ trợ điều khiển từ xa từ WebUI.</InlineAlert>
        ) : null}
        {start.isPending ? (
          <p className="ws-remote__hint" role="status">
            Đang chờ máy trạm bật VNC…
          </p>
        ) : null}
        {errorMessage ? <InlineAlert tone="warning">{errorMessage}</InlineAlert> : null}
        {legacyResult ? (
          <InlineAlert tone="success">
            Đã mở viewer trên máy quầy ({legacyResult.mode === 'view' ? 'chỉ xem' : 'điều khiển'}) sau{' '}
            {legacyResult.elapsedMs} ms.
          </InlineAlert>
        ) : null}
      </div>
    </Dialog>
  )
}
