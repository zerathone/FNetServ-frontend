import { apiDelete, apiGet, apiGetBlob, apiPost, apiPostForm, apiPut } from './client'

export interface UserAccount {
  userId: number
  userName: string
  firstName: string
  lastName: string
  groupName: string
  idNumber: string
  phone: string
  email: string
  note: string
  moneyPaid: number
  moneyRemain: number
  moneyUsed: number
  moneyFree: number
  moneyTransfer: number
  moneyMain: number
  moneySub: number
  debit: number
  isUnder18: number
}

export interface UsersResponse {
  type: string
  items: UserAccount[]
}

export interface UserDetail {
  id: number
  userGroupId: number
  username: string
  fullName: string
  idNumber: string | null
  phone: string | null
  email: string | null
  address: string | null
  city: string | null
  district: string | null
  note: string
  birthday: string
  gender: 1 | 2 | 3
  active: boolean
  expiryDate: string
  isVat: boolean
  usageTimeId: number
  canViewContact: boolean
  mobile: {
    paired: boolean
  }
  portrait: {
    exists: boolean
  }
  version: string
}

export type UpdateUserDetailBody = Pick<
  UserDetail,
  | 'id'
  | 'username'
  | 'userGroupId'
  | 'fullName'
  | 'idNumber'
  | 'phone'
  | 'email'
  | 'address'
  | 'city'
  | 'district'
  | 'note'
  | 'birthday'
  | 'gender'
  | 'active'
  | 'expiryDate'
  | 'isVat'
  | 'usageTimeId'
> & {
  expectedVersion: string
  password?: string
  confirmMobileUnpair?: boolean
}

export type UpdateUserDetailResult = {
  id: number
  version: string
  mobile: { paired: boolean }
}

export type CccdDraft = {
  id: string
  name: string
  dob: string
  gender: string | number
  address: string
  city: string
  district: string
}

export type CccdScanState =
  | { state: 'pending' }
  | { state: 'done'; draft: CccdDraft }
  | { state: 'failed'; reason?: string }
  | { state: 'expired' | 'cancelled' }

export type MobilePairState =
  | { state: 'pending' }
  | { state: 'done'; mobile: { paired: boolean } }
  | { state: 'failed'; reason?: string }
  | { state: 'expired' | 'cancelled' }

export type GenerateUsersPayload = {
  prefix: string
  startNum: number
  endNum: number
  userGroupId: number
  initialMoney: number
  expiryDate: string
  note: string
}

export type GeneratedUser = {
  userId: number
  username: string
  password: string
}

export type GenerateUsersResult = {
  created: GeneratedUser[]
  skipped: string[]
}

export type UserRechargeHistoryItem = {
  voucherDate: string
  voucherTime: string
  voucherNo: string
  amount: number
  autoAmount: number
  paymentType: number
  note: string
  staffId: number
  staffName: string
}

export type UserRechargeHistory = {
  total: number
  items: UserRechargeHistoryItem[]
}

export type UserUsageLog = {
  machineName: string
  ipAddress: string
  enterDate: string
  enterTime: string
  endDate: string
  endTime: string
  timeUsed: number
  moneyUsed: string
}

export const getUsers = (type: 'member' | 'staff' | 'combo' = 'member', limit = 200, offset = 0, q?: string) => {
  let url = `/users?type=${type}&limit=${limit}&offset=${offset}`;
  if (q) url += `&q=${encodeURIComponent(q)}`;
  return apiGet<UsersResponse>(url);
}

export const getUserDetail = (userId: number) =>
  apiGet<UserDetail>(`/user?id=${userId}`)

export const updateUserDetail = (body: UpdateUserDetailBody) =>
  apiPut<UpdateUserDetailResult, UpdateUserDetailBody>('/user', body)

export const startCccdScan = (username: string, fullName: string) =>
  apiGet<{ sid: string; qr: string; ttl: number; state: 'pending' }>(
    `/ccscan?m=20&un=${encodeURIComponent(username)}&fn=${encodeURIComponent(fullName)}`,
  )

export const getCccdScanStatus = (sid: string) =>
  apiGet<CccdScanState>(`/ccscan?m=21&sid=${encodeURIComponent(sid)}`)

export const cancelCccdScan = (sid: string) =>
  apiGet<{ state: 'cancelled' }>(`/ccscan?m=22&sid=${encodeURIComponent(sid)}`)

