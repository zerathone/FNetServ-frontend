import { useQuery } from '@tanstack/react-query'
import { MagnifyingGlass, XCircle } from '@phosphor-icons/react'
import { useState } from 'react'
import { getSystemLogs } from '../api/logs'
import { DateRangePicker, ListPagination, Select } from '../design-system/components';

function formatMinutes(totalMinutes: number | undefined | null) {
  if (totalMinutes == null) return '00:00';
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

function getStatusStyle(status: string) {
  const s = (status || '').toLowerCase()
  if (s.includes('bật') || s.includes('on') || s.includes('start') || s.includes('login') || s.includes('đăng nhập') || s.includes('đang sử dụng') || s.includes('đang dùng')) {
    return { color: '#3b82f6', backgroundColor: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.2)' } // ONLINE (Blue)
  }
  if (s.includes('tắt') || s.includes('off') || s.includes('stop') || s.includes('logout') || s.includes('đăng xuất') || s.includes('mất kết nối')) {
    return { color: '#ef4444', backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)' } // DISCONNECT (Red)
  }
  if (s.includes('sẵn sàng') || s.includes('ready') || s.includes('ok')) {
    return { color: '#10b981', backgroundColor: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.2)' } // AVAILABLE (Green)
  }
  // Cảnh báo (Warning - Orange)
  if (s.includes('cảnh báo') || s.includes('warn') || s.includes('lỗi') || s.includes('error')) {
    return { color: '#f59e0b', backgroundColor: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.2)' }
  }
  // Default (Init/Unknown - Gray)
  return { color: '#64748b', backgroundColor: 'rgba(100, 116, 139, 0.1)', border: '1px solid rgba(100, 116, 139, 0.2)' }
}

export function SystemLogPage() {
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date()
    return d.toISOString().split('T')[0]
  })
  const [toDate, setToDate] = useState(() => {
    const d = new Date()
    return d.toISOString().split('T')[0]
  })

  const [page, setPage] = useState(0)
  const limit = 50
  
  const [filterType, setFilterType] = useState(1) // 1 = Tài khoản, 0 = Máy
  const [filterText, setFilterText] = useState('')
  const [searchInput, setSearchInput] = useState('')

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['logs', 'system', fromDate, toDate, page, filterType, filterText],
    queryFn: () => getSystemLogs(fromDate, toDate, limit, page * limit, filterType, filterText),
  })

  const logs = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / limit))

  return (
    <section className="page-card" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 48px)' }}>
      <div className="page-header">
        <div>
          <p className="eyebrow">Vận hành</p>
          <h2 className="section-title">Nhật ký hệ thống</h2>
        </div>
      </div>

      <p className="page-description">Theo dõi hoạt động của máy trạm và người dùng.</p>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '1.5rem', marginTop: '1rem', gap: '1rem', flexWrap: 'wrap' }}>
        <div className="toolbar-grid toolbar-grid-2 log-filter-controls" style={{ margin: 0, gap: '1rem' }}>
          <DateRangePicker
            fromDate={fromDate}
            toDate={toDate}
            onFromDateChange={(value) => { setFromDate(value); setPage(0) }}
            onToDateChange={(value) => { setToDate(value); setPage(0) }}
          />

          <form style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', minWidth: 0 }} onSubmit={e => { e.preventDefault(); setPage(0); setFilterText(searchInput.trim()); }}>
            <label className="ds-field" style={{ flex: 1 }}>
              <span className="ds-visually-hidden">Tìm kiếm</span>
              <div className="ds-input-group ds-input-group--search">
                <Select value={filterType} onChange={e => setFilterType(Number(e.target.value))}>
                  <option value={1}>Tài khoản</option>
                  <option value={0}>Tên máy</option>
                </Select>
                <div className="ds-search-input">
                  <MagnifyingGlass className="ds-search-input__icon" size={18} weight="bold" aria-hidden="true" />
                  <input className="ds-input" type="search" placeholder="Nhập rồi Enter..." value={searchInput} onChange={e => setSearchInput(e.target.value)} />
                  {searchInput ? (
                    <button
                      type="button"
                      className="ds-search-input__clear"
                      aria-label="Xóa từ khóa tìm kiếm"
                      title="Xóa từ khóa"
                      onClick={() => { setSearchInput(''); setFilterText(''); setPage(0) }}
                    >
                      <XCircle size={17} weight="fill" aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              </div>
            </label>
          </form>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.9em' }}>
            Tổng: {total}
          </span>
          <ListPagination
            page={page}
            totalPages={totalPages}
            canNext={page < totalPages - 1}
            onPrevious={() => setPage((current) => Math.max(0, current - 1))}
            onNext={() => setPage((current) => current + 1)}
          />
        </div>
      </div>

      <div className="table-card" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Tên máy</th>
              <th>Người dùng</th>
              <th>Ngày</th>
              <th>Giờ</th>
              <th>Trạng thái</th>
              <th>Thời gian (hh:mm)</th>
              <th>Ghi chú</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: '2rem' }}>Đang tải...</td></tr>
            ) : isError ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-error)' }}>Lỗi: {(error as Error).message}</td></tr>
            ) : logs.length > 0 ? (
              logs.map((log) => (
                <tr key={log.id}>
                  <td>{log.machineName}</td>
                  <td>{log.userName || ''}</td>
                  <td>{log.enterDate}</td>
                  <td>{log.enterTime}</td>
                  <td>
                    <span style={{ 
                      padding: '0.25rem 0.5rem', 
                      borderRadius: '4px', 
                      fontSize: '0.85em', 
                      fontWeight: 'bold', 
                      ...getStatusStyle(log.status)
                    }}>
                      {log.status}
                    </span>
                  </td>
                  <td>{formatMinutes(log.timeUsed)}</td>
                  <td>{log.note}</td>
                </tr>
              ))
            ) : (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>Không tìm thấy dữ liệu</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
