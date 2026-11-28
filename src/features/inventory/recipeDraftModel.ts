import type { RecipeConfig, RecipeSaveBody, ToppingSaveBody } from '../../api/inventory'
import {
  recipeLinesBody,
  toppingLinesBody,
  validateRecipeDraft,
  validateToppingDraft,
  type RecipeDraftLine,
  type ToppingDraftLine,
} from './inventoryModel.ts'

// Bản nháp công thức + món bán kèm của MỘT dịch vụ — dùng cho form Thêm/Sửa dịch vụ.
// Thuần logic (không React) để test được bằng node.

export type RecipeMode = 'none' | 'recipe' | 'material'

export type RecipeDraft = {
  mode: RecipeMode
  lines: RecipeDraftLine[]
  /** Chỉ dùng khi mode = 'material': nguyên liệu mà món này đại diện (topping nhóm 2). */
  materialId: number
}

export type ToppingDraft = {
  /** Tắt = món không có món bán kèm (lưu sẽ gỡ hết, nhưng danh sách đã nhập vẫn giữ để bật lại). */
  enabled: boolean
  /** 0 = chọn nhiều, 1 = chọn một. */
  single: 0 | 1
  lines: ToppingDraftLine[]
}

let seq = 0
export const nextDraftKey = () => `d${++seq}`

/** "1.500" → "1.5", "0.000" → "" để đưa vào ô nhập. */
export function trimDecimal(value: string): string {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(value)
  if (!m) return value
  const frac = (m[2] ?? '').replace(/0+$/, '')
  const out = frac ? `${m[1]}.${frac}` : m[1]
  return out === '0' ? '' : out
}

export function emptyRecipeDraft(): RecipeDraft {
  return { mode: 'none', lines: [], materialId: 0 }
}

export function emptyToppingDraft(): ToppingDraft {
  return { enabled: false, single: 0, lines: [] }
}

export function recipeDraftFromConfig(config: Pick<RecipeConfig, 'recipe' | 'zMaterialId'>): RecipeDraft {
  const materialId = config.zMaterialId ?? 0
  return {
    mode: materialId > 0 ? 'material' : config.recipe.length > 0 ? 'recipe' : 'none',
    materialId,
    lines: config.recipe.map((r) => ({
      key: nextDraftKey(),
      materialId: r.materialId,
      qty: trimDecimal(r.qty),
      waste: trimDecimal(r.wastePercent),
    })),
  }
}

export function toppingDraftFromConfig(config: Pick<RecipeConfig, 'toppings' | 'isSelect'>): ToppingDraft {
  return {
    enabled: config.toppings.length > 0,
    single: config.isSelect === 1 ? 1 : 0,
    lines: config.toppings.map((t) => ({
      key: nextDraftKey(),
      serviceId: t.serviceId,
      qty: trimDecimal(t.toppingQty),
      price: trimDecimal(t.topPrice),
    })),
  }
}

const emptyRecipeLine = () => ({ key: nextDraftKey(), materialId: 0, qty: '', waste: '' })

/**
 * Công tắc "Có công thức nguyên liệu". Bật: nhóm thường ⇒ 'recipe' (nhiều nguyên liệu, có sẵn 1 dòng trống), nhóm kèm
 * thêm ⇒ 'material' (đúng 1 nguyên liệu). Tắt ⇒ 'none'. Danh sách dòng / nguyên liệu đã nhập được GIỮ để bật lại không mất.
 */
export function setRecipeEnabled(draft: RecipeDraft, enabled: boolean, toppingGroup: boolean): RecipeDraft {
  if (!enabled) return { ...draft, mode: 'none' }
  if (toppingGroup) return { ...draft, mode: 'material' }
  return { ...draft, mode: 'recipe', lines: draft.lines.length > 0 ? draft.lines : [emptyRecipeLine()] }
}

/**
 * Đổi loại nhóm của món khi công thức đang bật: nhóm kèm thêm chỉ được 1 nguyên liệu ('material'), nhóm thường nhiều
 * nguyên liệu ('recipe'). Đang tắt ('none') thì giữ nguyên. Dữ liệu của kiểu bên kia được giữ, đổi lại nhóm còn nguyên.
 */
export function recipeDraftForGroup(draft: RecipeDraft, toppingGroup: boolean): RecipeDraft {
  if (draft.mode === 'none') return draft
  return setRecipeEnabled(draft, true, toppingGroup)
}

/** null = hợp lệ. Chế độ 'none' luôn hợp lệ (nghĩa là gỡ công thức). */
export function validateRecipe(draft: RecipeDraft): string | null {
  if (draft.mode === 'recipe') {
    if (draft.lines.length === 0) return 'Thêm ít nhất một nguyên liệu, hoặc chọn “Không có công thức”.'
    return validateRecipeDraft(draft.lines)
  }
  if (draft.mode === 'material' && draft.materialId === 0) return 'Chọn nguyên liệu mà món này đại diện.'
  return null
}

/** `serviceId` = 0 khi chỉ để so sánh bản nháp. */
export function recipeSaveBody(serviceId: number, draft: RecipeDraft): RecipeSaveBody {
  if (draft.mode === 'material') return { serviceId, materialId: draft.materialId }
  return { serviceId, lines: draft.mode === 'recipe' ? recipeLinesBody(draft.lines) : [] }
}

export function recipeChanged(initial: RecipeDraft, current: RecipeDraft): boolean {
  return JSON.stringify(recipeSaveBody(0, initial)) !== JSON.stringify(recipeSaveBody(0, current))
}

/** null = hợp lệ. Tắt "có món bán kèm" thì không xét danh sách. */
export function validateTopping(serviceId: number, draft: ToppingDraft): string | null {
  if (!draft.enabled) return null
  if (draft.lines.length === 0) return 'Thêm ít nhất một món bán kèm.'
  return validateToppingDraft(serviceId, draft.lines)
}

export function toppingSaveBody(serviceId: number, draft: ToppingDraft): ToppingSaveBody {
  return {
    serviceId,
    isSelect: draft.single,
    toppings: draft.enabled ? toppingLinesBody(draft.lines) : [],
  }
}

/** Cả hai bên không có món bán kèm ⇒ không đổi (cách chọn một/nhiều vô nghĩa khi không có dòng nào). */
export function toppingChanged(initial: ToppingDraft, current: ToppingDraft): boolean {
  const a = toppingSaveBody(0, initial)
  const b = toppingSaveBody(0, current)
  if (a.toppings.length === 0 && b.toppings.length === 0) return false
  return JSON.stringify(a) !== JSON.stringify(b)
}
