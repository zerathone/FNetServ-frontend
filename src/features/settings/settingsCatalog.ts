// Danh mục mục con của trang Cài đặt — dữ liệu thuần, dùng chung cho:
//  - SettingsPage (thanh điều hướng bên trái + đọc ?section= / ?focus= từ URL);
//  - thanh tìm kiếm menu (layouts/navSearch) để tìm thẳng tới từng cài đặt con.
// Thêm một cài đặt mới vào trang => thêm 1 dòng vào SETTINGS_SEARCH_ENTRIES (anchor = id phần tử, bỏ tiền tố `setting-`).

export type SettingsSection =
  | 'general'
  | 'workstation'
  | 'wsmap'
  | 'security'

export const SETTINGS_SECTIONS: Array<{
  id: SettingsSection
  label: string
  description: string
}> = [
  { id: 'general', label: 'Thiết lập chung', description: 'Thông tin phòng máy, làm tròn tiền, mức nạp' },
  { id: 'workstation', label: 'Máy trạm', description: 'Đăng nhập lại, khóa và tự tắt' },
  { id: 'wsmap', label: 'Sơ đồ máy trạm', description: 'Vị trí máy, tường và đồ vật' },
  { id: 'security', label: 'Bảo mật và lưu trữ', description: 'Tài khoản ADMIN và lưu trữ nhật ký' },
]

export function parseSettingsSection(value: string | null): SettingsSection {
  // Link/bookmark cũ: 'cafe' + 'system' đã gộp thành 'general'; 'appearance' (Giao diện) đã bỏ vì theme tự đổi
  // được ở thanh trên. Mọi giá trị lạ rơi về mục đầu.
  return SETTINGS_SECTIONS.find((item) => item.id === value)?.id ?? 'general'
}

export function settingsPath(section: SettingsSection, anchor?: string) {
  const params = new URLSearchParams({ section })
  if (anchor) params.set('focus', anchor)
  return `/settings?${params.toString()}`
}

export type SettingsSearchEntry = {
  section: SettingsSection
  /** id phần tử trong trang (không gồm tiền tố `setting-`) để cuộn tới + nháy sáng. Bỏ trống = đầu mục. */
  anchor?: string
  label: string
  keywords: string[]
}

export const SETTINGS_SEARCH_ENTRIES: SettingsSearchEntry[] = [
  // Thông tin phòng máy
  { section: 'general', label: 'Thông tin phòng máy', keywords: ['tên phòng máy', 'địa chỉ', 'số điện thoại', 'email', 'website', 'fanpage', 'biên nhận', 'liên hệ'] },

  // Quy tắc hệ thống
  { section: 'general', anchor: 'rounding', label: 'Đơn vị làm tròn tiền', keywords: ['làm tròn', 'tròn tiền', 'bước giá', 'đơn vị tiền'] },
  { section: 'general', anchor: 'rounding-type', label: 'Kiểu làm tròn (trung bình / lên)', keywords: ['làm tròn lên', 'làm tròn trung bình', 'tròn tiền'] },
  { section: 'general', anchor: 'show-min', label: 'Mức nạp tối thiểu', keywords: ['nạp tối thiểu', 'số tiền nạp ít nhất', 'số dư tối thiểu', 'khấu trừ', 'hiển thị mức nạp'] },
  { section: 'general', anchor: 'refund-online', label: 'Hoàn tiền khi ngừng sử dụng', keywords: ['trả lại tiền', 'hoàn tiền', 'kết thúc phiên', 'ngừng chơi'] },
  { section: 'general', anchor: 'refund-offline', label: 'Hoàn tiền khi mất kết nối', keywords: ['trả lại tiền', 'hoàn tiền', 'mất điện', 'mất mạng', 'rớt mạng'] },
  { section: 'general', anchor: 'charge-warning', label: 'Tiếp tục tính tiền khi mất kết nối', keywords: ['tính tiền', 'cảnh báo mất kết nối', 'hội viên', 'mất điện', 'rớt mạng'] },

  // Máy trạm
  { section: 'workstation', anchor: 'sys-functions', label: 'Chức năng hệ thống trên máy trạm', keywords: ['chức năng hệ thống', 'task manager', 'registry', 'cmd', 'chặn chức năng', 'client'] },
  { section: 'workstation', anchor: 'sys-functions', label: 'Lịch tắt máy', keywords: ['hẹn giờ tắt', 'tắt máy theo lịch', 'shutdown', 'đóng cửa', 'tắt tất cả máy'] },
  { section: 'workstation', anchor: 'auto-relogin', label: 'Tự đăng nhập lại', keywords: ['khôi phục phiên', 'rớt mạng', 'mất kết nối', 'đăng nhập lại'] },
  { section: 'workstation', anchor: 'lock-screen', label: 'Khóa màn hình khi không dùng', keywords: ['màn hình khóa', 'máy chờ', 'trạng thái chờ', 'lock'] },
  { section: 'workstation', anchor: 'first-login-pwd', label: 'Đổi mật khẩu lần đầu đăng nhập', keywords: ['mật khẩu', 'khách mới', 'đăng nhập đầu tiên', 'bắt buộc đổi'] },
  { section: 'workstation', anchor: 'chat-history', label: 'Lịch sử giao tiếp các phiên trước', keywords: ['chat', 'tin nhắn', 'xóa lịch sử', 'lưu lịch sử', 'phiên mới'] },
  { section: 'workstation', anchor: 'auto-off', label: 'Tự tắt máy Sẵn sàng sau N phút', keywords: ['tự tắt máy', 'máy rảnh', 'máy sẵn sàng', 'tiết kiệm điện', 'shutdown'] },
  { section: 'workstation', anchor: 'auto-close-app', label: 'Tự đóng ứng dụng trên máy Sẵn sàng', keywords: ['đóng game', 'đóng ứng dụng', 'máy sẵn sàng', 'máy rảnh', 'kill app'] },
  { section: 'workstation', anchor: 'chat-channel', label: 'Kênh chat Messenger', keywords: ['messenger', 'facebook', 'zalo', 'chat khách', 'nhắn tin', 'kênh chat'] },

  // Sơ đồ máy trạm
  { section: 'wsmap', label: 'Sơ đồ máy trạm', keywords: ['bản đồ', 'vị trí máy', 'sắp xếp máy', 'tường', 'đồ vật', 'bố trí phòng'] },

  // Bảo mật
  { section: 'security', anchor: 'admin-account', label: 'Đổi tài khoản / mật khẩu ADMIN phần mềm', keywords: ['mật khẩu admin', 'đổi mật khẩu', 'tên đăng nhập', 'quản trị', 'tài khoản quản trị'] },
  { section: 'security', anchor: 'ws-admin-account', label: 'Đổi tài khoản ADMIN máy trạm', keywords: ['mật khẩu admin máy trạm', 'admin client', 'đổi mật khẩu', 'quyền admin trên máy trạm'] },
  { section: 'security', anchor: 'retention', label: 'Lưu trữ nhật ký (thời gian giữ)', keywords: ['thời gian giữ nhật ký', 'dọn dẹp', 'xóa nhật ký', 'giữ dữ liệu', 'số ngày', 'sao lưu', 'backup', 'log', 'tự động dọn', 'nhật ký hệ thống', 'nhật ký thẻ nạp', 'nhật ký website', 'nhật ký máy chủ', 'nhật ký sử dụng', 'nhật ký cảnh báo', 'bản ghi'] },
]
