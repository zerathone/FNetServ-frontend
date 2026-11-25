import type { RecipeLine } from '../../api/inventory.ts'
import type { ServiceItem, ServiceTopping } from '../../api/services.ts'

// Ước lượng "còn bao nhiêu phần" của món từ TỒN NGUYÊN LIỆU (user chốt 2026-11-25) — chỉ để HIỂN THỊ ở danh mục, KHÔNG phải
// sổ sách kho thành phẩm. Công thức bám đúng cách server kiểm kho lúc đặt đơn (`/service/staff-order`, ServiceHandlers.cpp):
//   món công thức : mỗi dòng cần `định lượng × số lượng`, KHÔNG nhân hao hụt (Q5) ⇒ số phần = min floor(tồn / định lượng);
//   topping gắn nguyên liệu: cần `toppingQty × số lượng`, toppingQty rỗng/≤ 0 tính là 1;
//   thiếu bất kỳ nguyên liệu nào ⇒ cả đơn bị từ chối, nên lấy MIN trên các dòng.
// Thuần logic (không React) để test bằng node.

/** Chuỗi decimal chuẩn của server ("12.500") → milli (phần nghìn) nguyên; không đọc được ⇒ null. */
function toMilli(raw: string | undefined): number | null {
  if (raw === undefined) return null
  const value = Number(raw)
  return Number.isFinite(value) ? Math.round(value * 1000) : null
}

/** Số lượng gọn để hiển thị: tối đa 3 số lẻ, dấu phân cách vi-VN. */
export function formatAmount(value: number): string {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(value)
}

export type RecipeCapacity = { portions: number; limiter: RecipeLine }

/**
 * Số phần làm được theo công thức = min floor(tồn nguyên liệu / định lượng 1 phần). `null` = không tính được: công thức
 * rỗng/chưa biết, hoặc server cũ chưa trả `stockQty` cho dòng nào đó (thà không hiện còn hơn hiện sai).
 * Dòng định lượng ≤ 0 bị bỏ qua (không chặn được gì).
 */
export function recipeCapacity(lines: readonly RecipeLine[] | undefined): RecipeCapacity | null {
  if (!lines || lines.length === 0) return null
  let best: RecipeCapacity | null = null
  for (const line of lines) {
    const stock = toMilli(line.stockQty)
    const need = toMilli(line.qty)
    if (stock === null) return null
    if (need === null || need <= 0) continue
    const portions = Math.max(0, Math.floor(stock / need))
    if (best === null || portions < best.portions) best = { portions, limiter: line }
  }
  return best
}

export type ToppingCapacity = {
  /** `null` = không giới hạn theo kho (topping thường, không quản lý tồn) hoặc không tính được. */
  portions: number | null
  basis: 'material' | 'inventory' | 'none'
}

/** Số phần bán kèm còn lại của MỘT món bán kèm theo cặp (cha, topping). */
export function toppingCapacity(topping: ServiceTopping): ToppingCapacity {
  if (topping.zMaterialId > 0) {
    const stock = toMilli(topping.materialStock)
    if (stock === null) return { portions: null, basis: 'none' }
    const perUnit = toMilli(topping.toppingQty)
    // Parity server: toppingQty rỗng / ≤ 0 ⇒ trừ 1 nguyên liệu cho mỗi topping.
    const unit = perUnit !== null && perUnit > 0 ? perUnit : 1000
    return { portions: Math.max(0, Math.floor(stock / unit)), basis: 'material' }
  }
  if (topping.inventoryManagement === 1) return { portions: Math.max(0, topping.inventory), basis: 'inventory' }
  return { portions: null, basis: 'none' }
}

export type ToppingTagState = {
  /** Món bán kèm đã ngừng bán (Active = 0). */
  inactive: boolean
  /** Còn 0 phần theo kho ⇒ cảnh báo. */
  out: boolean
  portions: number | null
  detail: string
}

