import { apiPost } from './client'

// task topping-kho / T3f — admin kho nguyên liệu, công thức, topping, kho hàng hóa, chốt kỳ.
// Hợp đồng: ServerSide_ai/FNetHttp/InventoryHandlers.cpp. Mọi route đều là POST (kể cả route đọc).
// Số lượng nguyên liệu là CHUỖI decimal(12,3) ("1.500") — không đi qua float; gửi lên cũng là chuỗi.
// Schema DB chưa có bảng ⇒ route đọc trả `supported:false` (KHÔNG lỗi); route ghi trả code `unsupported`.

export type InventoryFilter = {
  materialId?: number
  serviceId?: number
  serviceDetailId?: number
  /** Chỉ `/inventory/material-ledger`: chỉ phiếu do nhân viên này ghi (msUid); bỏ trống = tất cả. Server cũ bỏ qua tham số này. */
  staffId?: number
  /** 0 = tất cả; 1 nhập, 2 xuất/trả, 3 kiểm kê (đặt số). */
  msType?: number
  /** Chỉ `/inventory/material-usage`: 0 = theo công thức, 1 = bán kèm (topping); bỏ trống = tất cả. Server cũ bỏ qua tham số này. */
  isTopping?: 0 | 1
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
  /** Tồn nguyên liệu hiện tại (decimal chuẩn) — CHỈ có ở `GET /services?include=recipe` (server mới), `/service/recipe-config` không trả. */
  stockQty?: string
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

// ===== Kho hàng hóa — dịch vụ có InventoryManagement=1 (task service-catalog đợt 2, theo Qt) =====
// Hợp đồng: handoff/HANDOFF_service-catalog.md §7; BE: ServerSide_ai/FNetHttp/FinishedStockHandlers.cpp.
// Phản hồi `{status:"1"|"0", message, data}`; lỗi có `data.code` (ApiError.code) + `message` tiếng Việt — hiển thị nguyên văn.
// Phiếu nhiều dòng KHÔNG nguyên tử (MyISAM): từng dòng ghi độc lập, kết quả trả theo dòng.

/** Một dòng kết quả của phiếu nhiều dòng. Dòng lỗi chỉ chắc chắn có `index`, `ok`, `code`, `message`. */
export type BatchLineStatus = { index: number; ok: boolean; code?: string; message?: string }

// ----- Phiếu nhập nhiều dòng (quyền 64) -----

export type FinishedImportLineBody = {
  serviceId: number
  /** Theo ĐƠN VỊ ĐÃ CHỌN (nguyên ≥1). */
  quantity: number
  /** Trống = đơn vị gốc của món. */
  unitId?: number
  /** Giá nhập theo đơn vị đã chọn (nguyên ≥0). */
  price: number
  note?: string
}

export type FinishedImportBatchBody = { idem: string; lines: FinishedImportLineBody[] }

export type FinishedImportLineResult = BatchLineStatus & {
  id?: number
  serviceId?: number
  unitId?: number
  unit?: string
  factor?: number
  quantity?: number
  /** SL sau quy đổi về đơn vị gốc. */
  quantityBase?: number
  importPrice?: number
  /** true = giá lẻ bị cắt khi chia hệ số (parity Qt). */
  priceRounded?: boolean
  importTotalAmount?: number
  inventoryBefore?: number
  inventoryAfter?: number
}

export type FinishedImportBatchResult = {
  results: FinishedImportLineResult[]
  okCount: number
  failCount: number
  totalAmount: number
  duplicated?: boolean
}

/** `idem` bao cả phiếu (≤50 ký tự): retry cùng nội dung không nhập đôi. */
export function importFinishedBatch(body: FinishedImportBatchBody) {
  return apiPost<FinishedImportBatchResult, FinishedImportBatchBody>('/inventory/finished/import-batch', body)
}

// ----- Phiếu kiểm kê nhiều dòng (quyền 68) -----

/** ĐÚNG MỘT trong numReal (số đếm thực tế ≥0) / numAdjust (chênh lệch, có thể âm). */
export type FinishedStocktakeLineBody = {
  serviceId: number
  numReal?: number
  numAdjust?: number
  note?: string
}

export type FinishedStocktakeBatchBody = { idem: string; lines: FinishedStocktakeLineBody[] }

export type FinishedStocktakeLineResult = BatchLineStatus & {
  id?: number
  serviceId?: number
  numInventoryExpected?: number
  numPreAdjust?: number
  numAdjust?: number
  numInventoryReal?: number
}

export type FinishedStocktakeBatchResult = {
  results: FinishedStocktakeLineResult[]
  okCount: number
  failCount: number
  duplicated?: boolean
}

export function stocktakeFinishedBatch(body: FinishedStocktakeBatchBody) {
  return apiPost<FinishedStocktakeBatchResult, FinishedStocktakeBatchBody>(
    '/inventory/finished/stocktake-batch',
    body,
  )
}

// ----- Báo cáo nhập kho / kiểm kê (quyền 9391/93911, 9392/93921) -----

export type FinishedReportFilter = {
  /** YYYY-MM-DD, gồm cả hai đầu; Từ > Đến ⇒ invalid_request. */
  fromDate?: string
  toDate?: string
  /** 'HH:mm' (tuỳ chọn, chỉ có tác dụng khi có ngày tương ứng): thiếu ⇒ cả ngày. Đến giờ gồm hết phút đó. Máy chủ cũ bỏ qua. */
  fromTime?: string
  toTime?: string
  groupId?: number
  serviceId?: number
  /** Chỉ có tác dụng khi có quyền ALL; không có ⇒ máy chủ ép về chính người gọi. */
  staffId?: number
  /** ≤200. */
  limit: number
  offset: number
}

type FinishedReportRowBase = {
  id: number
  createDate: string
  createTime: string
  staffId: number
  userName: string
  note: string
  serviceId: number
  serviceName: string
  unit: string
  groupId: number
  groupName: string
}

export type FinishedImportReportRow = FinishedReportRowBase & {
  /** Theo ĐƠN VỊ GỐC (Q21). */
  importQuantity: number
  importPrice: number
  importTotalAmount: number
}

export type FinishedStocktakeReportRow = FinishedReportRowBase & {
  numInventoryExpected: number
  numPreAdjust: number
  numAdjust: number
  numInventoryReal: number
}

export type FinishedReportResult<Row> = {
  supported: boolean
  kind: string
  total: number
  /** Chỉ có ở kind=imports: SUM ImportTotalAmount cả khoảng lọc (không chỉ trang hiện tại). */
  totalAmount?: number
  limit: number
  offset: number
  rows: Row[]
}

export function getFinishedImportReport(filter: FinishedReportFilter) {
  return apiPost<FinishedReportResult<FinishedImportReportRow>, FinishedReportFilter & { kind: 'imports' }>(
    '/inventory/finished/report',
    { ...filter, kind: 'imports' },
  )
}

export function getFinishedStocktakeReport(filter: FinishedReportFilter) {
  return apiPost<FinishedReportResult<FinishedStocktakeReportRow>, FinishedReportFilter & { kind: 'stocktakes' }>(
    '/inventory/finished/report',
    { ...filter, kind: 'stocktakes' },
  )
}

// ----- Báo cáo Nhập – xuất = lịch sử chốt kho (quyền 9394/93941) -----

/** Số ĐÃ LƯU lúc chốt — hiển thị nguyên, không tính lại. */
export type FinishedClosingRow = FinishedReportRowBase & {
  fromDate: string
  fromTime: string
  numBalance: number
  importQuantity: number
  importTotalAmount: number
  saleQuantity: number
  saleTotalAmount: number
  numAdjust: number
  numInventoryExpected: number
  numInventoryReal: number
}

export function getFinishedClosings(filter: FinishedReportFilter) {
  return apiPost<FinishedReportResult<FinishedClosingRow>, FinishedReportFilter>('/inventory/finished/closings', filter)
}

// ----- Chốt kho (quyền 69) -----

/** Một dòng XEM TRƯỚC chốt kho: đúng số sẽ ghi lúc chốt (máy chủ chạy cùng phép tính, không ghi gì). Máy chủ cũ chưa có route. */
export type FinishedClosingPreviewRow = {
  serviceId: number
  fromDate: string
  fromTime: string
  numBalance: number
  importQuantity: number
  importTotalAmount: number
  saleQuantity: number
  saleTotalAmount: number
  numAdjust: number
  numInventoryExpected: number
  numInventoryReal: number
  /** Kỳ rỗng: chưa từng chốt/nhập kho. */
  empty: boolean
}

export type FinishedClosingPreview = {
  closingAt: string
  rows: FinishedClosingPreviewRow[]
  skipped: { serviceId: number; code: string }[]
}

export function getFinishedClosingPreview() {
  return apiPost<FinishedClosingPreview, Record<string, never>>('/inventory/finished/closing/preview', {})
}

export type FinishedClosingCommitResult = {
  closingAt: string
  closedCount: number
  skipped: Array<{ serviceId: number; code: string }>
  duplicated?: boolean
}

export function commitFinishedClosing(body: { idem: string; note?: string }) {
  return apiPost<FinishedClosingCommitResult, typeof body>('/inventory/finished/closing/commit', body)
}

// ----- Đơn vị quy đổi (đọc: không quyền; ghi/xoá: 65) -----

export type ConvertUnitRow = {
  /** 0 = dòng đơn vị gốc chưa có trong bảng (món tạo từ web/iCafe). */
  id: number
  unitId: number
  unit: string
  /** Số đơn vị gốc trong 1 đơn vị này (gốc = 1). */
  quantity: number
  root: boolean
}

export type ConvertUnitList = {
  supported: boolean
  serviceId: number
  rootUnitId: number
  rootUnit: string
  rows: ConvertUnitRow[]
}

export function getConvertUnits(serviceId: number) {
  return apiPost<ConvertUnitList, { serviceId: number }>('/service/convert-unit/list', { serviceId })
}

export type ConvertUnitSaveBody = {
  serviceId: number
  unitId: number
  /** 2..1.000.000 = số đơn vị gốc trong 1 đơn vị này. */
  quantity: number
}

export function saveConvertUnit(body: ConvertUnitSaveBody) {
  return apiPost<
    { id: number; serviceId: number; unitId: number; unit: string; quantity: number; created: boolean },
    ConvertUnitSaveBody
  >('/service/convert-unit/save', body)
}

export function removeConvertUnit(id: number) {
  return apiPost<{ id: number; removed: boolean }, { id: number }>('/service/convert-unit/remove', { id })
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
