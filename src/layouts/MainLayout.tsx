import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { logoutRequest } from '../api/auth'
import { getServerInfo } from '../api/system'
import { Button, IconButton, StatusBadge } from '../design-system/components'
import { useTheme } from '../design-system/theme/themeContext'
import type { ThemeId } from '../design-system/theme/themeRegistry'
import { useAuthStore } from '../store/auth'
import { useWsStatusStore } from '../store/wsStatus'
import { NotificationCenter } from '../features/notifications/NotificationCenter'
import {
  Desktop, Users, ShoppingCart, CurrencyDollar, ArrowsLeftRight, TerminalWindow,
  IdentificationCard, Detective, SquaresFour, UsersThree,
  DesktopTower, Percent, AppWindow, ShieldWarning, ChartBar,
  ChartLineUp, FileText, Globe, Gear, Printer, ShieldCheck,
  Palette, SignOut, List, X, CaretRight, CaretLeft,
  Sun, MoonStars, Monitor, Flame, CaretDown
} from '@phosphor-icons/react'

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
}

type Workspace = {
  id: WorkspaceId
  label: string
  shortLabel: string
  icon: ReactNode
  landing: string
  adminOnly?: boolean
  items: NavigationItem[]
}

const workspaces: readonly Workspace[] = [
  {
    id: 'pos',
    label: 'Thu ngân',
    shortLabel: 'Thu ngân',
    icon: <ShoppingCart size={20} weight="duotone" />,
    landing: '/workstations',
    items: [
      { to: '/workstations', label: 'Máy trạm', shortLabel: 'Máy', icon: <Desktop size={24} weight="duotone" /> },
      {
        to: '/users',
        label: 'Tài khoản',
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
    icon: <UsersThree size={20} weight="duotone" />,
    landing: '/users',
    adminOnly: true,
    items: [
      { to: '/users', label: 'Tài khoản', shortLabel: 'HV', icon: <Users size={24} weight="duotone" /> },
      { to: '/cards', label: 'Thẻ nạp', shortLabel: 'Thẻ', icon: <IdentificationCard size={24} weight="duotone" /> },
      { to: '/anonyms', label: 'Khách vãng lai', shortLabel: 'Khách', icon: <Detective size={24} weight="duotone" /> },
      { to: '/services', label: 'Dịch vụ', shortLabel: 'DV', icon: <SquaresFour size={24} weight="duotone" /> },
      { to: '/combos', label: 'COMBO', shortLabel: 'CB', icon: <SquaresFour size={24} weight="duotone" /> },
      { to: '/user-groups', label: 'Nhóm người dùng', shortLabel: 'Nhóm', icon: <UsersThree size={24} weight="duotone" /> },
      { to: '/machine-groups', label: 'Nhóm máy', shortLabel: 'Nhóm', icon: <DesktopTower size={24} weight="duotone" /> },
      { to: '/promotions', label: 'Khuyến mãi', shortLabel: 'KM', icon: <Percent size={24} weight="duotone" /> },
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
    landing: '/reports',
    adminOnly: true,
    items: [
      { to: '/reports', label: 'Doanh thu', shortLabel: 'DT', icon: <ChartBar size={24} weight="duotone" /> },
      { to: '/dynamic-reports', label: 'Trung tâm báo cáo', shortLabel: 'BC', icon: <ChartLineUp size={24} weight="duotone" /> },
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
  const [themeMenuOpen, setThemeMenuOpen] = useState(false)
  const themeMenuRef = useRef<HTMLDivElement>(null)
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false)
  const workspaceMenuRef = useRef<HTMLDivElement>(null)
  const [clockNow, setClockNow] = useState(() => new Date())

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
    setWorkspaceMenuOpen(false)
    navigate(nextWorkspace.landing)
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
          <div className="staff-summary">
            <span>{isAdmin ? 'Người dùng' : 'Nhân viên'}</span>
            <strong>{staffName || 'Phiên cục bộ'}</strong>
          </div>
        </div>

        <div className="app-topbar__end">
          <StatusBadge tone={wsConnected ? 'success' : 'warning'}>
            {wsConnected ? 'Trực tuyến' : 'Mất realtime'}
          </StatusBadge>
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
            <IconButton
              className="app-sidebar__collapse"
              label={sidebarCollapsed ? 'Mở rộng thanh điều hướng' : 'Thu gọn thanh điều hướng'}
              icon={sidebarCollapsed ? <CaretRight size={20} /> : <CaretLeft size={20} />}
              onClick={() => setSidebarCollapsed((value) => !value)}
            />
          </div>
          <div className="workspace-switcher" ref={workspaceMenuRef}>
            <button
              type="button"
              className="workspace-switcher__trigger"
              title={sidebarCollapsed ? workspace.label : undefined}
              aria-haspopup="listbox"
              aria-expanded={workspaceMenuOpen}
              onClick={() => setWorkspaceMenuOpen((value) => !value)}
            >
              <span className="workspace-switcher__icon" aria-hidden="true">
                {workspace.icon}
              </span>
              <span className="workspace-switcher__label">{workspace.label}</span>
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
                    <span className="workspace-switcher__icon" aria-hidden="true">
                      {item.icon}
                    </span>
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
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
          {serverInfoQuery.data?.ver ? (
            <span className="app-sidebar__version">
              v{serverInfoQuery.data.ver}
              {serverInfoQuery.data.rd ? ` · ${serverInfoQuery.data.rd}` : ''}
            </span>
          ) : null}
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
