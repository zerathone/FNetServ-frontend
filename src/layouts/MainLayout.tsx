import { useMutation, useQuery } from '@tanstack/react-query'
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { logoutRequest } from '../api/auth'
import { getServerInfo } from '../api/system'
import { Button, IconButton, StatusBadge } from '../design-system/components'
import { useTheme } from '../design-system/theme/themeContext'
import type { ThemeId } from '../design-system/theme/themeRegistry'
import { useAuthStore } from '../store/auth'
import { useWsStatusStore } from '../store/wsStatus'
import { describeWsCloseCode } from '../lib/wsErrorText'
import { NotificationCenter } from '../features/notifications/NotificationCenter'
import { LicenseButton } from '../features/license/LicenseButton'
import { useLicenseInfo } from '../features/license/useLicenseInfo'
import { PaymentOnlineButton } from '../features/payment-online/PaymentOnlineButton'
import { PromoBannerCluster } from '../features/promo-banner/PromoBannerCluster'
import {
  Desktop, Users, CallBell, ArrowsLeftRight, TerminalWindow,
  Detective, UsersThree,
  DesktopTower, SealPercent, AppWindow, ShieldWarning, ChartBar,
  ChartLineUp, FileText, Globe, Gear, Printer, ShieldCheck,
  Palette, SignOut, List, X, CaretRight, CaretLeft,
  Sun, MoonStars, Monitor, Flame, CaretDown, CashRegister, Ticket,
  CreditCard, Storefront,
  CurrencyCircleDollar, Coins, Clock, Gauge, HandCoins, Wallet, ChartPie, Timer, Notebook
} from '@phosphor-icons/react'
import { REPORT_PAGES, reportPath, reportViewCodes } from '../features/reports/reportCatalog'

const THEME_ICONS: Record<ThemeId, ReactNode> = {
  classic: <Monitor size={20} weight="duotone" />,
  light: <Sun size={20} weight="duotone" />,
  dark: <MoonStars size={20} weight="duotone" />,
  warm: <Flame size={20} weight="duotone" />,
}

type WorkspaceId = 'pos' | 'management' | 'analysis'

type NavigationItem = {
  to: string
  label: string
  shortLabel: string
  icon: ReactNode
  adminOnly?: boolean
  devOnly?: boolean
  /** Hiện khi admin HOẶC có BẤT KỲ mã quyền nào trong danh sách (mã xem + mã xem tất cả). */
  rightAny?: number[]
  /** Nhóm hiển thị trong sidebar (chỉ dùng cho workspace Phân tích). */
  group?: string
}

type Workspace = {
  id: WorkspaceId
  label: string
  shortLabel: string
  icon: ReactNode
  landing: string
  adminOnly?: boolean
  /** Landing = mục đầu tiên user thấy được (nhóm có mục ẩn theo quyền, vd Phân tích). */
  dynamicLanding?: boolean
  items: NavigationItem[]
}

// Icon cho từng trang báo cáo (catalog là dữ liệu thuần, không chứa ReactNode).
const REPORT_ICONS: Record<string, ReactNode> = {
  'revenue-stats': <CurrencyCircleDollar size={24} weight="duotone" />,
  'service-revenue': <Storefront size={24} weight="duotone" />,
  'card-revenue': <CreditCard size={24} weight="duotone" />,
  'member-recharge': <Wallet size={24} weight="duotone" />,
  'machine-revenue': <Desktop size={24} weight="duotone" />,
  'free-time': <Clock size={24} weight="duotone" />,
  'free-money': <Coins size={24} weight="duotone" />,
  'member-debt': <HandCoins size={24} weight="duotone" />,
  'member-usage': <Timer size={24} weight="duotone" />,
  'income-summary': <ChartBar size={24} weight="duotone" />,
  'income-by-staff': <Users size={24} weight="duotone" />,
  'shift-report': <Notebook size={24} weight="duotone" />,
}
const DASHBOARD_ICON = <Gauge size={24} weight="duotone" />
const DEFAULT_REPORT_ICON = <ChartPie size={24} weight="duotone" />

// Toàn bộ trang báo cáo sau gộp (task web-report-params): thứ tự = thứ tự REPORT_PAGES.
const analysisItems: NavigationItem[] = REPORT_PAGES.map((def) => ({
  to: reportPath(def),
  label: def.title,
  shortLabel: def.shortLabel,
  icon: REPORT_ICONS[def.id] ?? (def.dashboard ? DASHBOARD_ICON : DEFAULT_REPORT_ICON),
  adminOnly: def.dashboard ? true : undefined,
  rightAny: def.dashboard ? undefined : reportViewCodes(def),
  group: def.group,
}))

