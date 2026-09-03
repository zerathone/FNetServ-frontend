import { useState } from 'react'
import { Bug, ClipboardText, Trash, WarningCircle } from '@phosphor-icons/react'
import { Button, Dialog } from '../design-system/components'
import { useDebugStore } from '../store/debugStore'

export function DebugMonitor() {
  const [isOpen, setIsOpen] = useState(false)
  const { logs, clearLogs } = useDebugStore()

  const handleCopy = () => {
    navigator.clipboard.writeText(JSON.stringify(logs, null, 2))
      .then(() => alert('Đã copy toàn bộ logs vào Clipboard!'))
      .catch((err) => alert('Lỗi khi copy: ' + err))
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={`debug-monitor-trigger${logs.length > 0 ? ' has-errors' : ''}`}
        aria-label={`Mở Debug Monitor${logs.length > 0 ? `, ${logs.length} lỗi` : ''}`}
        title="Mở Debug Monitor"
      >
        <Bug size={24} weight="bold" aria-hidden="true" />
        {logs.length > 0 && (
          <span className="debug-monitor-trigger__count" aria-hidden="true">
            {logs.length}
          </span>
        )}
      </button>

      <Dialog
        open={isOpen}
        title={`Debug Monitor (${logs.length} lỗi)`}
        description="Nhật ký lỗi giao diện và API trong phiên hiện tại."
        size="lg"
        onClose={() => setIsOpen(false)}
        footer={(
          <>
            <Button type="button" variant="secondary" icon={<ClipboardText size={18} weight="bold" aria-hidden="true" />} onClick={handleCopy}>
              Copy JSON
            </Button>
            <Button type="button" variant="danger" icon={<Trash size={18} weight="bold" aria-hidden="true" />} onClick={clearLogs}>
              Xóa hết
            </Button>
          </>
        )}
      >
        {logs.length === 0 ? (
          <div className="debug-monitor-empty">
            <Bug size={32} weight="duotone" aria-hidden="true" />
            <span>Chưa có lỗi nào được ghi nhận.</span>
          </div>
        ) : (
          <div className="debug-monitor-log-list">
            {logs.map((log) => (
              <article key={log.id} className={`debug-monitor-log debug-monitor-log--${log.type === 'RENDER_ERROR' ? 'render' : 'api'}`}>
                <header>
                  <strong><WarningCircle size={18} weight="fill" aria-hidden="true" />{log.type}</strong>
                  <time>{new Date(log.timestamp).toLocaleTimeString()}</time>
                </header>
                <p>{log.message}</p>
                {log.url ? <span className="debug-monitor-log__url">URL: {log.url}</span> : null}
                {log.details ? (
                  <pre>{typeof log.details === 'string' ? log.details : JSON.stringify(log.details, null, 2)}</pre>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </Dialog>
    </>
  )
}
