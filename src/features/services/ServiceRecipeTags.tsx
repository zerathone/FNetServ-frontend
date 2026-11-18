import type { RecipeLine } from '../../api/inventory'
import type { ServiceItem } from '../../api/services'

// Tối đa bao nhiêu tag hiện thẳng trên dòng; phần còn lại gộp vào tag "+N" (rê chuột xem đủ).
const MAX_TAGS = 3

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
 * Công thức thu gọn của món: mỗi nguyên liệu một tag `<số lượng> x <tên nguyên liệu>`.
 *
 * Dữ liệu đến cùng danh sách (`GET /services?include=recipe`, server gộp 1 câu SQL) — component này KHÔNG gọi mạng.
 * `service.recipe` rỗng/`undefined` (món chưa có công thức, dòng hệ thống, server cũ chưa trả field) ⇒ không hiện gì.
 */
export function ServiceRecipeTags({ service }: { service: ServiceItem }) {
  const lines = service.recipe ?? []
  const shown = lines.slice(0, MAX_TAGS)
  const hidden = lines.slice(MAX_TAGS)

  return (
    <div className="service-recipe">
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
    </div>
  )
}
