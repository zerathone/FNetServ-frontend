// Chỉ mục tìm kiếm menu — dữ liệu + hàm thuần (không React) để dễ test.
// Nguồn: mọi mục menu mà user đang thấy (mọi vai trò) + các cài đặt con trong trang Cài đặt.
import {
  SETTINGS_SEARCH_ENTRIES,
  SETTINGS_SECTIONS,
  settingsPath,
} from '../features/settings/settingsCatalog'

/** Bỏ dấu tiếng Việt + hạ chữ thường để gõ "lam tron" vẫn ra "Làm tròn". */
export function normalizeSearchText(text: string) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** Từ khoá/đồng nghĩa theo đường dẫn menu — thêm từ người dùng hay gõ nhưng không có trên nhãn. */
export const NAV_KEYWORDS: Record<string, string[]> = {
  '/workstations': ['máy trạm', 'pc', 'client', 'trạng thái máy', 'mở máy', 'tắt máy', 'khóa máy', 'chuyển máy', 'sơ đồ'],
  '/health_monitor': ['giám sát', 'sức khỏe máy', 'phần cứng', 'cpu', 'ram', 'nhiệt độ', 'cảnh báo máy', 'hoạt động máy'],
  '/users': ['khách hàng', 'hội viên', 'nạp tiền', 'số dư', 'tài khoản chơi', 'tìm khách'],
  '/orders': ['order', 'gọi món', 'đồ ăn', 'nước uống', 'dịch vụ chờ', 'phục vụ'],
  '/online-booking': ['đặt chỗ', 'đặt máy', 'booking', 'duyệt đặt máy', 'hủy đặt máy', 'đặt trước'],
  '/combo_sale': ['bán combo', 'gói giờ', 'gói chơi', 'bán gói'],
  '/card-sale': ['bán thẻ', 'thẻ cào', 'mã thẻ', 'nạp thẻ'],
  '/logs/voucher': ['giao dịch', 'phiếu thu', 'phiếu chi', 'lịch sử nạp', 'lịch sử tiền', 'voucher'],
  '/logs/system': ['log', 'nhật ký', 'lịch sử thao tác', 'hệ thống'],
  '/users/legacy': ['hội viên', 'khách hàng', 'nạp tiền', 'số dư', 'mật khẩu hội viên', 'khóa tài khoản', 'thông tin khách'],
  '/cards': ['thẻ cào', 'mã thẻ', 'phát hành thẻ', 'seri', 'thẻ nạp'],
  '/anonyms': ['vãng lai', 'khách lẻ', 'khách vãng lai', 'anonym'],
  '/services': ['dịch vụ', 'đồ ăn', 'nước uống', 'mặt hàng', 'sản phẩm', 'giá bán', 'thực đơn', 'menu'],
  '/combos': ['combo', 'gói giờ', 'gói chơi', 'giờ chơi', 'vé'],
  '/user-groups': ['nhóm hội viên', 'nhóm khách', 'phân nhóm', 'nhóm tài khoản'],
  '/machine-groups': ['nhóm máy', 'khu vực', 'phân khu', 'vip', 'phòng máy'],
  '/online-booking/settings': ['thiết lập đặt máy online', 'thiết lập đặt máy', 'đặt chỗ','đặt trước', 'booking', 'cấu hình đặt máy', 'thời gian đặt'],
  '/promotions': ['khuyến mãi', 'khuyến mại', 'tặng tiền', 'thưởng nạp', 'ưu đãi', 'giảm giá', 'chiết khấu', 'banner'],
  '/apps': ['ứng dụng', 'game', 'phần mềm', 'chương trình', 'app', 'danh sách game'],
  '/webblock': ['chặn web', 'khống chế', 'chặn ứng dụng', 'chặn game', 'cấm web', 'website', 'blacklist'],
  '/logs/server': ['log máy chủ', 'server', 'lỗi máy chủ', 'nhật ký server'],
  '/logs/webhistory': ['lịch sử web', 'duyệt web', 'website đã truy cập', 'trình duyệt', 'url'],
  '/settings': ['cấu hình', 'thiết lập', 'tùy chỉnh', 'setting'],
  '/notification-settings': ['chuông', 'âm báo', 'âm thanh', 'thông báo nổi', 'popup', 'báo động', 'nhắc'],
  '/printers': ['in hóa đơn', 'in bill', 'in phiếu', 'máy in nhiệt', 'k80', 'esc/pos', 'printer', 'cổng 9100'],
  '/staff-rights': ['phân quyền', 'quyền hạn', 'nhân viên', 'thu ngân', 'tài khoản nhân viên', 'cấp quyền', 'rights'],
  '/ui-catalog': ['component', 'thành phần giao diện', 'storybook'],
}