const GROUP_LABELS: Record<string, string> = {
  new: 'Báo cáo V2',
  legacy: 'Thống kê',
  dashboard: 'Dashboard',
}

const GROUP_BADGES: Record<string, string> = {
  new: 'V2',
  legacy: 'Cũ',
  dashboard: 'DB',
}

function isItemVisible(
  item: NavigationItem,
  isAdmin: boolean,
  hasRight: (code: number) => boolean,
) {
  if (item.adminOnly && !isAdmin) return false
  if (item.devOnly && !import.meta.env.DEV) return false
  if (item.rightAny && !isAdmin && !item.rightAny.some(hasRight)) return false
  return true
}

const workspaces: readonly Workspace[] = [
  {
    id: 'pos',
    label: 'Thu ngân',
    shortLabel: 'Thu ngân',
    icon: <CashRegister size={20} weight="duotone" />,
    landing: '/workstations',
    items: [
      { to: '/workstations', label: 'Máy trạm', shortLabel: 'Máy', icon: <Desktop size={24} weight="duotone" /> },
      {
        to: '/users',
        label: 'Tài khoản',
        shortLabel: 'Khách',
        icon: <Users size={24} weight="duotone" />,
      },
      { to: '/orders', label: 'Đơn dịch vụ', shortLabel: 'Đơn', icon: <CallBell size={24} weight="duotone" /> },
      { to: '/payments', label: 'Bán COMBO', shortLabel: 'COMBO', icon: <Ticket size={24} weight="duotone" /> },
      { to: '/card-sale', label: 'Bán thẻ nạp', shortLabel: 'Thẻ nạp', icon: <CreditCard size={24} weight="duotone" /> },
      { to: '/logs/voucher', label: 'Giao dịch', shortLabel: 'GD', icon: <ArrowsLeftRight size={24} weight="duotone" /> },
      { to: '/logs/system', label: 'Nhật ký hệ thống', shortLabel: 'Log', icon: <TerminalWindow size={24} weight="duotone" /> },
    ],
  },
  {
    id: 'management',
    label: 'Quản lý',
    shortLabel: 'QL',
    icon: <UsersThree size={20} weight="duotone" />,
    landing: '/users',
    adminOnly: true,
    items: [
      { to: '/users', label: 'Tài khoản', shortLabel: 'HV', icon: <Users size={24} weight="duotone" /> },
      { to: '/cards', label: 'Thẻ nạp', shortLabel: 'Thẻ', icon: <CreditCard size={24} weight="duotone" /> },
      { to: '/anonyms', label: 'Khách vãng lai', shortLabel: 'Khách', icon: <Detective size={24} weight="duotone" /> },
      { to: '/services', label: 'Dịch vụ', shortLabel: 'DV', icon: <Storefront size={24} weight="duotone" /> },
      { to: '/combos', label: 'COMBO', shortLabel: 'CB', icon: <Ticket size={24} weight="duotone" /> },
      { to: '/user-groups', label: 'Nhóm người dùng', shortLabel: 'Nhóm', icon: <UsersThree size={24} weight="duotone" /> },
      { to: '/machine-groups', label: 'Nhóm máy', shortLabel: 'Nhóm', icon: <DesktopTower size={24} weight="duotone" /> },
      { to: '/promotions', label: 'Khuyến mãi', shortLabel: 'KM', icon: <SealPercent size={24} weight="duotone" /> },
      { to: '/apps', label: 'Ứng dụng', shortLabel: 'App', icon: <AppWindow size={24} weight="duotone" /> },
      { to: '/webblock', label: 'Khống chế Web/App', shortLabel: 'Web', icon: <ShieldWarning size={24} weight="duotone" /> },
      { to: '/workstations', label: 'Máy trạm', shortLabel: 'Máy', icon: <Desktop size={24} weight="duotone" /> },
      { to: '/logs/voucher', label: 'Nhật ký giao dịch', shortLabel: 'GD', icon: <FileText size={24} weight="duotone" /> },
      { to: '/logs/system', label: 'Nhật ký hệ thống', shortLabel: 'HT', icon: <TerminalWindow size={24} weight="duotone" /> },
      { to: '/logs/server', label: 'Nhật ký máy chủ', shortLabel: 'SV', icon: <TerminalWindow size={24} weight="duotone" /> },
      { to: '/logs/webhistory', label: 'Nhật ký duyệt web', shortLabel: 'Web', icon: <Globe size={24} weight="duotone" /> },
      { to: '/settings', label: 'Cài đặt', shortLabel: 'Đặt', icon: <Gear size={24} weight="duotone" /> },
      { to: '/printers', label: 'Máy in', shortLabel: 'In', icon: <Printer size={24} weight="duotone" /> },
      { to: '/staff-rights', label: 'Phân quyền nhân viên', shortLabel: 'Quyền', icon: <ShieldCheck size={24} weight="duotone" /> },
      {
        to: '/ui-catalog',
        label: 'Danh mục giao diện',
        shortLabel: 'UI',
        icon: <Palette size={24} weight="duotone" />,
        devOnly: true,
      },
    ],
  },
  {
    id: 'analysis',
    label: 'Phân tích',
    shortLabel: 'PT',
    icon: <ChartLineUp size={20} weight="duotone" />,
    landing: reportPath(REPORT_PAGES[0]),
    // Không còn adminOnly: nhân viên có quyền báo cáo phải thấy nhóm này. Ẩn theo quyền từng mục
    // (rightAny) + ẩn cả nhóm khi không có mục nào hiển thị được. 2 mục cũ `Doanh thu` (/reports) và
    // `Trung tâm báo cáo` (/dynamic-reports) đã bỏ khỏi menu (route + file vẫn giữ).
    dynamicLanding: true,
    items: analysisItems,
  },
]

