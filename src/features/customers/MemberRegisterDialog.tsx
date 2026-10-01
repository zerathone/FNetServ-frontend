import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import QRCode from 'qrcode'
import {
  cancelMemberRegister,
  getMemberRegisterStatus,
  startMemberRegister,
} from '../../api/users'
import { Button, Dialog, InlineAlert } from '../../design-system/components'
import { pushToast } from '../../store/toast'
import './customers.css'

type Props = {
  open: boolean
  onClose: () => void
  /** Mobile đã đăng ký xong: server đã tạo tài khoản hội viên với id này. */
  onRegistered: (result: { userId: number; username: string }) => void
}

function QrImage({ value }: { value: string }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let active = true
    void QRCode.toDataURL(value, { width: 280, margin: 2, errorCorrectionLevel: 'M' })
      .then((url) => { if (active) setSrc(url) })
    return () => { active = false }
  }, [value])
  return src ? <img className="customer-verification-qr" src={src} alt="Mã QR đăng ký hội viên trên mobile" /> : null
}

export function MemberRegisterDialog({ open, onClose, onRegistered }: Props) {
  const [session, setSession] = useState<{ regId: string; qr: string } | null>(null)
  const startedRef = useRef(false)
  const deliveredRef = useRef(false)

  const start = useMutation({
    retry: false,
    mutationFn: startMemberRegister,
    onSuccess: (result) => setSession({ regId: result.regId, qr: result.qr }),
  })

  // Mỗi lần mở dialog sinh đúng một phiên QR (StrictMode chạy effect hai lần nên cần ref chặn).
  useEffect(() => {
    if (!open) {
      startedRef.current = false
      deliveredRef.current = false
      setSession(null)
      return
    }
    if (startedRef.current) return
    startedRef.current = true
    start.mutate()
  }, [open, start])

  const status = useQuery({
    queryKey: ['member-register', session?.regId],
    queryFn: () => getMemberRegisterStatus(session!.regId),
    enabled: Boolean(session),
    retry: false,
    refetchInterval: (query) => query.state.data?.state === 'pending' ? 1_000 : false,
  })

  const result = status.data
  useEffect(() => {
    if (!open || result?.state !== 'done' || deliveredRef.current) return
    deliveredRef.current = true
    pushToast(`Đã đăng ký hội viên ${result.username} từ mobile.`, 'success')
    onRegistered({ userId: result.userId, username: result.username })
    onClose()
  }, [open, result, onClose, onRegistered])

  const close = () => {
    if (session && result?.state === 'pending') void cancelMemberRegister(session.regId)
    onClose()
  }

  const retry = () => {
    if (session && result?.state === 'pending') void cancelMemberRegister(session.regId)
    deliveredRef.current = false
    setSession(null)
    start.mutate()
  }

  const finished = result?.state === 'failed' || result?.state === 'expired' || result?.state === 'cancelled'

  return (
    <Dialog
      open={open}
      title="Đăng ký hội viên trên mobile"
      description="Mã có hiệu lực 5 phút và chỉ phiên đăng nhập hiện tại đọc được kết quả."
      size="sm"
      onClose={close}
      footer={
        <>
          <Button variant="secondary" onClick={close}>{session && !finished ? 'Hủy phiên' : 'Đóng'}</Button>
          {finished ? <Button variant="primary" loading={start.isPending} onClick={retry}>Tạo mã mới</Button> : null}
        </>
      }
    >
      {start.isError ? <InlineAlert tone="danger">{start.error.message}</InlineAlert> : null}
      {status.isError ? <InlineAlert tone="warning">Mất kết nối khi đọc trạng thái; hệ thống sẽ tiếp tục dùng cùng phiên.</InlineAlert> : null}
      {session ? (
        <div className="customer-verification-flow">
          <QrImage value={session.qr} />
          <strong>
            {result?.state === 'failed'
              ? `Không thành công: ${result.reason ?? 'không rõ nguyên nhân'}`
              : result?.state === 'expired'
                ? 'Mã QR đã hết hạn'
                : 'Đang chờ ứng dụng mobile quét mã và đăng ký…'}
          </strong>
        </div>
      ) : start.isPending ? (
        <InlineAlert tone="info">Đang tạo mã QR…</InlineAlert>
      ) : null}
    </Dialog>
  )
}