export const startMobilePair = (userId: number) =>
  apiPostForm<{ pairId: string; qr: string; qrDownload: string; expiresIn: number; state: 'pending' }>(
    '/qrverf',
    { m: 20, uid: userId },
  )

export const getMobilePairStatus = (pairId: string) =>
  apiPostForm<MobilePairState>('/qrverf', { m: 21, pid: pairId })

export const cancelMobilePair = (pairId: string) =>
  apiPostForm<{ state: 'cancelled' | 'expired' }>('/qrverf', { m: 22, pid: pairId })

export const unpairMobile = (userId: number) =>
  apiPostForm<{ mobile: { paired: boolean } }>('/qrverf', { m: 22, uid: userId })

export type UserPortraitMutationResult = {
  portrait: { exists: boolean; version: string }
}

export const getUserPortrait = (userId: number) =>
  apiGetBlob(`/user/portrait?userId=${userId}`)

export const updateUserPortrait = (userId: number, imageBase64: string) =>
  apiPut<UserPortraitMutationResult, { userId: number; imageBase64: string }>(
    '/user/portrait',
    { userId, imageBase64 },
  )

export const deleteUserPortrait = (userId: number) =>
  apiDelete<UserPortraitMutationResult>(`/user/portrait?userId=${userId}`)

export const generateUsers = (payload: GenerateUsersPayload) =>
  apiPost<GenerateUsersResult, GenerateUsersPayload>('/users/generate', payload)

export type UserHistoryDateRange = { from?: string; to?: string }

function dateRangeQuery({ from, to }: UserHistoryDateRange) {
  return from && to ? `&from=${from}&to=${to}` : ''
}

export const getRechargeHistory = (userId: number, range: UserHistoryDateRange = {}) =>
  apiGet<UserRechargeHistory>(`/user/recharge-history?userId=${userId}${dateRangeQuery(range)}`)

export const getUserLogs = (userId: number, limit = 200, offset = 0, range: UserHistoryDateRange = {}) =>
  apiGet<UserUsageLog[]>(`/user/logs?userId=${userId}&limit=${limit}&offset=${offset}${dateRangeQuery(range)}`)

export const usersApi = {
  generateUsers,
  
  // Lấy danh sách hội viên cũ cần dọn dẹp
  getCleanCandidates: async (months: number, ignoreBalance: boolean) => {
    return apiGet<any>(`/users/clean-candidates?months=${months}&ignoreBalance=${ignoreBalance}`);
  },

  // Dọn dẹp hội viên
  cleanCandidates: async (options: { beforeDays: number; status: string }) => {
    const { apiDelete } = await import('./client');
    return apiDelete<any, typeof options>('/users/candidates/clean', options);
  },

  // Xóa hội viên hàng loạt
  deleteBatch: async (userIds: number[]) => {
    const { apiDelete } = await import('./client');
    return apiDelete<any, { userIds: number[] }>('/users/batch', { userIds });
  },

  // Lịch sử nạp
  getRechargeHistory,

  // Nhật ký hội viên
  getUserLogs,

  // Trả nợ
  payDebt: async (payload: { userId: number; amount: number; idem: string }) => {
    const { apiPost } = await import('./client');
    return apiPost<any, typeof payload>('/member/paydebt', payload);
  },

  // Nạp tiền
  deposit: async (payload: {
    userId: number
    chargeMoney: number
    paymentMethod: 'cash' | 'bank_transfer'
    idem: string
    note?: string
  }) => {
    const { apiPost } = await import('./client');
    return apiPost<any, typeof payload>('/user/deposit', payload);
  },
  
  // Mượn tiền/giờ
  credit: async (payload: { userId: number; borrowMoney: number; idem: string }) => {
    const { apiPost } = await import('./client');
    return apiPost<any, typeof payload>('/user/credit', payload);
  },

  // Tặng tiền/giờ
  giveFree: async (payload: { userId: number; giveMoney: number; idem: string }) => {
    const { apiPost } = await import('./client');
    return apiPost<any, typeof payload>('/user/give-free', payload);
  },

  // Chuyển tiền
  transfer: async (payload: { fromUserId: number; toUserId: number; transferMoney: number; idem: string }) => {
    const { apiPost } = await import('./client');
    return apiPost<any, typeof payload>('/user/transfer', payload);
  }
};
