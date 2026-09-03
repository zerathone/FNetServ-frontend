import { useEffect } from 'react'
import { useToastStore, type Toast } from '../store/toast'

const AUTO_DISMISS_MS = 6000

const KIND_COLOR: Record<Toast['kind'], string> = {
  error: '#b3261e',
  info: '#1f4b99',
  success: '#1b7a3d',
}

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useToastStore((s) => s.dismiss)

  useEffect(() => {
    const timer = window.setTimeout(() => dismiss(toast.id), AUTO_DISMISS_MS)
    return () => window.clearTimeout(timer)
  }, [toast.id, dismiss])

  return (
    <div
      role="alert"
      style={{
        background: '#ffffff',
        borderLeft: `4px solid ${KIND_COLOR[toast.kind]}`,
        borderRadius: 8,
        boxShadow: '0 6px 18px rgba(0,0,0,0.18)',
        color: '#1a1a1a',
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start',
        padding: '12px 14px',
        maxWidth: 380,
        fontSize: 14,
        lineHeight: 1.4,
      }}
    >
      <span style={{ flex: 1 }}>{toast.message}</span>
      <button
        type="button"
        onClick={() => dismiss(toast.id)}
        aria-label="Đóng"
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: '#666',
          fontSize: 16,
          lineHeight: 1,
          padding: 0,
        }}
      >
        ×
      </button>
    </div>
  )
}

export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts)

  if (toasts.length === 0) return null

  return (
    <div
      style={{
        position: 'fixed',
        top: 16,
        right: 16,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  )
}
