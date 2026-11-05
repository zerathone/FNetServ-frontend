import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { MagnifyingGlass, XCircle } from '@phosphor-icons/react'
import { getServerLogs } from '../api/logs'
import { DateRangePicker, ListPagination, ListToolbar, PageHeader, RefreshButton, StatusBadge, type StatusTone } from '../design-system/components'

// ServerLogTb.Status = tên hành động do server ghi (define.h SL_*: "Thêm ứng dụng", "Xóa tài khoản", "Đổi mật khẩu máy trạm"…,
// có dòng cũ viết thường) nên phân tone theo ĐỘNG TỪ ĐẦU CÂU: xóa = danger, thêm/nạp/mua = success,
// sửa/đổi/làm gọn dữ liệu = warning (thay đổi cấu hình hoặc dọn dữ liệu), đăng nhập/khởi động/tiền = info,
// đăng xuất/thoát và còn lại = neutral.
function getActionTone(status: string): StatusTone {
  const s = status.trim().toLowerCase()
  if (s.startsWith('xóa') || s.startsWith('xoá')) return 'danger'
  if (s.startsWith('thêm') || s.startsWith('nạp') || s.startsWith('mua')) return 'success'
  if (s.startsWith('sửa') || s.startsWith('đổi') || s.startsWith('làm gọn')) return 'warning'
  if (s.startsWith('đăng nhập') || s.startsWith('khởi động') || s.startsWith('tính tiền') || s.startsWith('thanh toán') || s.startsWith('ghi giờ')) return 'info'
  return 'neutral'
}

// Nội dung log có thể rất dài (câu mô tả đủ tên nhóm/giá tiền): mặc định 1 dòng + dấu "…", bấm vào để xem hết/thu lại.
function LogNote({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  if (!text) return null
  return (
    <button
      type="button"
      className={`log-note${open ? ' is-open' : ''}`}
      aria-expanded={open}
      title={open ? 'Thu gọn' : text}
      onClick={() => setOpen((value) => !value)}
    >
      {text}
    </button>
  )
}

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

  const { data, isLoading, isError, error, isFetching, refetch } = useQuery({
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
    <div className="page-fill">
      <PageHeader eyebrow="Vận hành" title="Nhật ký máy chủ" />
      <section className="page-card">

        <div className="log-toolbar">
          <div className="log-filter-controls" style={{ gap: '1rem' }}>
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
                        {/* Nhật ký = hành động đã xảy ra, không phải đang diễn ra -> không chấm tròn. */}
                        {log.status ? <StatusBadge tone={getActionTone(log.status)} dot={false}>{log.status}</StatusBadge> : null}
                      </td>
                      <td className="log-note-cell"><LogNote text={log.note} /></td>
                    </tr>
                  ))
                ) : (
                  <tr><td colSpan={5} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>Không tìm thấy dữ liệu</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  )
}
