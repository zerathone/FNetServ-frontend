import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import QRCode from 'qrcode'
import {
  cancelCccdScan,
  cancelMobilePair,
  getCccdScanStatus,
  getMobilePairStatus,
  startCccdScan,
  startMobilePair,
  unpairMobile,
  type CccdDraft,
} from '../../api/users'
import { Button, Dialog, InlineAlert } from '../../design-system/components'
import { pushToast } from '../../store/toast'
import {
  customerQrDisplayChannelName,
  type CustomerQrDisplayState,
} from '../payments/CustomerQrDisplay'

type Flow = 'cccd' | 'mobile-pair' | 'mobile-unpair' | null

type Props = {
  flow: Flow
  userId: number
  username: string
  fullName: string
  mobilePairDisplay: { channelId: string; external: boolean } | null
  onClose: () => void
  onCccdDraft: (draft: CccdDraft) => void
  onMobileChanged: () => void
}

function QrImage({ value, alt }: { value: string; alt: string }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let active = true
    void QRCode.toDataURL(value, { width: 280, margin: 2, errorCorrectionLevel: 'M' })
      .then((url) => { if (active) setSrc(url) })
    return () => { active = false }
  }, [value])
  return src ? <img className="customer-verification-qr" src={src} alt={alt} /> : null
}

