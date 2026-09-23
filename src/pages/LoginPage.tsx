import { useMutation, useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { login } from '../api/auth'
import { getServerInfo } from '../api/system'
import { useAuthStore } from '../store/auth'

export function LoginPage() {
  const token = useAuthStore((state) => state.token)
  const setCredentials = useAuthStore((state) => state.setCredentials)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  const serverInfoQuery = useQuery({
    queryKey: ['server-info'],
    queryFn: getServerInfo,
    staleTime: Infinity,
    retry: false,
  })

  const loginMutation = useMutation({
    mutationFn: () => login(username, password),
    onSuccess: (data) => {
      setCredentials({
        token: data.token,
        sessionId: data.sessionId,
        staffId: data.staffId,
        staffName: username,
        isAdmin: data.isAdmin,
        rights: data.rights ?? [],
      })
    },
  })

  if (token) {
    return <Navigate to="/workstations" replace />
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!username || !password || loginMutation.isPending) return
    loginMutation.mutate()
  }

  return (
    <main className="login-shell">
      <form className="login-card login-card-glass" onSubmit={handleSubmit}>
        <div className="login-brand" role="img" aria-label="FNet">
          <img
            className="login-brand__logo login-brand__logo--color"
            src="/brand/logo_fnet-web_wordmark_20260813_color.png"
            alt=""
          />
          <img
            className="login-brand__logo login-brand__logo--reversed"
            src="/brand/logo_fnet-web_wordmark_20260813_reversed.png"
            alt=""
          />
        </div>
        <p className="eyebrow">Quản lý phòng máy</p>
        <h1 className="title">Đăng nhập</h1>
        <p className="page-description">Đăng nhập bằng tài khoản thu ngân/quản trị để tiếp tục.</p>

        <label className="field">
          <span>Tên đăng nhập</span>
          <input
            className="text-input"
            value={username}
            onChange={(event) => setUsername(event.target.value.toUpperCase())}
            autoFocus
            autoComplete="username"
          />
        </label>

        <label className="field">
          <span>Mật khẩu</span>
          <input
            className="text-input"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
          />
        </label>

        {loginMutation.isError ? (
          <p className="status-text error-text">{(loginMutation.error as Error).message}</p>
        ) : null}

        <div className="login-actions">
          <button
            type="submit"
            className="primary-button"
            disabled={!username || !password || loginMutation.isPending}
          >
            {loginMutation.isPending ? 'Đang đăng nhập...' : 'Đăng nhập'}
          </button>

          {serverInfoQuery.data?.ver ? (
            <span className="login-version">
              v{serverInfoQuery.data.ver}
              {serverInfoQuery.data.rd ? ` · ${serverInfoQuery.data.rd}` : ''}
            </span>
          ) : null}
        </div>
      </form>
    </main>
  )
}
