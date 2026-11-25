import { apiGet } from './client'
import type { RecipeLine } from './inventory'

export type ServiceItem = {
  id: number
  name: string
  price: number
  unit: string
  inventory: number
  inventoryManagement: number
  // task staff-service-order (BE-3): chỉ THÊM field, server KHÔNG lọc Active (trang quản lý danh mục
  // cần thấy món đã ngừng) ⇒ nơi nào chỉ muốn món đang bán phải tự lọc `active !== 0`. Server cũ
  // chưa có field này ⇒ `undefined` (coi như đang bán, chưa có nhóm).
  active?: number
  groupId?: number
  groupName?: string
  // task service-catalog (BE): chỉ THÊM field. Server cũ chưa có ⇒ `undefined` — mọi nơi dùng phải coi
  // `undefined` là "như trước" (không lọc, không chỉ-đọc), đừng làm trống menu.
  unitId?: number
  /** `-1` (Qt cũ ghi) hoặc `0` = không cảnh báo; chỉ có nghĩa khi `inventoryManagement === 1`. */
  warningInventory?: number
  /** Loại nhóm của món: 0 = nhóm thường, 2 = nhóm topping. */
  groupTypeId?: number
  /** 0 = nhóm đang ngừng dùng ⇒ món không hiện ở menu bán. */
  groupActive?: number
  /** Dòng hệ thống/ngoài danh mục (FFOOD…): chỉ đọc, không sửa/ngừng bán trên màn này. */
  readonly?: boolean
  /**
   * VAT của món: `-1` = chưa khai báo / KHÔNG áp dụng thuế; `0` = thuế 0% (vẫn gửi sang bên thuế) — hai giá trị
   * riêng biệt. `undefined` = server cũ hoặc DB chưa có cột ⇒ không hiện/không gửi VAT.
   */
  vatPercent?: number
  /**
   * Tồn SỔ SÁCH (NumInventoryExpected: nhập − bán, kiểm kê không đụng) — CHỈ có ở món inventoryManagement === 1, server mới.
   * Chênh lệch = inventoryExpected − inventory (tính ở FE); undefined = server cũ ⇒ hiện —, không lỗi.
   */
  inventoryExpected?: number
  /** Tên file ảnh trong thư mục ảnh dùng chung với iCafe ("" = chưa có). `undefined` = server cũ. */
  serviceImg?: string
  /**
   * Công thức nguyên liệu của món — CHỈ có khi gọi `getServicesWithRecipe()` (`?include=recipe`) VÀ server mới đủ schema.
   * `[]` = món chưa cấu hình công thức; `undefined` = server cũ / không hỏi ⇒ KHÔNG biết, đừng hiểu là "không có công thức".
   * Cùng hình dạng với `/service/recipe-config` (`qty` là chuỗi decimal chuẩn, vd "1.500").
   */
  recipe?: RecipeLine[]
  /**
   * Nguyên liệu mà món "là nguyên liệu" (servicetb.zMaterialId > 0) đại diện + tồn — CHỈ có ở `?include=recipe` và chỉ món
   * thuộc loại đó. `undefined` = không phải món loại đó HOẶC server cũ.
   */
  material?: ServiceMaterial
  /**
   * Món bán kèm của món (kèm tồn để tính "còn bao nhiêu phần") — CHỈ có ở `?include=topping`, server mới. `[]` = không có món
   * bán kèm; `undefined` = server cũ / không hỏi.
   */
  toppings?: ServiceTopping[]
}

export type ServiceMaterial = {
  materialId: number
  name: string
  unit: string
  /** Tồn nguyên liệu (decimal chuẩn, vd "12.500"). */
  stockQty: string
  active: number
}

export type ServiceTopping = {
  /** ServiceId của món bán kèm. */
  serviceId: number
  name: string
  unit: string
  /** Giá thực tính cho khách = giá bán của món bán kèm (VND). */
  price: number
  /** Lượng nguyên liệu trừ / 1 topping của CẶP (món cha, topping); "0.000" = chưa khai, server tính là 1. */
  toppingQty: string
  /** > 0 = topping gắn nguyên liệu (trừ `materialstb`); 0 = topping thường / thành phẩm. */
  zMaterialId: number
  inventoryManagement: number
  /** Tồn thành phẩm của món bán kèm — chỉ có nghĩa khi `inventoryManagement === 1`. */
  inventory: number
  active: number
  materialName: string
  materialUnit: string
  materialStock: string
  materialActive: number
}

export function getServices() {
  return apiGet<ServiceItem[]>('/services')
}

/**
 * Danh sách kèm công thức + món bán kèm (+ tồn nguyên liệu) từng món trong CÙNG một request (server gộp vài câu SQL cho cả
 * danh mục, không N+1). Dùng queryKey riêng (`['services', 'catalog']`) — KHÔNG dùng chung `['services']` với các nơi gọi
 * `getServices()` vì hình dạng dữ liệu khác.
 */
export function getServicesWithRecipe() {
  return apiGet<ServiceItem[]>('/services?include=recipe,topping')
}

export const servicesApi = {
  // Chuyển phí máy
  transferFee: async (data: { fromMachine: string; toMachine: string; amount: number }) => {
    const { apiPost } = await import('./client');
    return apiPost<any, typeof data>('/service/transferfee', data);
  },

  // Thanh toán đơn chờ
  payRequest: async (data: { id: number; type: number }) => {
    const { apiPost } = await import('./client');
    return apiPost<any, typeof data>('/service/payrequest', data);
  }
};
