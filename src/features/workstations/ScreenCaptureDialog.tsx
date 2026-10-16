import { useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { captureWorkstationScreen, type WorkstationScreenshot } from '../../api/workstationRealtime'
import { Button, Dialog, InlineAlert } from '../../design-system/components'
import { WsCommandError } from '../../ws/wsClient'

// task 2.22r-B: "Xem màn hình" = ảnh chụp TĨNH. Mở hộp thoại là chụp 1 lần; muốn ảnh mới thì bấm
// "Chụp lại" — KHÔNG poll/auto-refresh (user chốt 2026-10-16). Ảnh đã được server thu nhỏ
// (cạnh dài ≤ 1280) để xem nhanh, không cần nét.
//
// Parent chỉ MOUNT component này khi mở (đóng = unmount) => state tự sạch, không cần reset.

type Props = {
  hostName: string
  onClose: () => void
}

type Shot = WorkstationScreenshot & { url: string; takenAt: Date }

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

export function ScreenCaptureDialog({ hostName, onClose }: Props) {
  const [shot, setShot] = useState<Shot | null>(null)
  const urlRef = useRef<string | null>(null)
  const startedRef = useRef(false)

  const capture = useMutation({
    mutationFn: (host: string) => captureWorkstationScreen(host),
    onSuccess: (result) => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
      const url = URL.createObjectURL(result.blob)
      urlRef.current = url
      setShot({ ...result, url, takenAt: new Date() })
    },
  })
  const { mutate } = capture

  // Chụp đúng 1 lần khi mở. `startedRef` chặn StrictMode (dev) chạy effect 2 lần — lệnh thứ hai
  // sẽ bị server trả `busy` vì chụp màn hình là single-flight toàn server.
  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    mutate(hostName)
  }, [hostName, mutate])

  // Unmount => trả bộ nhớ ảnh.
  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
      urlRef.current = null
    },
    [],
  )

  // Kèm mã lý do server trả (vd `no_connection` = máy trạm không kết nối ngược về được,
  // `pixels_timeout` = gửi ảnh quá chậm) để hỗ trợ kỹ thuật biết kẹt ở bước nào.
  const errorReason = capture.error instanceof WsCommandError ? capture.error.reason : undefined
  const errorMessage =
    capture.error instanceof Error
      ? `${capture.error.message}${errorReason ? ` (mã: ${errorReason})` : ''}`
      : null

  return (
    <Dialog
      open
      title="Xem màn hình"
      description={hostName}
      size="lg"
      onClose={onClose}
      footer={
        <Button type="button" variant="secondary" loading={capture.isPending} onClick={() => mutate(hostName)}>
          Chụp lại
        </Button>
      }
    >
      <div className="ws-screen">
        {capture.isPending ? (
          <div className="ws-screen__placeholder" role="status">
            Đang chờ máy trạm gửi ảnh…
          </div>
        ) : null}
        {!capture.isPending && errorMessage ? <InlineAlert tone="warning">{errorMessage}</InlineAlert> : null}
        {!capture.isPending && shot ? (
          <>
            <img
              className="ws-screen__image"
              src={shot.url}
              width={shot.width}
              height={shot.height}
              alt={`Màn hình máy ${shot.hostName}`}
            />
            <p className="ws-screen__meta">
              Chụp lúc {shot.takenAt.toLocaleTimeString('vi-VN')} · {formatBytes(shot.bytes)} ·{' '}
              {(shot.elapsedMs / 1000).toFixed(1)} giây
              {shot.originalWidth > shot.width
                ? ` · Ảnh đã thu nhỏ từ ${shot.originalWidth}×${shot.originalHeight}`
                : null}
            </p>
          </>
        ) : null}
      </div>
    </Dialog>
  )
}
