import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { useDebugStore } from '../store/debugStore'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo })
    // Cần lấy addLog từ store nhưng store là hook, nên ta gọi getState
    useDebugStore.getState().addLog({
      type: 'RENDER_ERROR',
      message: error.message,
      details: {
        stack: error.stack,
        componentStack: errorInfo.componentStack
      }
    })
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '2rem', margin: '2rem', border: '2px solid var(--text-error)', borderRadius: '8px', backgroundColor: 'var(--surface)' }}>
          <h2 style={{ color: 'var(--text-error)', marginBottom: '1rem' }}>Đã xảy ra lỗi Render (UI Crash)</h2>
          <p style={{ marginBottom: '1rem' }}>
            Một component trên trang này đã gặp lỗi khi hiển thị. Nguyên nhân thường do data từ API sai cấu trúc. Lỗi này đã được ghi nhận vào Debug Monitor.
          </p>
          <div style={{ background: 'var(--background)', padding: '1rem', borderRadius: '4px', overflowX: 'auto', fontFamily: 'monospace', fontSize: '0.9em' }}>
            <strong>{this.state.error?.toString()}</strong>
            <br /><br />
            {this.state.errorInfo?.componentStack}
          </div>
          <button 
            type="button" 
            className="primary-button" 
            style={{ marginTop: '1rem' }}
            onClick={() => window.location.reload()}
          >
            Tải lại trang
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