export function toppingTagState(topping: ServiceTopping): ToppingTagState {
  const cap = toppingCapacity(topping)
  const inactive = topping.active === 0
  const out = cap.portions !== null && cap.portions <= 0
  const parts = [topping.name]
  if (cap.basis === 'material') {
    parts.push(
      `nguyên liệu ${topping.materialName}: còn ${formatAmount((toMilli(topping.materialStock) ?? 0) / 1000)}${
        topping.materialUnit ? ` ${topping.materialUnit}` : ''
      }`,
    )
  }
  if (cap.portions !== null) parts.push(`~${formatAmount(cap.portions)} phần`)
  if (topping.price > 0) parts.push(`${new Intl.NumberFormat('vi-VN').format(topping.price)} đ`)
  if (inactive) parts.push('đã ngừng bán')
  else if (out) parts.push('hết hàng')
  return { inactive, out, portions: cap.portions, detail: parts.join(' · ') }
}

export type ServiceStockView =
  /** Món quản lý tồn thành phẩm: `amount` đã là số hiệu dụng (nhỏ hơn giữa tồn thành phẩm và số theo nguyên liệu). */
  | { kind: 'managed'; amount: number; detail: string | null }
  /** Không quản lý tồn nhưng ước lượng được từ nguyên liệu. */
  | { kind: 'estimate'; amount: number; unit: string; detail: string }
  | { kind: 'none' }

/**
 * Chọn cách hiện cột "Tồn kho" cho một món (quy tắc user chốt 2026-11-25):
 * - quản lý tồn + có công thức ⇒ số NHỎ HƠN giữa tồn thành phẩm và số phần làm được theo nguyên liệu (theo Q8 iCafe trừ cả hai);
 * - không quản lý tồn + có công thức ⇒ ước lượng số phần;
 * - không quản lý tồn + món "là nguyên liệu" ⇒ tồn nguyên liệu gốc kèm đơn vị của nguyên liệu (không đổi sang "phần" vì
 *   lượng trừ phụ thuộc từng món cha);
 * - còn lại ⇒ không có gì để ước lượng.
 */
export function serviceStockView(service: ServiceItem): ServiceStockView {
  const recipe = recipeCapacity(service.recipe)
  const managed = service.inventoryManagement === 1

  if (managed) {
    if (!recipe) return { kind: 'managed', amount: service.inventory, detail: null }
    const capped = recipe.portions < service.inventory
    return {
      kind: 'managed',
      amount: Math.min(service.inventory, recipe.portions),
      detail: `Thành phẩm: ${formatAmount(service.inventory)}; theo nguyên liệu: ~${formatAmount(recipe.portions)} phần (hết trước: ${recipe.limiter.materialName}). ${
        capped ? 'Đang lấy số theo nguyên liệu.' : 'Đang lấy số thành phẩm.'
      }`,
    }
  }

  if (recipe) {
    const stock = toMilli(recipe.limiter.stockQty) ?? 0
    return {
      kind: 'estimate',
      amount: recipe.portions,
      unit: 'phần',
      detail: `Ước lượng theo nguyên liệu. Hết trước: ${recipe.limiter.materialName} (còn ${formatAmount(stock / 1000)}${
        recipe.limiter.unit ? ` ${recipe.limiter.unit}` : ''
      }).`,
    }
  }

  if (service.material) {
    const stock = toMilli(service.material.stockQty)
    if (stock !== null) {
      return {
        kind: 'estimate',
        amount: stock / 1000,
        unit: service.material.unit,
        detail: `Tồn nguyên liệu "${service.material.name}" mà món này đại diện.`,
      }
    }
  }

  return { kind: 'none' }
}

/**
 * Món có cấu hình công thức nguyên liệu (bộ lọc "Có công thức"): nhiều nguyên liệu (`recipe` có dòng) HOẶC gắn một
 * nguyên liệu (`material`, kiểu "món này là nguyên liệu"). Server cũ không trả field ⇒ false.
 */
export function hasRecipeConfig(service: ServiceItem): boolean {
  return (service.recipe?.length ?? 0) > 0 || service.material !== undefined
}

/** Món có món bán kèm (bộ lọc "Có bán kèm"). Server cũ không trả `toppings` ⇒ false. */
export function hasToppingConfig(service: ServiceItem): boolean {
  return (service.toppings?.length ?? 0) > 0
}