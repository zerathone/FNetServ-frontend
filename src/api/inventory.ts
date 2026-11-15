import { apiPost } from './client'

// task topping-kho / T3f — admin kho nguyên liệu, công thức, topping, kho thành phẩm, chốt kỳ.
// Hợp đồng: ServerSide_ai/FNetHttp/InventoryHandlers.cpp. Mọi route đều là POST (kể cả route đọc).
// Số lượng nguyên liệu là CHUỖI decimal(12,3) ("1.500") — không đi qua float; gửi lên cũng là chuỗi.
// Schema DB chưa có bảng ⇒ route đọc trả `supported:false` (KHÔNG lỗi); route ghi trả code `unsupported`.

export type InventoryFilter = {
  materialId?: number
  serviceId?: number
  serviceDetailId?: number
  /** 0 = tất cả; 1 nhập, 2 xuất/trả, 3 kiểm kê (đặt số). */
  msType?: number
  activeOnly?: boolean
  lowOnly?: boolean
  /** YYYY-MM-DD. */
  fromDate?: string
  toDate?: string
  limit?: number
  offset?: number
}

// ===== Nguyên liệu + đơn vị (T3a) =====

export type MaterialRow = {
  materialId: number
  name: string
  isActive: number
  unit: string
  unitId: number
  materialNote: string
  minStockQty: string
  stockQty: string
  mslCode: string
  /** stockQty <= minStockQty. */
  low: boolean
  // Chỉ có ở /inventory/stock-closing (xem trước kỳ đang mở).
  openingQty?: string
  importQty?: string
  exportQty?: string
  usageQty?: string
  adjustQty?: string
  expectedQty?: string
  diffQty?: string
}

export type MaterialList = { supported: boolean; rows: MaterialRow[] }

export function getMaterials(filter: InventoryFilter = {}) {
  return apiPost<MaterialList, InventoryFilter>('/inventory/materials', filter)
}

export type MaterialSaveBody = {
  /** 0/bỏ trống = thêm mới. */
  materialId?: number
  name: string
  note?: string
  unitId?: number
  minStockQty?: string
  /** Bỏ trống khi sửa = giữ nguyên. */
  isActive?: boolean
}

export function saveMaterial(body: MaterialSaveBody) {
  return apiPost<{ materialId: number; created: boolean }, MaterialSaveBody>('/inventory/material/save', body)
}

export function toggleMaterialActive(body: { materialId: number; isActive: boolean }) {
  return apiPost<{ materialId: number; isActive: number }, typeof body>('/inventory/material/toggle-active', body)
}

export type UnitRow = { id: number; unit: string; isActive: number }

export function getUnits() {
  return apiPost<{ rows: UnitRow[] }, Record<string, never>>('/inventory/units', {})
}

export function saveUnit(body: { id?: number; unit: string; isActive?: boolean }) {
  return apiPost<{ id: number }, typeof body>('/inventory/unit/save', body)
}

// ===== Nhập / xuất / đặt số nguyên liệu (T3c) =====

export type StockMoveBody = {
  materialId: number
  /** 1 nhập, 2 xuất/trả, 3 đặt số (kiểm kê). */
  msType: 1 | 2 | 3
  qty: string
  price?: string
  /** Mã phiếu ≤20 ký tự [A-Za-z0-9_.-/]; xuất phải là mã phiếu NHẬP đã có của nguyên liệu. */
  code: string
  note?: string
}

export type StockMoveResult = {
  msId: number
  materialId: number
  msType: number
  stockBefore: string
  stockAfter: string
  /** Chỉ msType=3: chênh lệch kiểm kê (âm = hao hụt). */
  diff?: string
}

export function stockMaterial(body: StockMoveBody) {
  return apiPost<StockMoveResult, StockMoveBody>('/inventory/material/stock', body)
}

// ===== Công thức + topping (T3b) =====

export type RecipeLine = {
  materialId: number
  materialName: string
  unit: string
  qty: string
  wastePercent: string
  materialActive: number
}

export type ToppingLine = {
  toppingId: number
  serviceId: number
  name: string
  unit: string
  toppingQty: string
  topPrice: string
  zMaterialId: number
  inventoryManagement: number
  active: number
}

export type RecipeConfig = {
  supported: boolean
  serviceId?: number
  name?: string
  zType?: number
  zRecipe?: number
  zTopping?: number
  /** > 0: dịch vụ LÀ một nguyên liệu (topping nhóm 2), không có dòng công thức. */
  zMaterialId?: number
  isSelect?: number
  recipe: RecipeLine[]
  toppings: ToppingLine[]
}

export function getRecipeConfig(serviceId: number) {
  return apiPost<RecipeConfig, { serviceId: number }>('/service/recipe-config', { serviceId })
}

export type RecipeSaveBody =
  | { serviceId: number; lines: Array<{ materialId: number; qty: string; wastePercent?: string }> }
  | { serviceId: number; materialId: number }

export function saveRecipe(body: RecipeSaveBody) {
  return apiPost<
    { serviceId: number; zType: number; zRecipe: number; zMaterialId: number },
    RecipeSaveBody
  >('/service/recipe/save', body)
}

export type ToppingSaveBody = {
  serviceId: number
  /** 0 = chọn nhiều, 1 = chọn một. */
  isSelect: 0 | 1
  toppings: Array<{ serviceId: number; toppingQty?: string; topPrice?: string }>
}

export function saveToppings(body: ToppingSaveBody) {
  return apiPost<{ serviceId: number; zTopping: number; isSelect: number }, ToppingSaveBody>(
    '/service/topping/save',
    body,
  )
}

// ===== Báo cáo: sổ kho + tiêu hao (T3e) =====