export type NavSearchSource = {
  workspaceId: string
  workspaceLabel: string
  to: string
  label: string
  /** Nhãn nhóm hiển thị trong sidebar (nếu có). */
  groupLabel?: string
  /** Mô tả thêm (vd mô tả báo cáo) — chỉ để khớp từ khoá, không hiển thị. */
  description?: string
}

export type NavSearchEntry = {
  key: string
  to: string
  label: string
  /** Đường dẫn chữ: Vai trò › Nhóm › Mục. */
  trail: string
  workspaceId: string
  kind: 'page' | 'setting'
  labelNorm: string
  hayNorm: string
  /** Từ khoá gốc (có dấu) để hiện gợi ý "khớp: …" khi nhãn không chứa từ gõ. */
  keywords: string[]
}

function makeTrail(parts: Array<string | undefined>) {
  return parts.filter(Boolean).join(' › ')
}

export function buildNavSearchEntries(
  sources: NavSearchSource[],
  currentWorkspaceId: string,
): NavSearchEntry[] {
  // Gộp mục trùng đường dẫn giữa các vai trò (vd Máy trạm có ở Thu ngân lẫn Quản lý): hiện 1 dòng,
  // ưu tiên bản của vai trò đang mở; nhãn của bản kia vẫn được dùng để khớp.
  const byPath = new Map<string, NavSearchSource[]>()
  for (const source of sources) {
    const list = byPath.get(source.to)
    if (list) list.push(source)
    else byPath.set(source.to, [source])
  }

  const entries: NavSearchEntry[] = []
  for (const [to, group] of byPath) {
    const primary = group.find((item) => item.workspaceId === currentWorkspaceId) ?? group[0]
    const keywords = [
      ...(NAV_KEYWORDS[to] ?? []),
      ...group.filter((item) => item !== primary).map((item) => item.label),
      ...group.map((item) => item.description ?? '').filter(Boolean),
    ]
    const trail = makeTrail([primary.workspaceLabel, primary.groupLabel])
    entries.push({
      key: `page:${to}`,
      to,
      label: primary.label,
      trail,
      workspaceId: primary.workspaceId,
      kind: 'page',
      labelNorm: normalizeSearchText(primary.label),
      hayNorm: normalizeSearchText([primary.label, trail, ...keywords].join(' | ')),
      keywords,
    })
  }

  // Cài đặt con: chỉ có khi user thấy mục /settings.
  const settingsPage = entries.find((entry) => entry.to === '/settings')
  if (settingsPage) {
    for (const item of SETTINGS_SEARCH_ENTRIES) {
      const sectionLabel = SETTINGS_SECTIONS.find((section) => section.id === item.section)?.label
      const trail = makeTrail([settingsPage.trail, settingsPage.label, sectionLabel])
      entries.push({
        key: `setting:${item.section}:${item.anchor ?? ''}:${item.label}`,
        to: settingsPath(item.section, item.anchor),
        label: item.label,
        trail,
        workspaceId: settingsPage.workspaceId,
        kind: 'setting',
        labelNorm: normalizeSearchText(item.label),
        hayNorm: normalizeSearchText([item.label, trail, ...item.keywords].join(' | ')),
        keywords: item.keywords,
      })
    }
  }
  return entries
}

export type NavSearchResult = {
  entry: NavSearchEntry
  /** Từ khoá khớp (khi nhãn không chứa từ gõ) để người dùng hiểu vì sao mục này hiện ra. */
  hint?: string
}

/** Mọi từ (cách nhau bởi khoảng trắng) đều phải xuất hiện; xếp hạng: nhãn bắt đầu bằng > nhãn chứa > từ khoá. */
export function searchNavEntries(
  entries: NavSearchEntry[],
  query: string,
  limit = 30,
): NavSearchResult[] {
  const tokens = normalizeSearchText(query).split(' ').filter(Boolean)
  if (tokens.length === 0) return []

  const scored: Array<{ entry: NavSearchEntry; score: number; order: number }> = []
  entries.forEach((entry, order) => {
    if (!tokens.every((token) => entry.hayNorm.includes(token))) return
    let score = 0
    for (const token of tokens) {
      if (entry.labelNorm.startsWith(token)) score += 0
      else if (entry.labelNorm.includes(` ${token}`)) score += 1
      else if (entry.labelNorm.includes(token)) score += 2
      else score += 4
    }
    // Trang đứng trước cài đặt con khi cùng điểm (trang là đích "to" hơn).
    if (entry.kind === 'setting') score += 0.5
    scored.push({ entry, score, order })
  })

  scored.sort((a, b) => a.score - b.score || a.order - b.order)
  return scored.slice(0, limit).map(({ entry }) => {
    const labelHasAll = tokens.every((token) => entry.labelNorm.includes(token))
    const hint = labelHasAll
      ? undefined
      : entry.keywords.find((keyword) => {
          const norm = normalizeSearchText(keyword)
          return tokens.some((token) => norm.includes(token))
        })
    return { entry, hint }
  })
}
