import { useMutation } from '@tanstack/react-query'
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { logoutRequest } from '../api/auth'
import { Select, Button, IconButton, StatusBadge } from '../design-system/components'
import { useTheme } from '../design-system/theme/themeContext'
import { useAuthStore } from '../store/auth'
import { useWsStatusStore } from '../store/wsStatus'
import { NotificationCenter } from '../features/notifications/NotificationCenter'
import { 
  Desktop, Users, ShoppingCart, CurrencyDollar, ArrowsLeftRight, TerminalWindow,
  IdentificationCard, Detective, SquaresFour, UsersThree, 
  DesktopTower, Percent, AppWindow, ShieldWarning, ChartBar, 
  ChartLineUp, FileText, Globe, Gear, Printer, ShieldCheck, 
  Palette, SignOut, List, X, MagnifyingGlass, CaretRight, CaretLeft 
} from '@phosphor-icons/react'

type WorkspaceId = 'pos' | 'management' | 'analysis' | 'system'

type NavigationItem = {
  to: string
  label: string
  shortLabel: string
  icon: ReactNode
  adminOnly?: boolean
  devOnly?: boolean
}

type Workspace = {
  id: WorkspaceId
  label: string
  shortLabel: string
  landing: string
  adminOnly?: boolean
  items: NavigationItem[]
}

