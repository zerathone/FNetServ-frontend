import { CookingPot, Plus } from '@phosphor-icons/react'
import type { RecipeLine } from '../../api/inventory'
import type { ServiceItem } from '../../api/services'
import { toppingTagState } from './serviceStockEstimate'

// Tối đa bao nhiêu tag hiện thẳng trên dòng; phần còn lại gộp vào tag "+N" (rê chuột xem đủ).
const MAX_TAGS = 3
// Tối đa bao nhiêu tag bán kèm hiện thẳng trên dòng; phần còn lại gộp vào "+N".
const MAX_TOPPING_TAGS = 4

function formatQty(raw: string) {
  const value = Number(raw)
  return Number.isFinite(value) ? new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(value) : raw
}

function describeLine(line: RecipeLine) {
  const parts = [`${line.materialName}: ${formatQty(line.qty)}${line.unit ? ` ${line.unit}` : ''}`]
  if (Number(line.wastePercent) > 0) parts.push(`hao hụt ${formatQty(line.wastePercent)}%`)
  if (line.materialActive === 0) parts.push('nguyên liệu đã ngừng dùng')
  return parts.join(' · ')
}

/**
 * Công thức thu gọn của món: icon nồi + mỗi nguyên liệu một tag `<số lượng> x <tên nguyên liệu>`, dồn phải.
 *
 * Dữ liệu đến cùng danh sách (`GET /services?include=recipe`, server gộp 1 câu SQL) — component này KHÔNG gọi mạng.
 * `service.recipe` rỗng/`undefined` (món chưa có công thức, dòng hệ thống, server cũ chưa trả field) ⇒ không hiện gì.
 */
export function ServiceRecipeTags({ service }: { service: ServiceItem }) {
  const lines = service.recipe ?? []
  if (lines.length === 0) return null
  const shown = lines.slice(0, MAX_TAGS)
  const hidden = lines.slice(MAX_TAGS)

  return (
    <div className="service-recipe" role="group" aria-label="Công thức">
      {shown.map((line) => (
        <span
          className={`service-recipe__tag${line.materialActive === 0 ? ' is-inactive' : ''}`}
          key={line.materialId}
          title={describeLine(line)}
        >
          {formatQty(line.qty)} x {line.materialName}
        </span>
      ))}
      {hidden.length > 0 ? (
        <span className="service-recipe__tag service-recipe__tag--more" title={hidden.map(describeLine).join('\n')}>
          +{hidden.length}
        </span>
      ) : null}
      {/* Icon ở cuối dòng (mép phải), sau các tag — user chốt 2026-11-25. */}
      <CookingPot className="service-recipe__icon" size={14} weight="bold" aria-hidden="true" />
    </div>
  )
}

/**
 * Món bán kèm của món (user chốt 2026-11-25): mỗi món một tag `<tên>` + icon dấu cộng (`Plus`) cuối dòng, dồn phải; hết hàng theo kho
 * (nguyên liệu gắn kèm hoặc tồn thành phẩm) ⇒ tag cảnh báo, món bán kèm đã ngừng bán ⇒ gạch ngang. Rê chuột xem tồn / giá.
 * KHÔNG gọi mạng: dữ liệu đến cùng danh sách (`?include=topping`). `toppings` rỗng/`undefined` ⇒ không hiện gì.
 */
export function ServiceToppingTags({ service }: { service: ServiceItem }) {
  const toppings = service.toppings ?? []
  if (toppings.length === 0) return null
  const shown = toppings.slice(0, MAX_TOPPING_TAGS)
  const hidden = toppings.slice(MAX_TOPPING_TAGS)
  return (
    <div className="service-topping" role="group" aria-label="Món bán kèm">
      {shown.map((topping) => {
        const state = toppingTagState(topping)
        const classes = ['service-recipe__tag', 'service-topping__tag']
        if (state.inactive) classes.push('is-inactive')
        else if (state.out) classes.push('is-out')
        return (
          <span className={classes.join(' ')} key={topping.serviceId} title={state.detail}>
            {topping.name}
          </span>
        )
      })}
      {hidden.length > 0 ? (
        <span
          className="service-recipe__tag service-recipe__tag--more"
          title={hidden.map((topping) => toppingTagState(topping).detail).join('\n')}
        >
          +{hidden.length}
        </span>
      ) : null}
      <Plus className="service-topping__icon" size={14} weight="bold" aria-hidden="true" />
    </div>
  )
}
