import type { UpdateUserDetailBody, UserDetail } from '../../api/users'

// Mô hình hồ sơ dùng CHUNG cho tab "Hồ sơ" (CustomerInspector) và hộp thoại "Tài khoản" (CustomerAccountDialog):
// cả hai gửi cùng một PUT /user với ĐỦ field (server merge theo field có mặt), nên cùng dựng body từ một chỗ.

export type ProfileDraft = {
  username: string
  userGroupId: number
  fullName: string
  idNumber: string
  phone: string
  email: string
  address: string
  city: string
  district: string
  note: string
  birthday: string
  gender: 1 | 2 | 3
  active: boolean
  expiryDate: string
  isVat: boolean
  usageTimeId: number
}

export function toDraft(detail: UserDetail): ProfileDraft {
  return {
    username: detail.username,
    userGroupId: detail.userGroupId,
    fullName: detail.fullName,
    idNumber: detail.idNumber ?? '',
    phone: detail.phone ?? '',
    email: detail.email ?? '',
    address: detail.address ?? '',
    city: detail.city ?? '',
    district: detail.district ?? '',
    note: detail.note,
    birthday: detail.birthday === '0000-00-00' ? '' : detail.birthday,
    gender: detail.gender,
    active: detail.active,
    expiryDate: detail.expiryDate === '0000-00-00' ? '' : detail.expiryDate,
    isVat: detail.isVat,
    usageTimeId: detail.usageTimeId,
  }
}

export function toUpdateBody(
  detail: UserDetail,
  draft: ProfileDraft,
  confirmMobileUnpair = false,
): UpdateUserDetailBody {
  return {
    id: detail.id,
    ...draft,
    fullName: draft.fullName.trim(),
    idNumber: draft.idNumber.trim(),
    phone: draft.phone.trim(),
    email: draft.email.trim(),
    address: draft.address.trim(),
    city: draft.city.trim(),
    district: draft.district.trim(),
    note: draft.note.trim(),
    birthday: draft.birthday || '0000-00-00',
    expiryDate: draft.expiryDate || '0000-00-00',
    expectedVersion: detail.version,
    confirmMobileUnpair,
  }
}

export const USERNAME_MAX_LENGTH = 50

/**
 * Kiểm tên đăng nhập MỚI theo đúng luật server (PUT /user): không rỗng, ≤ 50, không chứa dấu nháy đơn / gạch chéo ngược /
 * ký tự điều khiển, không chứa "(", không bắt đầu bằng dấu nháy kép hoặc "NULL"/"null" (tên được ghi thẳng vào SQL nên
 * server chặn các dạng trông như biểu thức), và không được là ADMIN. Trả `null` nếu hợp lệ. Trùng tên người khác thì
 * chỉ server biết ("username already exists", xem describeAccountUpdateError).
 */
export function validateUsername(value: string): string | null {
  const username = value.trim()
  if (!username) return 'Nhập tên đăng nhập.'
  if (username.length > USERNAME_MAX_LENGTH) return `Tối đa ${USERNAME_MAX_LENGTH} ký tự.`
  // eslint-disable-next-line no-control-regex
  if (/['\\\u0000-\u001f]/.test(username)) return 'Không chứa dấu nháy đơn, gạch chéo ngược hoặc ký tự điều khiển.'
  if (username.includes('(') || username.startsWith('"') || /^(NULL|null)/.test(username)) {
    return 'Không chứa dấu "(", không bắt đầu bằng dấu nháy kép hoặc "NULL".'
  }
  if (username.toUpperCase() === 'ADMIN') return 'Không được dùng tên ADMIN.'
  return null
}

export const PASSWORD_MAX_LENGTH = 50

/**
 * Kiểm mật khẩu mới ở hộp thoại Tài khoản. Để trống cả hai ô = KHÔNG đổi mật khẩu (trả `null`).
 * Máy chủ chỉ cần chuỗi không rỗng (băm mysql_native_password phía server); web chặn thêm: toàn khoảng trắng,
 * quá dài, và hai ô không khớp (gõ nhầm một ký tự là hội viên không đăng nhập được nữa).
 */
export function validateNewPassword(password: string, confirm: string): string | null {
  if (!password && !confirm) return null
  if (!password.trim()) return 'Nhập mật khẩu mới.'
  if (password.length > PASSWORD_MAX_LENGTH) return `Mật khẩu tối đa ${PASSWORD_MAX_LENGTH} ký tự.`
  if (password !== confirm) return 'Mật khẩu nhập lại không khớp.'
  return null
}

/** Máy chủ trả lỗi tiếng Anh ngắn gọn ⇒ dịch những lỗi người dùng có thể gặp khi lưu tài khoản. */
export function describeAccountUpdateError(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  if (message.includes('USER_VERSION_CONFLICT')) {
    return 'Hồ sơ vừa được người khác thay đổi. Hãy mở lại hộp thoại để lấy dữ liệu mới.'
  }
  if (message.includes('profile updated but password change failed')) {
    return 'Đã lưu thông tin nhưng đổi mật khẩu thất bại. Hãy thử đặt lại mật khẩu.'
  }
  if (message.includes('username not allowed')) return 'Tên đăng nhập này không được phép dùng.'
  if (message.includes('username already exists')) return 'Tên đăng nhập đã có người dùng. Hãy chọn tên khác.'
  if (message.includes('missing/invalid username')) return 'Tên đăng nhập không hợp lệ.'
  return message || 'Không lưu được tài khoản.'
}