function getLanding(
  workspace: Workspace,
  isAdmin: boolean,
  hasRight: (code: number) => boolean,
) {
  if (!workspace.dynamicLanding) return workspace.landing
  return workspace.items.find((item) => isItemVisible(item, isAdmin, hasRight))?.to ?? workspace.landing
}

function getWorkspace(id: WorkspaceId) {
  return workspaces.find((workspace) => workspace.id === id) ?? workspaces[0]
}

export function MainLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const logout = useAuthStore((state) => state.logout)
  const staffName = useAuthStore((state) => state.staffName)
  const isAdmin = useAuthStore((state) => state.isAdmin)
  const wsConnected = useWsStatusStore((state) => state.connected)
  const wsCloseInfo = useWsStatusStore((state) => state.closeInfo)
  const wsCloseText = wsConnected ? null : describeWsCloseCode(wsCloseInfo)
  const { theme, setTheme, themes } = useTheme()
  const [workspaceId, setWorkspaceId] = useState<WorkspaceId>('pos')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [themeMenuOpen, setThemeMenuOpen] = useState(false)
  const themeMenuRef = useRef<HTMLDivElement>(null)
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false)
  const workspaceMenuRef = useRef<HTMLDivElement>(null)
  const [clockNow, setClockNow] = useState(() => new Date())
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set())

  const toggleGroup = (group: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }

  // rights: subscribe để menu tự cập nhật khi quyền session đổi (hasRight đọc store, không tự re-render).
  const hasRight = useAuthStore((state) => state.hasRight)
  const rights = useAuthStore((state) => state.rights)

  const availableWorkspaces = useMemo(
    () =>
      workspaces.filter(
        (item) =>
          (!item.adminOnly || isAdmin) &&
          item.items.some((navItem) => isItemVisible(navItem, isAdmin, hasRight)),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `rights` là phụ thuộc thật của hasRight
    [isAdmin, hasRight, rights],
  )
  const workspace = getWorkspace(workspaceId)
  const navigationItems = workspace.items.filter((item) => isItemVisible(item, isAdmin, hasRight))

  useEffect(() => {
    // Workspace hiện tại không còn khả dụng (đăng xuất/đổi quyền): về Thu ngân.
    if (!availableWorkspaces.some((item) => item.id === workspaceId)) setWorkspaceId('pos')
  }, [availableWorkspaces, workspaceId])

  useEffect(() => {
    setMobileNavOpen(false)
  }, [location.pathname])

  useEffect(() => {
    const timer = setInterval(() => setClockNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const sidebarClock = useMemo(
    () => ({
      date: new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(clockNow),
      time: new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(clockNow),
    }),
    [clockNow],
  )

  useEffect(() => {
    if (!themeMenuOpen) return

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!themeMenuRef.current?.contains(event.target as Node)) setThemeMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setThemeMenuOpen(false)
    }

    document.addEventListener('mousedown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [themeMenuOpen])

  useEffect(() => {
    if (!workspaceMenuOpen) return

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!workspaceMenuRef.current?.contains(event.target as Node)) setWorkspaceMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setWorkspaceMenuOpen(false)
    }

    document.addEventListener('mousedown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [workspaceMenuOpen])

  const serverInfoQuery = useQuery({
    queryKey: ['server-info'],
    queryFn: getServerInfo,
    staleTime: Infinity,
    retry: false,
  })

  // Hook chung với LicenseButton (useLicenseInfo) -> cùng queryKey, cùng cache, không tốn thêm request.
  const licenseInfoQuery = useLicenseInfo()
  const shopName = licenseInfoQuery.data?.shopName || ''

  const logoutMutation = useMutation({
    mutationFn: logoutRequest,
    onSettled: () => {
      logout()
      navigate('/login', { replace: true })
    },
  })

  const changeWorkspace = (nextId: WorkspaceId) => {
    const nextWorkspace = getWorkspace(nextId)
    if (!availableWorkspaces.some((item) => item.id === nextId)) return
    setWorkspaceId(nextId)
    setWorkspaceMenuOpen(false)
    navigate(getLanding(nextWorkspace, isAdmin, hasRight))
  }

  return (
    <div
      className={`app-shell ${sidebarCollapsed ? 'app-shell--collapsed' : ''} ${
        mobileNavOpen ? 'app-shell--nav-open' : ''
      }`}
    >
      <a className="skip-link" href="#main-content">
        Bỏ qua điều hướng
      </a>

      <header className="app-topbar">
        <div className="app-topbar__start">
          <IconButton
            className="app-mobile-menu"
            label={mobileNavOpen ? 'Đóng điều hướng' : 'Mở điều hướng'}
            icon={mobileNavOpen ? <X size={24} /> : <List size={24} />}
            onClick={() => setMobileNavOpen((value) => !value)}
          />
          <div className="brand-mark-group">
            <NavLink className="brand-mark" to={workspace.landing} aria-label="FNet - về trang chính">
              <img
                className="brand-mark__full brand-mark__full--color"
                src="/brand/logo_fnet-web_wordmark_20260813_color.png"
                alt="FNet"
              />
              <img
                className="brand-mark__full brand-mark__full--reversed"
                src="/brand/logo_fnet-web_wordmark_20260813_reversed.png"
                alt="FNet"
              />
              <img className="brand-mark__icon" src="/brand/logo_fnet-web_mark_20260813_square.png" alt="FNet" />
            </NavLink>
            {serverInfoQuery.data?.ver ? (
              <div className="brand-mark-group__meta">
                <span className="brand-mark-group__version">v{serverInfoQuery.data.ver}</span>
                {serverInfoQuery.data.rd ? (
                  <span className="brand-mark-group__release">{serverInfoQuery.data.rd}</span>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="staff-summary">
            <span>{isAdmin ? 'Người dùng' : 'Nhân viên'}</span>
            <strong>{staffName || 'Phiên cục bộ'}</strong>
          </div>
          <LicenseButton />
          <PaymentOnlineButton />
          <PromoBannerCluster />
        </div>

        <div className="app-topbar__end">
          <span className="app-topbar__ws-status">
            <span className="app-topbar__ws-status-label">Kết nối</span>
            <StatusBadge tone={wsConnected ? 'success' : 'warning'}>
              {wsConnected ? 'Trực tuyến' : 'Mất realtime'}
            </StatusBadge>
            {wsCloseText ? <span className="app-topbar__ws-status-error">{wsCloseText}</span> : null}
          </span>
          <NotificationCenter />
          <div className="theme-switcher" ref={themeMenuRef}>
            <button
              type="button"
              className="theme-switcher__trigger"
              aria-label="Giao diện"
              aria-haspopup="menu"
              aria-expanded={themeMenuOpen}
              onClick={() => setThemeMenuOpen((value) => !value)}
            >
              <span aria-hidden="true">{THEME_ICONS[theme]}</span>
            </button>
            {themeMenuOpen ? (
              <div className="theme-switcher__menu" role="menu" aria-label="Chọn giao diện">
                {themes.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={item.id === theme}
                    className={
                      item.id === theme
                        ? 'theme-switcher__option theme-switcher__option--active'
                        : 'theme-switcher__option'
                    }
                    onClick={() => {
                      setTheme(item.id)
                      setThemeMenuOpen(false)
                    }}
                  >
                    <span aria-hidden="true">{THEME_ICONS[item.id]}</span>
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <aside className="app-sidebar" aria-label={`Điều hướng ${workspace.label}`}>
        <div className="app-sidebar__header">
          <div className="app-sidebar__header-row">
            <div className="app-sidebar__clock">
              <span className="app-sidebar__clock-date">{sidebarClock.date}</span>
              <span className="app-sidebar__clock-time">{sidebarClock.time}</span>
            </div>
            {shopName ? (
              <span className="app-sidebar__shop-name" title={shopName}>
                {shopName}
              </span>
            ) : null}
            <IconButton
              className="app-sidebar__collapse"
              label={sidebarCollapsed ? 'Mở rộng thanh điều hướng' : 'Thu gọn thanh điều hướng'}
              icon={sidebarCollapsed ? <CaretRight size={20} /> : <CaretLeft size={20} />}
              onClick={() => setSidebarCollapsed((value) => !value)}
            />
          </div>
          <div className="workspace-switcher" ref={workspaceMenuRef}>
            <span className="workspace-switcher__role-label">Vai trò</span>
            <div className="workspace-switcher__control">
              <button
                type="button"
                className="workspace-switcher__trigger"
                title={sidebarCollapsed ? workspace.label : undefined}
                aria-haspopup="listbox"
                aria-expanded={workspaceMenuOpen}
                onClick={() => setWorkspaceMenuOpen((value) => !value)}
              >
                <span className="workspace-switcher__label">{workspace.label}</span>
                <span className="workspace-switcher__icon" aria-hidden="true">
                  {workspace.icon}
                </span>
                <CaretDown className="workspace-switcher__caret" size={14} weight="bold" aria-hidden="true" />
              </button>
              {workspaceMenuOpen ? (
                <div className="workspace-switcher__menu" role="listbox" aria-label="Không gian làm việc">
                  {availableWorkspaces.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      role="option"
                      aria-selected={item.id === workspaceId}
                      className={
                        item.id === workspaceId
                          ? 'workspace-switcher__option workspace-switcher__option--active'
                          : 'workspace-switcher__option'
                      }
                      onClick={() => changeWorkspace(item.id)}
                    >
                      <span className="workspace-switcher__option-label">{item.label}</span>
                      <span className="workspace-switcher__icon" aria-hidden="true">
                        {item.icon}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <nav className="workspace-nav">
          {navigationItems.map((item, index) => {
            const prevItem = index > 0 ? navigationItems[index - 1] : null
            const showGroupHeader = item.group != null && item.group !== prevItem?.group
            const isGroupCollapsed = item.group != null && collapsedGroups.has(item.group)
            return (
              <Fragment key={`${workspace.id}-${item.to}`}>
                {showGroupHeader && (
                  <button
                    type="button"
                    className={
                      isGroupCollapsed
                        ? 'workspace-nav__group-header workspace-nav__group-header--collapsed'
                        : 'workspace-nav__group-header'
                    }
                    onClick={() => item.group && toggleGroup(item.group)}
                    title={sidebarCollapsed ? (GROUP_LABELS[item.group!] ?? item.group) : undefined}
                    aria-expanded={!isGroupCollapsed}
                  >
                    <span className="workspace-nav__group-label">{GROUP_LABELS[item.group!] ?? item.group}</span>
                    <span className="workspace-nav__group-badge">{GROUP_BADGES[item.group!] ?? ''}</span>
                    <span className="workspace-nav__group-caret" aria-hidden="true">
                      <CaretRight size={10} weight="bold" />
                    </span>
                  </button>
                )}
                {!isGroupCollapsed && (
                  <NavLink
                    to={item.to}
                    title={sidebarCollapsed ? item.label : undefined}
                    className={({ isActive }) =>
                      isActive ? 'workspace-nav__link workspace-nav__link--active' : 'workspace-nav__link'
                    }
                  >
                    <span className="workspace-nav__icon" aria-hidden="true">
                      {item.icon}
                    </span>
                    <span className="workspace-nav__label">{item.label}</span>
                    <span className="workspace-nav__short">{item.shortLabel}</span>
                  </NavLink>
                )}
              </Fragment>
            )
          })}
        </nav>

        <div className="app-sidebar__footer">
          <Button
            variant="ghost"
            block
            loading={logoutMutation.isPending}
            onClick={() => logoutMutation.mutate()}
          >
            <span aria-hidden="true"><SignOut size={20} weight="bold" /></span>
            <span className="workspace-nav__label">Đăng xuất</span>
          </Button>
        </div>
      </aside>

      {mobileNavOpen ? (
        <button
          type="button"
          className="app-nav-scrim"
          aria-label="Đóng điều hướng"
          onClick={() => setMobileNavOpen(false)}
        />
      ) : null}

      <main id="main-content" className="app-content" tabIndex={-1}>
        {children}
      </main>
    </div>
  )
}
