import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { MagnifyingGlass, XCircle } from '@phosphor-icons/react'
import { getServerLogs } from '../api/logs'
import { DateRangePicker, ListPagination } from '../design-system/components'

export function ServerLogPage() {
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date()
    return d.toISOString().split('T')[0]
  })
  const [toDate, setToDate] = useState(() => {
    const d = new Date()
    return d.toISOString().split('T')[0]
  })

  // ServerLogTb khong co UserId/MachineName (chi Status/RecordDate/RecordTime/Note) -- BE chi ho
  // tro DUY NHAT 1 kieu tim: trong Note. Khong can dropdown chon loai, luon gui filterType=0.
  const filterType = 0
  const [filterText, setFilterText] = useState('')
  const [searchInput, setSearchInput] = useState('')

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['logs', 'server', fromDate, toDate, filterType, filterText],
    queryFn: () => getServerLogs(fromDate, toDate, 5000, 0, filterType, filterText),
  })

  const allLogs = data ?? []
  
  const [page, setPage] = useState(0)
  const limit = 50
  const total = allLogs.length
  const totalPages = Math.max(1, Math.ceil(total / limit))
  
  const logs = allLogs.slice(page * limit, (page + 1) * limit)

  return (
    <section className="page-card" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 48px)' }}>
      <div className="page-header">
        <div>
          <p className="eyebrow">Phase 3 · Task 3.18</p>
          <h2 className="section-title">Nhật ký máy chủ</h2>
        </div>
      </div>

      <p className="page-description">Theo dõi các sự kiện trên máy chủ (start, stop, error).</p>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '1.5rem', marginTop: '1rem', gap: '1rem', flexWrap: 'wrap' }}>
        <div className="toolbar-grid toolbar-grid-2 log-filter-controls" style={{ margin: 0, gap: '1rem' }}>
          <DateRangePicker
            fromDate={fromDate}
            toDate={toDate}
            onFromDateChange={(value) => { setFromDate(value); setPage(0) }}
            onToDateChange={(value) => { setToDate(value); setPage(0) }}
          />
          <form style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flex: 1 }} onSubmit={e => { e.preventDefault(); setPage(0); setFilterText(searchInput.trim()); }}>
            <label className="ds-field" style={{ flex: 1, minWidth: '200px' }}>
              <span className="ds-visually-hidden">Từ khóa</span>
              <div className="ds-input-group ds-input-group--search">
                <div className="ds-search-input">
                  <MagnifyingGlass className="ds-search-input__icon" size={18} weight="bold" aria-hidden="true" />
                  <input className="ds-input" type="search" placeholder="Nhập rồi Enter..." value={searchInput} onChange={e => setSearchInput(e.target.value)} />
                  {searchInput ? (
                    <button type="button" className="ds-search-input__clear" aria-label="Xóa từ khóa" onClick={() => { setSearchInput(''); setFilterText(''); setPage(0) }}>
                      <XCircle size={18} weight="fill" aria-hidden="true" />
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
              <th>ID</th>
              <th>Ngày</th>
              <th>Giờ</th>
              <th>Trạng thái / Mức độ</th>
              <th>Nội dung</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={5} style={{ textAlign: 'center', padding: '2rem' }}>Đang tải...</td></tr>
            ) : isError ? (
              <tr><td colSpan={5} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-error)' }}>Lỗi: {(error as Error).message}</td></tr>
            ) : logs && logs.length > 0 ? (
              logs.map((log) => (
                <tr key={log.id}>
                  <td style={{ fontWeight: 500 }}>{log.id}</td>
                  <td>{log.recordDate}</td>
                  <td>{log.recordTime}</td>
                  <td>
                    <span
                      style={{
                        padding: '0.25rem 0.5rem',
                        borderRadius: '4px',
                        fontSize: '0.85em',
                        fontWeight: 'bold',
                        backgroundColor: 'rgba(59, 130, 246, 0.15)',
                        color: 'var(--primary)',
                      }}
                    >
                      {log.status || 'Info'}
                    </span>
                  </td>
                  <td>{log.note}</td>
                </tr>
              ))
            ) : (
              <tr><td colSpan={5} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>Không tìm thấy dữ liệu</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