export type LedgerRow = {
  msId: number
  materialId: number
  materialName: string
  msQty: string
  msPrice: string
  msNote: string
  /** 1 nhập, 2 xuất, 3 kiểm kê. */
  msType: number
  msCode: string
  msUname: string
  /** Unix giây. */
  createDate: number
  unit: string
  msUid: number
  /** Chỉ dòng kiểm kê do FNet ghi (R6a); dòng khác/iCafe = null. */
  stockBefore: string | null
  diff: string | null
}

export type LedgerResult = { supported: boolean; total: number; rows: LedgerRow[] }

export function getLedger(filter: InventoryFilter = {}) {
  return apiPost<LedgerResult, InventoryFilter>('/inventory/material-ledger', filter)
}

export type UsageRow = {
  id: number
  serviceDetailId: number
  serviceId: number
  serviceName: string
  materialName: string
  serviceQty: number
  materialQty: string
  totalQty: string
  createDate: string
  isTopping: number
  unit: string
  unitId: number
  materialId: number
  orderServiceId: number
}

export type UsageSummaryRow = { materialId: number; materialName: string; totalQty: string; lines: number }

export type UsageResult = {
  supported: boolean
  total: number
  rows: UsageRow[]
  summary: UsageSummaryRow[]
}

export function getUsage(filter: InventoryFilter = {}) {
  return apiPost<UsageResult, InventoryFilter>('/inventory/material-usage', filter)
}

// ===== Kho thành phẩm (T3d) — dịch vụ có InventoryManagement=1 =====

export type FinishedImportRow = {
  id: number
  createDate: string
  createTime: string
  staffId: number
  note: string
  serviceId: number
  importQuantity: number
  importPrice: number
  importTotalAmount: number
  serviceName: string
  unit: string
  groupName: string
  userName: string
}

export type FinishedStocktakeRow = {
  id: number
  createDate: string
  createTime: string
  staffId: number
  numInventoryExpected: number
  numInventoryReal: number
  numAdjust: number
  numPreAdjust: number
  note: string
  serviceId: number
  serviceName: string
  unit: string
  groupName: string
  userName: string
}

export type FinishedResult = {
  supported: boolean
  imports: FinishedImportRow[]
  stocktakes: FinishedStocktakeRow[]
}

export function getFinished(filter: InventoryFilter = {}) {
  return apiPost<FinishedResult, InventoryFilter>('/inventory/finished', filter)
}

/** `idem` bắt buộc (≤50 ký tự) — retry mạng không được nhập đôi. */
export type FinishedImportBody = {
  serviceId: number
  quantity: number
  price: number
  note?: string
  idem: string
}

export type FinishedImportResult = {
  id: number
  serviceId: number
  quantity: number
  importTotalAmount: number
  inventoryBefore: number
  inventoryAfter: number
  duplicated?: boolean
}

export function importFinished(body: FinishedImportBody) {
  return apiPost<FinishedImportResult, FinishedImportBody>('/inventory/finished/import', body)
}

/** ĐÚNG MỘT trong numReal (số đếm thực tế ≥0) / numAdjust (chênh lệch, có thể âm). */
export type FinishedStocktakeBody = {
  serviceId: number
  numReal?: number
  numAdjust?: number
  note?: string
  idem: string
}

export type FinishedStocktakeResult = {
  id: number
  serviceId: number
  numInventoryExpected: number
  numPreAdjust: number
  numAdjust: number
  numInventoryReal: number
  duplicated?: boolean
}

export function stocktakeFinished(body: FinishedStocktakeBody) {
  return apiPost<FinishedStocktakeResult, FinishedStocktakeBody>('/inventory/finished/stocktake', body)
}

// ===== Chốt kỳ kho nguyên liệu (R6b) =====

export type ClosingPeriod = {
  prevClosingId: number
  fromDate: string | null
  toDate: string
}

export type ClosingPreview = {
  supported: boolean
  closedAt: string
  /** Nguyên liệu đang dùng mà stockQty <= minStockQty. */
  warnings: MaterialRow[]
  rows: MaterialRow[]
  /** Có khi DB đã có bảng chốt kỳ. */
  period?: ClosingPeriod
}

export function getClosingPreview() {
  return apiPost<ClosingPreview, Record<string, never>>('/inventory/stock-closing', {})
}

export type ClosingLine = {
  materialId: number
  materialName: string
  unit: string
  openingQty: string
  importQty: string
  exportQty: string
  usageQty: string
  adjustQty: string
  expectedQty: string
  closingQty: string
  diffQty: string
}

export type ClosingCommitResult = {
  closingId: number
  fromDate: string | null
  toDate: string
  staffName: string
  materialCount: number
  diffCount: number
  rows: ClosingLine[]
  duplicated?: boolean
}

export function commitClosing(body: { note?: string; idem: string }) {
  return apiPost<ClosingCommitResult, typeof body>('/inventory/stock-closing/commit', body)
}

export type ClosingSummary = {
  closingId: number
  fromDate: string | null
  createDate: string
  staffId: number
  staffName: string
  note: string
  materialCount: number
  diffCount: number
}

export function listClosings(filter: { limit?: number; offset?: number } = {}) {
  return apiPost<{ supported: boolean; total: number; rows: ClosingSummary[] }, typeof filter>(
    '/inventory/stock-closings',
    filter,
  )
}

export type ClosingDetail = {
  supported: boolean
  closingId?: number
  fromDate?: string | null
  createDate?: string
  staffId?: number
  staffName?: string
  note?: string
  rows: ClosingLine[]
}

export function getClosingDetail(closingId: number) {
  return apiPost<ClosingDetail, { closingId: number }>('/inventory/stock-closing/detail', { closingId })
}
