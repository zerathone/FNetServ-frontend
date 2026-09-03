import { useCallback, useEffect, useRef, useState } from 'react'
import { Select, Button, Dialog, InlineAlert } from '../../design-system/components'

type CameraDevice = { deviceId: string; label: string }

type CustomerCameraDialogProps = {
  open: boolean
  fileName: string
  saving?: boolean
  onSave: (blob: Blob) => void
  onClose: () => void
}

function cameraErrorMessage(error: unknown) {
  if (!window.isSecureContext) {
    return 'Trình duyệt chỉ cho dùng webcam trên HTTPS hoặc localhost.'
  }
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') return 'Quyền camera đã bị từ chối. Hãy cho phép camera trong cài đặt trình duyệt.'
    if (error.name === 'NotFoundError') return 'Không tìm thấy webcam trên máy này.'
    if (error.name === 'NotReadableError') return 'Webcam đang được ứng dụng khác sử dụng hoặc không thể mở.'
    if (error.name === 'OverconstrainedError') return 'Webcam không hỗ trợ độ phân giải yêu cầu.'
  }
  return error instanceof Error ? error.message : 'Không thể mở webcam.'
}

export function CustomerCameraDialog({
  open,
  fileName,
  saving = false,
  onSave,
  onClose,
}: CustomerCameraDialogProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [devices, setDevices] = useState<CameraDevice[]>([])
  const [deviceId, setDeviceId] = useState('')
  const [snapshotUrl, setSnapshotUrl] = useState<string | null>(null)
  const [snapshotBlob, setSnapshotBlob] = useState<Blob | null>(null)
  const [viewingSnapshot, setViewingSnapshot] = useState(false)
  const [error, setError] = useState('')
  const [starting, setStarting] = useState(false)

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }, [])

  const clearSnapshot = useCallback(() => {
    setSnapshotUrl((current) => {
      if (current) URL.revokeObjectURL(current)
      return null
    })
    setSnapshotBlob(null)
    setViewingSnapshot(false)
  }, [])

  const startCamera = useCallback(async (preferredDeviceId?: string) => {
    stopCamera()
    setError('')
    setStarting(true)
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Trình duyệt không hỗ trợ truy cập webcam.')
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: preferredDeviceId
          ? { deviceId: { exact: preferredDeviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
          : { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: { ideal: 'user' } },
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      const available = await navigator.mediaDevices.enumerateDevices()
      const cameras = available
        .filter((item) => item.kind === 'videoinput')
        .map((item, index) => ({ deviceId: item.deviceId, label: item.label || `Camera ${index + 1}` }))
      setDevices(cameras)
      const activeId = stream.getVideoTracks()[0]?.getSettings().deviceId ?? preferredDeviceId ?? ''
      setDeviceId(activeId)
    } catch (nextError) {
      stopCamera()
      setError(cameraErrorMessage(nextError))
    } finally {
      setStarting(false)
    }
  }, [stopCamera])

  useEffect(() => {
    if (!open) return
    clearSnapshot()
    void startCamera()
    return () => {
      stopCamera()
      clearSnapshot()
    }
  }, [clearSnapshot, open, startCamera, stopCamera])

  useEffect(() => {
    if (!open || viewingSnapshot || !videoRef.current || !streamRef.current) return
    videoRef.current.srcObject = streamRef.current
    void videoRef.current.play().catch((nextError: unknown) => {
      setError(cameraErrorMessage(nextError))
    })
  }, [open, viewingSnapshot])

  const capture = () => {
    const video = videoRef.current
    if (!video || video.videoWidth <= 0 || video.videoHeight <= 0) {
      setError('Camera chưa sẵn sàng để chụp.')
      return
    }
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const context = canvas.getContext('2d')
    if (!context) {
      setError('Trình duyệt không hỗ trợ Canvas 2D.')
      return
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    canvas.toBlob((blob) => {
      if (!blob) {
        setError('Không thể tạo ảnh JPEG từ camera.')
        return
      }
      clearSnapshot()
      setSnapshotBlob(blob)
      setSnapshotUrl(URL.createObjectURL(blob))
      setViewingSnapshot(false)
    }, 'image/jpeg', 0.9)
  }

  const download = () => {
    if (!snapshotBlob) return
    const url = URL.createObjectURL(snapshotBlob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${fileName.replace(/[^a-zA-Z0-9_-]+/g, '_') || 'hoi-vien'}-${Date.now()}.jpg`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

  const close = () => {
    stopCamera()
    onClose()
  }

  return (
    <Dialog
      open={open}
      title="Chụp ảnh hội viên"
      description="Ảnh sẽ được máy chủ kiểm tra, thu nhỏ và chuyển sang JPEG trước khi lưu."
      size="lg"
      onClose={saving ? () => undefined : close}
      footer={
        <div className="customer-camera__footer">
          <div className="customer-camera__footer-preview">
            {snapshotUrl ? (
              <button
                type="button"
                className={`customer-camera__thumbnail${viewingSnapshot ? ' is-active' : ''}`}
                onClick={() => setViewingSnapshot(true)}
                aria-pressed={viewingSnapshot}
                title={viewingSnapshot ? 'Đang xem ảnh vừa chụp' : 'Xem ảnh vừa chụp'}
              >
                <img src={snapshotUrl} alt="Ảnh vừa chụp dạng thu nhỏ" />
                <span>Ảnh vừa chụp</span>
              </button>
            ) : (
              <span className="customer-camera__no-thumbnail">Chưa chụp ảnh</span>
            )}
          </div>
          <div className="customer-camera__footer-actions">
            {snapshotUrl ? (
              <>
                <Button type="button" variant="secondary" onClick={clearSnapshot}>Chụp lại</Button>
                <Button type="button" variant="secondary" disabled={saving} onClick={download}>Tải ảnh JPEG</Button>
                <Button type="button" variant="primary" loading={saving} onClick={() => snapshotBlob && onSave(snapshotBlob)}>Lưu vào hồ sơ</Button>
              </>
            ) : (
              <Button type="button" variant="primary" loading={starting} disabled={Boolean(error)} onClick={capture}>Chụp ảnh</Button>
            )}
            <Button type="button" variant="secondary" disabled={saving} onClick={close}>Đóng</Button>
          </div>
        </div>
      }
    >
      <div className="customer-camera">
        {error ? (
          <InlineAlert tone="warning">
            <strong>Không mở được camera.</strong> {error}
            <div className="customer-camera__retry">
              <Button type="button" variant="secondary" onClick={() => void startCamera(deviceId || undefined)}>Thử lại</Button>
            </div>
          </InlineAlert>
        ) : null}
        <div className="customer-camera__stage">
          {snapshotUrl && viewingSnapshot ? (
            <img src={snapshotUrl} alt="Ảnh hội viên vừa chụp" />
          ) : (
            <video ref={videoRef} autoPlay playsInline muted />
          )}
          {!viewingSnapshot && starting ? <div className="customer-camera__loading">Đang mở webcam…</div> : null}
        </div>
        <div className="customer-camera__controls">
          <label className="ds-field">
            <span className="ds-field__label">Camera</span>
            <Select
              className="ds-select"
              value={deviceId}
              disabled={devices.length < 2 || viewingSnapshot}
              onChange={(event) => {
                setDeviceId(event.target.value)
                void startCamera(event.target.value)
              }}
            >
              {devices.length === 0 ? <option value="">Camera mặc định</option> : null}
              {devices.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label}</option>)}
            </Select>
          </label>
          <span>{viewingSnapshot ? 'Bấm Chụp lại để xóa ảnh này và bật live view.' : snapshotUrl ? 'Ảnh đã chụp nằm ở góc trái phía dưới.' : 'Đặt khuôn mặt trong khung rồi bấm Chụp ảnh.'}</span>
        </div>
      </div>
    </Dialog>
  )
}
