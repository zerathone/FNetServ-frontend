import { useQuery } from '@tanstack/react-query'
import { MagnifyingGlass, XCircle } from '@phosphor-icons/react'
import { useState } from 'react'
import { getSystemLogs } from '../api/logs'
import { DateRangePicker, ListPagination, ListToolbar, PageHeader, RefreshButton, Select, StatusBadge, type StatusTone } from '../design-system/components';

function formatMinutes(totalMinutes: number | undefined | null) {
  if (totalMinutes == null) return '00:00';
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

// Cùng bảng tone với cột Tình trạng trang Máy trạm: đang dùng = info, sẵn sàng = success, mất kết nối/tắt = danger.
function getStatusTone(status: string): StatusTone {
  const s = (status || '').toLowerCase()
  if (s.includes('bật') || s.includes('on') || s.includes('start') || s.includes('login') || s.includes('đăng nhập') || s.includes('đang sử dụng') || s.includes('đang dùng')) {
    return 'info'
  }
  if (s.includes('tắt') || s.includes('off') || s.includes('stop') || s.includes('logout') || s.includes('đăng xuất') || s.includes('mất kết nối')) {
    return 'danger'
  }
  if (s.includes('sẵn sàng') || s.includes('ready') || s.includes('ok')) {
    return 'success'
  }
  if (s.includes('cảnh báo') || s.includes('warn') || s.includes('lỗi') || s.includes('error')) {
    return 'warning'
  }
  return 'neutral'
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

  const { data, isLoading, isError, error, isFetching, refetch } = useQuery({
    queryKey: ['logs', 'system', fromDate, toDate, page, filterType, filterText],
    queryFn: () => getSystemLogs(fromDate, toDate, limit, page * limit, filterType, filterText),
  })

  const logs = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / limit))

  return (
    <div className="page-fill">
      <PageHeader eyebrow="Vận hành" title="Nhật ký hệ thống" />
      <section className="page-card">

        <div className="log-toolbar">
          <div className="log-filter-controls" style={{ gap: '1rem' }}>
            <DateRangePicker
              fromDate={fromDate}
              toDate={toDate}
              onFromDateChange={(value) => { setFromDate(value); setPage(0) }}
              onToDateChange={(value) => { setToDate(value); setPage(0) }}
            />

            <form style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flex: 1, minWidth: 0 }} onSubmit={e => { e.preventDefault(); setPage(0); setFilterText(searchInput.trim()); }}>
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
        </div>

        <div className="log-table-card" style={{ flex: 1, minHeight: 0 }}>
          <ListToolbar
            count={<>Tổng <strong>{new Intl.NumberFormat('vi-VN').format(total)}</strong></>}
            actions={
              <>
                <RefreshButton loading={isFetching} onClick={() => void refetch()} />
                <ListPagination
                  page={page}
                  totalPages={totalPages}
                  canNext={page < totalPages - 1}
                  onPrevious={() => setPage((current) => Math.max(0, current - 1))}
                  onNext={() => setPage((current) => current + 1)}
                />
              </>
            }
          />
          <div className="log-table-card__scroll">
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
                        {/* Nhật ký = trạng thái đã xảy ra, không phải đang diễn ra -> không chấm tròn. */}
                        {log.status ? <StatusBadge tone={getStatusTone(log.status)} dot={false}>{log.status}</StatusBadge> : null}
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
        </div>
      </section>
    </div>
  )
}
