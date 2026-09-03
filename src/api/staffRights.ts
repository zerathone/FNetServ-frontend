import { apiGet, apiPost } from './client';

export interface StaffRight {
  code: number;
  name: string;
}

export interface StaffRightsResponse {
  staffId: number;
  username: string;
  isAdmin: boolean;
  rights: StaffRight[];
}

export const staffRightsApi = {
  // Lấy danh sách quyền của một nhân viên (và tất cả function codes có thể cấp)
  // Thực tế API GET /staff/rights trả về danh sách function-list + granted set.
  getRights: async (staffId: number) => {
    return apiGet<any>(`/staff/rights?staffId=${staffId}`);
  },
  
  // Cập nhật phân quyền cho một nhân viên
  updateRights: async (staffId: number, functionCodes: string[]) => {
    return apiPost<any, { staffId: number, functionCodes: string[] }>('/staff/rights', { staffId, functionCodes });
  }
};