export function CustomerVerificationDialogs({
  flow,
  userId,
  username,
  fullName,
  mobilePairDisplay,
  onClose,
  onCccdDraft,
  onMobileChanged,
}: Props) {
  const [cccdSession, setCccdSession] = useState<{ sid: string; qr: string } | null>(null)
  const [pairSession, setPairSession] = useState<{
    pairId: string
    qr: string
    download: string
    expiresAtMs: number
  } | null>(null)
  const pairStartKeyRef = useRef<string | null>(null)

  useEffect(() => {
    setCccdSession(null)
    setPairSession(null)
  }, [flow, userId])

  const startCccd = useMutation({
    mutationFn: () => startCccdScan(username, fullName),
    onSuccess: (result) => setCccdSession({ sid: result.sid, qr: result.qr }),
  })
  const cccdStatus = useQuery({
    queryKey: ['cccd-scan', cccdSession?.sid],
    queryFn: () => getCccdScanStatus(cccdSession!.sid),
    enabled: Boolean(cccdSession),
    retry: false,
    refetchInterval: (query) => query.state.data?.state === 'pending' ? 1_000 : false,
  })

  useEffect(() => {
    const result = cccdStatus.data
    if (flow !== 'cccd' || result?.state !== 'done') return
    onCccdDraft(result.draft)
    pushToast('Đã đưa dữ liệu CCCD vào bản nháp. Hãy kiểm tra rồi bấm Lưu hồ sơ.', 'success')
    onClose()
  }, [cccdStatus.data, flow, onCccdDraft, onClose])

  const startPair = useMutation({
    mutationFn: () => startMobilePair(userId),
    onSuccess: (result) => setPairSession({
      pairId: result.pairId,
      qr: result.qr,
      download: result.qrDownload,
      expiresAtMs: Date.now() + Math.max(0, result.expiresIn) * 1_000,
    }),
  })

  useEffect(() => {
    if (flow !== 'mobile-pair') {
      pairStartKeyRef.current = null
      return
    }
    const key = `${userId}:${flow}`
    if (pairStartKeyRef.current === key) return
    pairStartKeyRef.current = key
    startPair.mutate()
  }, [flow, startPair.mutate, userId])
  const pairStatus = useQuery({
    queryKey: ['mobile-pair', pairSession?.pairId],
    queryFn: () => getMobilePairStatus(pairSession!.pairId),
    enabled: Boolean(pairSession),
    retry: false,
    refetchInterval: (query) => query.state.data?.state === 'pending' ? 1_000 : false,
  })

  useEffect(() => {
    if (flow !== 'mobile-pair' || pairStatus.data?.state !== 'done') return
    pushToast('Đã kết nối tài khoản mobile.', 'success')
    onMobileChanged()
    onClose()
  }, [flow, onClose, onMobileChanged, pairStatus.data])

  useEffect(() => {
    if (!mobilePairDisplay || !pairSession) return
    let active = true
    const channel = new BroadcastChannel(customerQrDisplayChannelName(mobilePairDisplay.channelId))
    const state: CustomerQrDisplayState['state'] = pairStatus.data?.state ?? 'pending'
    const publish = (qrImageDataUrl: string) => {
      if (!active) return
      channel.postMessage({
        type: 'display',
        payload: {
          kind: 'mobile-pair',
          qrImageDataUrl,
          expiresAtMs: pairSession.expiresAtMs,
          state,
        } satisfies CustomerQrDisplayState,
      })
    }
    channel.onmessage = (event: MessageEvent<{ type?: string }>) => {
      if (event.data.type !== 'ready') return
      void QRCode.toDataURL(pairSession.qr, { width: 360, margin: 2, errorCorrectionLevel: 'M' }).then(publish)
    }
    void QRCode.toDataURL(pairSession.qr, { width: 360, margin: 2, errorCorrectionLevel: 'M' }).then(publish)
    return () => {
      active = false
      channel.close()
    }
  }, [mobilePairDisplay, pairSession, pairStatus.data?.state])

  const unpair = useMutation({
    mutationFn: () => unpairMobile(userId),
    onSuccess: () => {
      pushToast('Đã ngắt kết nối tài khoản mobile.', 'success')
      onMobileChanged()
      onClose()
    },
  })

  const close = () => {
    if (cccdSession && cccdStatus.data?.state === 'pending') void cancelCccdScan(cccdSession.sid)
    if (pairSession && pairStatus.data?.state === 'pending') void cancelMobilePair(pairSession.pairId)
    onClose()
  }

  if (flow === 'mobile-unpair') {
    return (
      <Dialog
        open
        title="Ngắt kết nối mobile?"
        description={`Tài khoản ${username} sẽ cần quét QR lại để kết nối thiết bị.`}
        size="sm"
        onClose={onClose}
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>Hủy</Button>
            <Button variant="danger" loading={unpair.isPending} onClick={() => unpair.mutate()}>Ngắt kết nối</Button>
          </>
        }
      >
        {unpair.isError ? <InlineAlert tone="danger">{unpair.error.message}</InlineAlert> : null}
      </Dialog>
    )
  }

  const isCccd = flow === 'cccd'
  const session = isCccd ? cccdSession : pairSession
  const status = isCccd ? cccdStatus : pairStatus
  const start = isCccd ? startCccd : startPair

  return (
    <Dialog
      open={flow === 'cccd' || flow === 'mobile-pair'}
      title={isCccd ? 'Quét CCCD vào hồ sơ' : 'Kết nối tài khoản mobile'}
      description="Mã có hiệu lực 5 phút và chỉ phiên đăng nhập hiện tại được đọc kết quả."
      size="sm"
      onClose={close}
      footer={
        <>
          <Button variant="secondary" onClick={close}>{session ? 'Hủy phiên' : 'Đóng'}</Button>
          {!session && isCccd ? <Button loading={start.isPending} onClick={() => start.mutate()}>Tạo mã QR</Button> : null}
        </>
      }
    >
      {start.isError ? <InlineAlert tone="danger">{start.error.message}</InlineAlert> : null}
      {status.isError ? <InlineAlert tone="warning">Mất kết nối khi đọc trạng thái; hệ thống sẽ tiếp tục dùng cùng phiên.</InlineAlert> : null}
      {session && (isCccd || !mobilePairDisplay?.external) ? (
        <div className="customer-verification-flow">
          <QrImage value={session.qr} alt={isCccd ? 'Mã QR quét CCCD' : 'Mã QR kết nối mobile'} />
          <strong>
            {status.data?.state === 'failed'
              ? `Không thành công: ${status.data.reason ?? 'không rõ nguyên nhân'}`
              : status.data?.state === 'expired'
                ? 'Mã QR đã hết hạn'
                : 'Đang chờ ứng dụng mobile quét mã…'}
          </strong>
          {!isCccd && 'download' in session ? <a href={session.download} target="_blank" rel="noreferrer">Tải ứng dụng mobile</a> : null}
        </div>
      ) : session ? (
        <div className="customer-verification-flow">
          <InlineAlert tone="info">Mã QR đang hiển thị trên màn hình dành cho khách.</InlineAlert>
          <strong>Đang chờ ứng dụng mobile quét mã…</strong>
        </div>
      ) : (
        <InlineAlert tone="info">
          {isCccd
            ? 'Kết quả chỉ điền vào bản nháp; chưa ghi dữ liệu cho tới khi bạn kiểm tra và bấm Lưu hồ sơ.'
            : 'Máy chủ tự giữ secret ghép nối; trình duyệt chỉ nhận mã QR và trạng thái.'}
        </InlineAlert>
      )}
    </Dialog>
  )
}
