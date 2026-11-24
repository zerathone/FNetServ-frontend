import { apiDelete, apiGet, apiGetBlob, apiPost, apiPostForm, apiPut } from './client'
import {
  buildAdvQuery,
  buildChangeGroupBody,
  buildCleanQuery,
  summarizeDeleteResult,
  type AdvFilter,
  type ChangeGroupBody,
  type CleanForm,
} from '../features/customers/userAdminModel'

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

/**
 * Một dòng của GET /users?type=combo (parity MFC ComboCardList: Tên đăng nhập, Máy, Thời hạn sử dụng, Thời điểm sử dụng, Ghi chú).
 * `fromTime`/`toTime`/`note` do server bản mới trả; server cũ không có ⇒ các trường này undefined (model tự xử lý).
 * `memo` là chuỗi thô (có thể là bản mã) — chỉ đọc `note`.
 */
export interface ComboCardRow {
  userId: number
  userName: string
  createDate?: string
  createTime?: string
  fromDate?: string
  fromTime?: string
  toDate?: string
  toTime?: string
  zone?: string
  memo?: string
  note?: string
}

export interface ComboCardsResponse {
  type: string
  items: ComboCardRow[]
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

/**
 * Truong de tim khi type=member. Moi gia tri = 1 luot quet bang hoi vien o BE
 * (DAOUser::filter_ids). Bo trong => BE giu hanh vi cu: OR ca 3 truong = 3 luot quet,
 * cham gap 3. Xem handoff/fixbug/HANDOFF_fixbug_member_search_slow.md
 */
export type UserSearchField = 'username' | 'phone' | 'idnumber'

export const getUsers = (
  type: 'member' | 'staff' | 'combo' = 'member',
  limit = 200,
  offset = 0,
  q?: string,
  qby?: UserSearchField,
  /** 'week' = sinh nhật trong tuần hiện tại (thứ Hai → Chủ nhật); 'month' = trong tháng hiện tại. Chỉ hiểu với hội viên/nhân viên. */
  birthday?: 'week' | 'month',
  /** 1..12, chỉ dùng khi `birthday = 'month'`; bỏ trống = tháng hiện tại của máy chủ. */
  birthdayMonth?: number,
) => {
  let url = `/users?type=${type}&limit=${limit}&offset=${offset}`;
  if (q) url += `&q=${encodeURIComponent(q)}`;
  if (q && qby) url += `&qby=${qby}`;
  if (birthday) url += `&birthday=${birthday}`;
  if (birthday === 'month' && birthdayMonth) url += `&month=${birthdayMonth}`;
  return apiGet<UsersResponse>(url);
}

/** Tổng số tài khoản từng tab (GET /users/counts: 3 câu COUNT(*) ở server, không tải danh sách). */
export type UserCounts = {
  member: number
  staff: number
  combo: number
  /** Số tài khoản có sinh nhật trong tuần hiện tại (T2..CN). Server cũ không trả ⇒ undefined (chip ẩn). */
  birthdayWeek?: { member: number; staff: number }
  /**
   * Số sinh nhật của CẢ 12 tháng (1 lượt GROUP BY ở server): `member[m - 1]` / `staff[m - 1]` là số tài khoản sinh tháng m.
   * `current` (1..12) là tháng hiện tại của MÁY CHỦ — cùng nguồn với bộ lọc nên nhãn luôn khớp số đếm.
   */
  birthdayMonths?: { current: number; member: number[]; staff: number[] }
}

/** `birthday=1` xin thêm `birthdayWeek` (server quét bảng hội viên một lượt nên chỉ xin khi cần). */
export const getUserCounts = () => apiGet<UserCounts>('/users/counts?birthday=1')

/**
 * GET /users/combo-card?userId= — chi tiết một thẻ combo (drawer tab "Thẻ combo").
 * Các trường ngày/giờ rỗng = chưa có (server đã đổi "0000-00-00" thành ""). `ownerId = 0` = thẻ bán tại quầy.
 */
export interface ComboCardDetail {
  userId: number
  userName: string
  /** usertb.Status = 1. */
  active: boolean
  expiryDate: string
  comboDetailId: number
  /** 0 = dòng không gắn combo nào (vd đặt trước máy online). */
  comboId: number
  comboName: string
  /** 1 = khung giờ cố định trong ngày, 2 = theo thời lượng (tính từ lần đăng nhập đầu). */
  comboType: number
  /** Giờ — chỉ có nghĩa khi comboType = 2. */
  duration: number
  numOfDay: number
  /** Bitmask ngày áp dụng: CN=1, T2=2, T3=4, T4=8, T5=16, T6=32, T7=64. */
  weekday: number
  price: number
  /** Tên các nhóm máy áp dụng, nối bằng '|'. */
  zone: string
  createDate: string
  createTime: string
  fromDate: string
  fromTime: string
  toDate: string
  toTime: string
  /** Lần đăng nhập đầu tiên; rỗng = thẻ chưa dùng. */
  firstLoginAt: string
  remainMinutes: number
  accept: number
  paymentId: number
  ownerId: number
  ownerName: string
  /** Món kèm theo catalog combo hiện tại (không phải ảnh chụp lúc bán). */
  donates: Array<{ name: string; unit: string; quantity: number }>
}

export const getComboCardDetail = (userId: number) =>
  apiGet<ComboCardDetail>(`/users/combo-card?userId=${userId}`)

/** Danh sách thẻ combo (tab "Thẻ Combo"). Tìm theo tiền tố tên đăng nhập, lọc ở server sau khi giải mã. */
export const getComboCards = (limit = 200, offset = 0, q?: string) => {
  let url = `/users?type=combo&limit=${limit}&offset=${offset}`
  if (q) url += `&q=${encodeURIComponent(q)}`
  return apiGet<ComboCardsResponse>(url)
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

// Đăng ký hội viên qua mobile (parity nút "Kết nối" ở chế độ thêm mới của CUserdetailDlg):
// mobile quét QR rồi đăng ký, server tự tạo tài khoản; FE chỉ lấy QR và poll kết quả.
export type MemberRegisterStart = {
  regId: string
  qr: string
  qrDownload: string
  expiresIn: number
  state: 'pending'
}

export type MemberRegisterState =
  | { state: 'pending' }
  | { state: 'done'; userId: number; username: string }
  | { state: 'failed'; reason?: string }
  | { state: 'expired' | 'cancelled' }

export const startMemberRegister = () =>
  apiPostForm<MemberRegisterStart>('/qrlogin', { m: 20 })

export const getMemberRegisterStatus = (regId: string) =>
  apiPostForm<MemberRegisterState>('/qrlogin', { m: 21, rid: regId })

export const cancelMemberRegister = (regId: string) =>
  apiPostForm<{ state: 'cancelled' | 'expired' }>('/qrlogin', { m: 22, rid: regId })

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

export type CreateUserPayload = Pick<
  UpdateUserDetailBody,
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
> & { password: string }

export const createUser = (payload: CreateUserPayload) =>
  apiPost<{ id: number }, CreateUserPayload>('/user', payload)

export type UserHistoryDateRange = { from?: string; to?: string }

function dateRangeQuery({ from, to }: UserHistoryDateRange) {
  return from && to ? `&from=${from}&to=${to}` : ''
}

export const getRechargeHistory = (userId: number, range: UserHistoryDateRange = {}) =>
  apiGet<UserRechargeHistory>(`/user/recharge-history?userId=${userId}${dateRangeQuery(range)}`)

export const getUserLogs = (userId: number, limit = 200, offset = 0, range: UserHistoryDateRange = {}) =>
  apiGet<UserUsageLog[]>(`/user/logs?userId=${userId}&limit=${limit}&offset=${offset}${dateRangeQuery(range)}`)

export type CleanCandidate = {
  userId: number
  /** Viết thường (khác `userName` của UserAccount). */
  username: string
  remainMoney: number
  /** Tên nhóm giá. */
  priceType: string
  /** YYYY-MM-DD */
  lastLoginDate: string
  debit: number
  totalDebit: number
}

export type CleanCandidatesPage = { items: CleanCandidate[]; total: number }

export const getCleanCandidates = (form: CleanForm, page: number) =>
  apiGet<CleanCandidatesPage>(`/users/clean-candidates?${buildCleanQuery(form, page)}`)

export type DeletePreview = {
  count: number
  hasStaff: boolean
  totalDebit: number
  deleted: false
}

export type DeleteResult = {
  deletedCount: number
  failed: number[]
  deleted: true
}

export const deleteBatch = (userIds: number[], confirm: boolean) =>
  apiDelete<DeletePreview | DeleteResult, { userIds: number[]; confirm: boolean }>(
    '/users/batch',
    { userIds, confirm },
  )

export async function deleteUser(userId: number) {
  const result = await deleteBatch([userId], true)
  const outcome = summarizeDeleteResult(1, result)
  if (outcome.tone !== 'success') throw new Error(outcome.message)
}

export type UserAdvPage = { total: number; items: UserAccount[] }

export const searchAdv = (filter: AdvFilter, limit: number, offset: number) =>
  apiGet<UserAdvPage>(`/users/search-adv?${buildAdvQuery(filter, limit, offset)}`)

export type ChangeGroupPreview = { count: number; changed: false }
export type ChangeGroupResult = { count: number; effected: number; changed: true }

export const changeGroupBulk = (
  filter: AdvFilter,
  groupId: number,
  confirm: boolean,
  expectedCount?: number,
) =>
  apiPost<ChangeGroupPreview | ChangeGroupResult, ChangeGroupBody>(
    '/users/change-group',
    buildChangeGroupBody(filter, groupId, confirm, expectedCount),
  )

export const usersApi = {
  generateUsers,
  
  // Ứng viên dọn dẹp (CCleanMemberDlg). Cần quyền 23.
  getCleanCandidates,

  // Xóa hội viên: `confirm` BẮT BUỘC tường minh. false = chỉ xem trước (server chưa xóa gì).
  deleteBatch,

  // Xóa MỘT tài khoản (đã có ConfirmAction ở UI) — ném lỗi nếu server không thật sự xóa.
  deleteUser,

  // Tìm kiếm nâng cao (CUserSearchAdvDlg) + đổi nhóm hàng loạt theo bộ lọc.
  searchAdv,
  changeGroupBulk,

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

  // Tặng thời gian miễn phí cho NHÂN VIÊN (phút). Hội viên tặng tiền ở giveFree.
  giveFreeTime: async (payload: { userId: number; minutes: number; idem: string; note?: string }) => {
    const { apiPost } = await import('./client');
    return apiPost<{ voucherId: number; remainTime: number }, typeof payload>('/user/give-free-time', payload);
  },

  // Chuyển tiền
  transfer: async (payload: { fromUserId: number; toUserId: number; transferMoney: number; idem: string }) => {
    const { apiPost } = await import('./client');
    return apiPost<any, typeof payload>('/user/transfer', payload);
  }
};