const workspaces: readonly Workspace[] = [
  {
    id: 'pos',
    label: 'POS',
    shortLabel: 'POS',
    landing: '/workstations',
    items: [
      { to: '/workstations', label: 'Máy trạm', shortLabel: 'Máy', icon: <Desktop size={24} weight="duotone" /> },
      {
        to: '/users',
        label: 'Khách hàng & nạp tiền',
        shortLabel: 'Khách',
        icon: <Users size={24} weight="duotone" />,
      },
      { to: '/orders', label: 'Đơn dịch vụ', shortLabel: 'Đơn', icon: <ShoppingCart size={24} weight="duotone" /> },
      { to: '/payments', label: 'Bán COMBO', shortLabel: 'Bán', icon: <CurrencyDollar size={24} weight="duotone" /> },
      { to: '/logs/voucher', label: 'Giao dịch', shortLabel: 'GD', icon: <ArrowsLeftRight size={24} weight="duotone" /> },
      { to: '/logs/system', label: 'Nhật ký hệ thống', shortLabel: 'Log', icon: <TerminalWindow size={24} weight="duotone" /> },
    ],
  },
  {
    id: 'management',
    label: 'Quản lý',
    shortLabel: 'QL',
    landing: '/users',
    adminOnly: true,
    items: [
      { to: '/users', label: 'Hội viên', shortLabel: 'HV', icon: <Users size={24} weight="duotone" /> },
      { to: '/cards', label: 'Thẻ nạp', shortLabel: 'Thẻ', icon: <IdentificationCard size={24} weight="duotone" /> },
      { to: '/anonyms', label: 'Khách vãng lai', shortLabel: 'Khách', icon: <Detective size={24} weight="duotone" /> },
      { to: '/services', label: 'Dịch vụ', shortLabel: 'DV', icon: <SquaresFour size={24} weight="duotone" /> },
      { to: '/combos', label: 'COMBO', shortLabel: 'CB', icon: <SquaresFour size={24} weight="duotone" /> },
      { to: '/user-groups', label: 'Nhóm người dùng', shortLabel: 'Nhóm', icon: <UsersThree size={24} weight="duotone" /> },
      { to: '/machine-groups', label: 'Nhóm máy', shortLabel: 'Nhóm', icon: <DesktopTower size={24} weight="duotone" /> },
      { to: '/promotions', label: 'Khuyến mãi', shortLabel: 'KM', icon: <Percent size={24} weight="duotone" /> },
      { to: '/apps', label: 'Ứng dụng', shortLabel: 'App', icon: <AppWindow size={24} weight="duotone" /> },
      { to: '/webblock', label: 'Khống chế Web/App', shortLabel: 'Web', icon: <ShieldWarning size={24} weight="duotone" /> },
    ],
  },
  {
    id: 'analysis',
    label: 'Phân tích',
    shortLabel: 'PT',
    landing: '/reports',
    adminOnly: true,
    items: [
      { to: '/reports', label: 'Doanh thu', shortLabel: 'DT', icon: <ChartBar size={24} weight="duotone" /> },
      { to: '/dynamic-reports', label: 'Trung tâm báo cáo', shortLabel: 'BC', icon: <ChartLineUp size={24} weight="duotone" /> },
    ],
  },
  {
    id: 'system',
    label: 'Quản trị',
    shortLabel: 'QT',
    landing: '/settings',
    adminOnly: true,
    items: [
      { to: '/workstations', label: 'Sức khỏe máy trạm', shortLabel: 'Máy', icon: <Desktop size={24} weight="duotone" /> },
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
]

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
  const { theme, setTheme, themes } = useTheme()
  const [workspaceId, setWorkspaceId] = useState<WorkspaceId>('pos')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [customerQuery, setCustomerQuery] = useState('')

  const availableWorkspaces = useMemo(
    () => workspaces.filter((workspace) => !workspace.adminOnly || isAdmin),
    [isAdmin],
  )
  const workspace = getWorkspace(workspaceId)
  const navigationItems = workspace.items.filter(
    (item) =>
      (!item.adminOnly || isAdmin) && (!item.devOnly || import.meta.env.DEV),
  )

  useEffect(() => {
    if (!isAdmin && workspace.adminOnly) setWorkspaceId('pos')
  }, [isAdmin, workspace.adminOnly])

  useEffect(() => {
    setMobileNavOpen(false)
  }, [location.pathname])

  const logoutMutation = useMutation({
    mutationFn: logoutRequest,
    onSettled: () => {
      logout()
      navigate('/login', { replace: true })
    },
  })

  const changeWorkspace = (nextId: WorkspaceId) => {
    const nextWorkspace = getWorkspace(nextId)
    if (nextWorkspace.adminOnly && !isAdmin) return
    setWorkspaceId(nextId)
    navigate(nextWorkspace.landing)
  }

  const submitCustomerSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const query = customerQuery.trim()
    if (!query) return
    setWorkspaceId('pos')
    navigate(`/users?search=${encodeURIComponent(query)}`)
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
          <NavLink className="brand-mark" to={workspace.landing} aria-label="FNet - về trang chính">
            <img src="/brand/logo_fnet-web_mark_20260813_square.png" alt="" />
          </NavLink>
          <label className="workspace-switcher">
            <span>Không gian</span>
            <Select
              value={workspaceId}
              onChange={(event) => changeWorkspace(event.target.value as WorkspaceId)}
            >
              {availableWorkspaces.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </Select>
          </label>
        </div>

        <form className="customer-search" role="search" onSubmit={submitCustomerSearch}>
          <label htmlFor="global-customer-search">Tìm khách</label>
          <div className="customer-search__control">
            <span aria-hidden="true"><MagnifyingGlass size={18} weight="bold" /></span>
            <input
              id="global-customer-search"
              value={customerQuery}
              onChange={(event) => setCustomerQuery(event.target.value)}
              placeholder="Số điện thoại, CCCD hoặc tên đăng nhập"
              autoComplete="off"
            />
            {customerQuery ? (
              <button
                type="button"
                className="customer-search__clear"
                aria-label="Xóa nội dung tìm kiếm"
                onClick={() => setCustomerQuery('')}
              >
                <X size={14} weight="bold" />
              </button>
            ) : null}
          </div>
        </form>

        <div className="app-topbar__end">
          <StatusBadge tone={wsConnected ? 'success' : 'warning'}>
            {wsConnected ? 'Trực tuyến' : 'Mất realtime'}
          </StatusBadge>
          <NotificationCenter />
          <label className="theme-switcher">
            <span>Giao diện</span>
            <Select value={theme} onChange={(event) => setTheme(event.target.value as typeof theme)}>
              {themes.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </Select>
          </label>
          <div className="staff-summary">
            <span>{isAdmin ? 'Quản trị viên' : 'Nhân viên'}</span>
            <strong>{staffName || 'Phiên cục bộ'}</strong>
          </div>
        </div>
      </header>

      <aside className="app-sidebar" aria-label={`Điều hướng ${workspace.label}`}>
        <div className="app-sidebar__header">
          <div>
            <span className="app-sidebar__eyebrow">Không gian làm việc</span>
            <strong>{workspace.label}</strong>
          </div>
          <IconButton
            className="app-sidebar__collapse"
            label={sidebarCollapsed ? 'Mở rộng thanh điều hướng' : 'Thu gọn thanh điều hướng'}
            icon={sidebarCollapsed ? <CaretRight size={20} /> : <CaretLeft size={20} />}
            onClick={() => setSidebarCollapsed((value) => !value)}
          />
        </div>

        <nav className="workspace-nav">
          {navigationItems.map((item) => (
            <NavLink
              key={`${workspace.id}-${item.to}`}
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
          ))}
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
