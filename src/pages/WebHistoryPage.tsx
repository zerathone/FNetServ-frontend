import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { MagnifyingGlass, XCircle } from '@phosphor-icons/react'
import { getWebHistoryLogs } from '../api/logs'
import { DateRangePicker, ListPagination, Select } from '../design-system/components';

export function WebHistoryPage() {
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

  // BE (/logs/webhistory): 1 = hoi vien (loc theo UserId), 0 = website (LIKE tren URL) --
  // KHONG phai ten may (WebHistoryTb khong co dieu kien loc theo Machine).
  const [filterType, setFilterType] = useState(1) // 1 = Tài khoản, 0 = Website/URL
  const [filterText, setFilterText] = useState('')
  const [searchInput, setSearchInput] = useState('')

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['logs', 'webhistory', fromDate, toDate, page, filterType, filterText],
    queryFn: () => getWebHistoryLogs(fromDate, toDate, limit, page * limit, filterType, filterText),
  })

  const logs = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / limit))

  return (
    <section className="page-card" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 48px)' }}>
      <div className="page-header">
        <div>
          <p className="eyebrow">Phase 3 · Task 3.17</p>
          <h2 className="section-title">Nhật ký duyệt web</h2>
        </div>
      </div>

      <p className="page-description">Theo dõi lịch sử truy cập web trên các máy trạm.</p>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '1.5rem', marginTop: '1rem', gap: '1rem', flexWrap: 'wrap' }}>
        <div className="toolbar-grid toolbar-grid-2 log-filter-controls" style={{ margin: 0, gap: '1rem' }}>
          <DateRangePicker
            fromDate={fromDate}
            toDate={toDate}
            onFromDateChange={(value) => { setFromDate(value); setPage(0) }}
            onToDateChange={(value) => { setToDate(value); setPage(0) }}
          />
          <form style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flex: 1 }} onSubmit={e => { e.preventDefault(); setPage(0); setFilterText(searchInput.trim()); }}>
            <label className="ds-field" style={{ flex: 1 }}>
              <span className="ds-visually-hidden">Tìm kiếm</span>
              <div className="ds-input-group ds-input-group--search">
                <Select value={filterType} onChange={e => setFilterType(Number(e.target.value))}>
                  <option value={1}>Tài khoản</option>
                  <option value={0}>Website/URL</option>
                </Select>
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
              <th>Tên máy</th>
              <th>Người dùng</th>
              <th>Ngày</th>
              <th>URL / Website</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={5} style={{ textAlign: 'center', padding: '2rem' }}>Đang tải...</td></tr>
            ) : isError ? (
              <tr><td colSpan={5} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-error)' }}>Lỗi: {(error as Error).message}</td></tr>
            ) : logs.length > 0 ? (
              logs.map((log) => (
                <tr key={log.id}>
                  <td>{log.machine}</td>
                  <td>{log.userName || '—'}</td>
                  <td>{log.recordDate}</td>
                  <td style={{ maxWidth: '400px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <a href={log.url.startsWith('http') ? log.url : `http://${log.url}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)' }}>
                      {log.url}
                    </a>
                  </td>
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
