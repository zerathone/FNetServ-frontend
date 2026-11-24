import { useAuthStore } from '../../store/auth'

// Mã quyền theo PUT /user (server gate từng field): 22 = sửa (umbrella), 221 tên đăng nhập, 222 mật khẩu,
// 223 thông tin cơ bản, 224 nhóm. Cùng quy ước với CustomerInspector (hội viên / nhân viên).
const R_MODIFY_USER = 22
const R_USERNAME = 221
const R_PASSWORD = 222
const R_BASIC = 223
const R_GROUP = 224

export type AccountPermissions = {
  canModifyBasic: boolean
  canModifyGroup: boolean
  canModifyPassword: boolean
  canModifyUsername: boolean
  /** Có ít nhất một quyền sửa tài khoản ⇒ mở được hộp thoại Tài khoản. */
  canEditAccount: boolean
}

export function useAccountPermissions(): AccountPermissions {
  const hasRight = useAuthStore((state) => state.hasRight)
  const canModifyBasic = hasRight(R_MODIFY_USER) || hasRight(R_BASIC)
  const canModifyGroup = hasRight(R_MODIFY_USER) || hasRight(R_GROUP)
  const canModifyPassword = hasRight(R_MODIFY_USER) || hasRight(R_PASSWORD)
  const canModifyUsername = hasRight(R_MODIFY_USER) || hasRight(R_USERNAME)
  return {
    canModifyBasic,
    canModifyGroup,
    canModifyPassword,
    canModifyUsername,
    canEditAccount: canModifyBasic || canModifyGroup || canModifyPassword || canModifyUsername,
  }
}
