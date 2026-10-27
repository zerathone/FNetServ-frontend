import { Check, X } from '@phosphor-icons/react'

// error = bước kết thúc không thành (huỷ / từ chối / khách không đến), tô đỏ, các bước sau đó để mờ.
export type StepStatus = 'done' | 'current' | 'todo' | 'error'

export type StepItem = {
  label: string
  status: StepStatus
  /** Mốc thời gian (ms) của bước; bỏ trống/0 = không có dữ liệu thì không hiện. */
  time?: number
  /** Người thực hiện bước (vd người đặt, người duyệt) — hiện dưới nhãn; bỏ trống = không hiện. */
  person?: string
}

// Tiến trình đơn theo kiểu Ant Design Steps (tự dựng -- dự án không thêm UI framework).
// Dùng chung cho đơn dịch vụ (OrderSteps bên dưới) và đơn đặt máy online. Chỉ để nhìn đơn đang ở đâu --
// không phải nơi bấm.
const pad = (value: number) => String(value).padStart(2, '0')

// Hôm nay chỉ cần giờ:phút; đơn từ ngày trước thêm ngày/tháng để khỏi hiểu nhầm.
function formatStepTime(ms: number, now = new Date()) {
  const date = new Date(ms)
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  return date.toDateString() === now.toDateString() ? time : `${pad(date.getDate())}/${pad(date.getMonth() + 1)} ${time}`
}

export function Steps({ steps, label = 'Tiến trình đơn' }: { steps: ReadonlyArray<StepItem>; label?: string }) {
  return (
    <ol className="order-card__steps order-steps" aria-label={label}>
      {steps.map((step) => (
        <li
          key={step.label}
          className={`order-steps__item order-steps__item--${step.status}`}
          aria-current={step.status === 'current' ? 'step' : undefined}
        >
          <span className="order-steps__icon" aria-hidden="true">
            {step.status === 'done' ? (
              <Check size={12} weight="bold" />
            ) : step.status === 'error' ? (
              <X size={12} weight="bold" />
            ) : (
              <i className="order-steps__dot" />
            )}
          </span>
          <span className="order-steps__label">{step.label}</span>
          {step.person ? (
            <span className="order-steps__person" title={step.person}>
              {step.person}
            </span>
          ) : null}
          {step.time ? <span className="order-steps__time">{formatStepTime(step.time)}</span> : null}
        </li>
      ))}
    </ol>
  )
}

// Đơn dịch vụ: mỗi loại thẻ có đường đi riêng. Đơn QR khách trả tiền TRƯỚC rồi mới chờ thu ngân duyệt, còn
// các đơn khác duyệt trước rồi mới thu tiền.
const FLOWS = {
  // Chờ duyệt (Accept=0): thu ngân chưa bấm gì.
  pending: [
    ['Đặt món', 'done'],
    ['Duyệt', 'current'],
    ['Thu tiền', 'todo'],
  ],
  // Đã duyệt (Accept=1) nhưng chưa thu tiền.
  accepted: [
    ['Đặt món', 'done'],
    ['Duyệt', 'done'],
    ['Thu tiền', 'current'],
  ],
  // Khách đã trả QR, chờ thu ngân xác nhận phục vụ.
  qr: [
    ['Đặt món', 'done'],
    ['Thu QR', 'done'],
    ['Phục vụ', 'current'],
  ],
  completed: [
    ['Đặt món', 'done'],
    ['Duyệt', 'done'],
    ['Thu tiền', 'done'],
  ],
} as const satisfies Record<string, ReadonlyArray<readonly [string, StepStatus]>>

export type OrderStepsKind = keyof typeof FLOWS

/**
 * `times[i]` = mốc thời gian (ms) của bước i, bỏ trống/0 = không có dữ liệu thì không hiện. Hiện có 2 mốc:
 * lúc đặt món (`serviceDate/Time`) và lúc thu tiền (`paidDate/Time`, chỉ đơn hoàn thành). DB KHÔNG lưu giờ
 * duyệt (Accept chỉ ghi Accept=1 + StaffId + VoucherId) và API không trả giờ khách trả QR.
 */
export function OrderSteps({ kind, times = [] }: { kind: OrderStepsKind; times?: ReadonlyArray<number | undefined> }) {
  return (
    <Steps
      steps={FLOWS[kind].map(([label, status], index) => ({ label, status, time: times[index] }))}
    />
  )
}
