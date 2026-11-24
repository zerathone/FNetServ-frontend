import type { ReactNode } from 'react'
import { Button, DateRangePicker } from '../../design-system/components'
import { addDaysYMD, toYMD, today } from './promotionModel'

/** Gợi ý nhanh cho khoảng ngày (mặc định của DateRangePicker toàn hướng về quá khứ, không hợp với khuyến mãi). */
function periodPresets(): Array<{ label: string; value: () => [string, string] }> {
  const range = (days: number) => (): [string, string] => [today(), addDaysYMD(today(), days)]
  return [
    { label: 'Hôm nay', value: range(0) },
    { label: '7 ngày tới', value: range(6) },
    { label: '30 ngày tới', value: range(29) },
    { label: '90 ngày tới', value: range(89) },
    {
      label: 'Hết tháng này',
      value: () => {
        const now = new Date()
        return [toYMD(now), toYMD(new Date(now.getFullYear(), now.getMonth() + 1, 0))]
      },
    },
  ]
}

/** Khối "Thời gian áp dụng" dùng chung cho cả 3 tab: MỘT ô khoảng ngày (như các trang khác) + dòng giải thích. */
export function PeriodCard({
  begin,
  end,
  onBegin,
  onEnd,
  disabled,
  hint,
}: {
  begin: string
  end: string
  onBegin: (value: string) => void
  onEnd: (value: string) => void
  disabled: boolean
  hint?: ReactNode
}) {
  return (
    <section className="promo-card" aria-labelledby="promo-period-title">
      <header>
        <h3 id="promo-period-title">Thời gian áp dụng</h3>
        <p>{hint ?? 'Khuyến mãi chỉ có hiệu lực trong khoảng ngày này.'} Ngày bắt đầu không được sớm hơn 30 ngày so với hôm nay.</p>
      </header>
      {/* Khóa khi không có quyền: bọc fieldset disabled để chặn mọi nút bên trong ô chọn. */}
      <fieldset className="promo-period" disabled={disabled}>
        <DateRangePicker
          label="Thời gian áp dụng"
          fromDate={begin}
          toDate={end}
          onFromDateChange={onBegin}
          onToDateChange={onEnd}
          presets={periodPresets()}
        />
      </fieldset>
    </section>
  )
}

/** Thanh lưu dính đáy: nói rõ có thay đổi chưa lưu hay lý do chưa lưu được; nút Lưu chỉ bật khi hợp lệ. */
export function SaveBar({
  dirty,
  pending,
  error,
  canSave,
  noRightHint,
  saveLabel,
  onSave,
  onReset,
}: {
  dirty: boolean
  pending: boolean
  error: string | null
  canSave: boolean
  noRightHint: string
  saveLabel: string
  onSave: () => void
  onReset: () => void
}) {
  const showError = dirty && error
  return (
    <div className="promo-savebar">
      <p className={`promo-savebar__status${showError ? ' is-error' : ''}`} role="status" aria-live="polite">
        {showError ? error : dirty ? 'Có thay đổi chưa lưu' : 'Chưa có thay đổi'}
      </p>
      <div className="promo-savebar__actions">
        <Button type="button" variant="secondary" disabled={!dirty || pending} onClick={onReset}>
          Hoàn tác
        </Button>
        <Button
          type="button"
          variant="primary"
          loading={pending}
          disabled={!canSave || !dirty || Boolean(error)}
          title={!canSave ? noRightHint : undefined}
          onClick={onSave}
        >
          {saveLabel}
        </Button>
      </div>
    </div>
  )
}
