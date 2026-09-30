import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchDynamicReport } from '../api/dynamic-reports'
import { Select, DateRangePicker } from '../design-system/components';

function getToday() {
  return new Date().toISOString().slice(0, 10)
}

// Chi liet ke report co trong map_file_report (ServerSide_ai/ReportUtils.cpp:653) --
// day la nguon su that cho biet report nao THAT SU sinh du lieu qua /rptv2. Cac id bi
// loai (14,16-24,29,30) khong co trong map do: 14/29/30 khong co trong map_report cua
// MakeData() (ReportUtils.cpp:836) nen luon that bai; 16-24 co trong map_report nhung
// chi `return TRUE;` khong goi ham sinh du lieu nao (ReportUtils.cpp:878-882) nen luon
// tra ve rong -- ca hai truong hop deu vo nghia tren combobox WebUI.
const REPORT_TYPES = [
  { id: 1, label: 'Báo cáo 1: DAILY CASH' },
  { id: 2, label: 'Báo cáo 2: DAILY CASH ALL' },
  { id: 3, label: 'Báo cáo 3: WEEKLY CASH' },
  { id: 4, label: 'Báo cáo 4: WEEKLY CASH ALL' },
  { id: 5, label: 'Báo cáo 5: MONTHLY CASH' },
  { id: 6, label: 'Báo cáo 6: MONTHLY CASH ALL' },
  { id: 7, label: 'Báo cáo 7: SERVICE IN DAY' },
  { id: 8, label: 'Báo cáo 8: SERVICE IN DAY ALL' },
  { id: 9, label: 'Báo cáo 9: SERVICE IN MONTH' },
  { id: 10, label: 'Báo cáo 10: SERVICE IN MONTH ALL' },
  { id: 11, label: 'Báo cáo 11: CASH MACHINE' },
  { id: 12, label: 'Báo cáo 12: FREE TIME' },
  { id: 13, label: 'Báo cáo 13: FREE MONEY' },
  { id: 15, label: 'Báo cáo 15: ACCOUNT DEBIT' },
  { id: 25, label: 'Báo cáo 25: CARD RECHARGE IN DAY' },
  { id: 26, label: 'Báo cáo 26: CARD RECHARGE IN DAY ALL' },
  { id: 27, label: 'Báo cáo 27: CARD RECHARGE IN MONTH' },
  { id: 28, label: 'Báo cáo 28: CARD RECHARGE IN MONTH ALL' },
  { id: 31, label: 'Báo cáo 31: TIME AND MONEY USED MEMBER' },
  { id: 32, label: 'Báo cáo 32: MEMBER RECHARGE IN DAY' },
  { id: 33, label: 'Báo cáo 33: MEMBER RECHARGE IN MONTH' },
  { id: 34, label: 'Báo cáo 34: DASHBOARD INCOME' },
  { id: 35, label: 'Báo cáo 35: DASHBOARD MOBILE' },
  { id: 36, label: 'Báo cáo 36: DASHBOARD ACCOUNT USAGE' },
  { id: 37, label: 'Báo cáo 37: DASHBOARD ACCOUNT DETAIL USAGE' },
  { id: 38, label: 'Báo cáo 38: DASHBOARD MACHINE USAGE' },
  { id: 39, label: 'Báo cáo 39: DASHBOARD MACHINE DETAIL USAGE' },
  { id: 40, label: 'Báo cáo 40: DASHBOARD ACCOUNT STATS' },
  { id: 41, label: 'Báo cáo 41: TYPE20 INCOME' },
  { id: 42, label: 'Báo cáo 42: TYPE20 INCOME STAFF' },
  { id: 43, label: 'Báo cáo 43: TYPE20 CASH SHIFT (Giao ca)' },
]

// Ten cot tieng Viet co dinh cho tung loai bao cao (user chot 2026-09-29) -- hien du ten cot
// ke ca khi chua co du lieu (khong dung Object.keys(row) nua vi row rong thi khong co key nao).
const REPORT_COLUMNS: Record<number, string[]> = {
  1: ['Tên đăng nhập', 'Ngày', 'Thời điểm', 'Thời gian mua', 'Phí giao dịch', 'Phí thời gian', 'Tiền máy trạm', 'Nhân viên', 'Giao dịch'],
  2: ['Tên đăng nhập', 'Ngày', 'Thời điểm', 'Thời gian mua', 'Phí giao dịch', 'Phí thời gian', 'Tiền máy trạm', 'Nhân viên', 'Giao dịch'],
  // Cot dau tien de trong (ten dong nam o ROW_LABELED_REPORTS ben duoi) -- day la bang pivot
  // (dong = loai tien, cot = thu/tuan), khac cac report con lai (dong = 1 ban ghi giao dich).
  3: ['', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'],
  4: ['', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'],
  5: ['', 'Tuần 1', 'Tuần 2', 'Tuần 3', 'Tuần 4', 'Tuần 5', 'Tổng'],
  6: ['', 'Tuần 1', 'Tuần 2', 'Tuần 3', 'Tuần 4', 'Tuần 5', 'Tổng'],
  7: ['Tên dịch vụ', 'Ngày thanh toán', 'Thời điểm', 'Số lượng', 'Số tiền', 'Nhân viên'],
  8: ['Tên dịch vụ', 'Ngày thanh toán', 'Thời điểm', 'Số lượng', 'Số tiền', 'Nhân viên'],
  11: ['Tên máy', 'Ngày', 'Người sử dụng', 'Thời gian (phút)', 'Phí thời gian'],
  12: ['Tên đăng nhập', 'Ngày', 'Thời điểm', 'Thời gian (phút)', 'Ghi chú', 'Nhân viên'],
  13: ['Tên đăng nhập', 'Ngày', 'Thời điểm', 'Số tiền tặng', 'Ghi chú', 'Nhân viên'],
  15: ['Tên đăng nhập', 'Tên', 'Họ', 'Điện thoại', 'Công nợ', 'Nợ dịch vụ', 'Tổng cộng'],
  25: ['Mệnh giá', 'Ngày thanh khoản', 'Thời điểm', 'Số lượng', 'Số tiền', 'Nhân viên'],
  26: ['Mệnh giá', 'Ngày thanh khoản', 'Thời điểm', 'Số lượng', 'Số tiền', 'Nhân viên'],
  31: ['Tên đăng nhập', 'Tên', 'Họ', 'Điện thoại', 'Tổng thời gian (phút)', 'Tổng tiền'],
  32: ['Tên đăng nhập', 'Ngày', 'Thời điểm', 'Số tiền', 'Phương thức', 'Nhân viên', 'Ghi chú'],
  // Thu tu cot PHAI khop thu tu jsonRow.add() trong Ver20_Income() (ReportUtils.cpp:5384-5396):
  // UserName, Ngay, ThoiDiem, revenue_desc, Amount, method_desc, StaffUserName, revenue(so, an),
  // VoucherId. Cot "Số nguồn thu" (idx 7) la gia tri so dung de tinh nhanh o client, KHONG hien
  // thi -- xem HIDDEN_COLUMN_INDEXES ben duoi (khong duoc xoa khoi mang nay vi se lech vi tri voi data).
  41: ['Tên đăng nhập', 'Ngày', 'Thời điểm', 'Nguồn thu', 'Số tiền', 'Phương thức', 'Nhân viên', 'Số nguồn thu', 'Giao dịch'],
  42: ['Nhân viên', 'Tiền nạp hội viên', 'Tiền giờ khách vãng lai', 'Combo', 'Thẻ nạp tiền', 'Tiền dịch vụ (FNet)', 'Công nợ (trả nợ)', 'Doanh thu [Tiền mặt]', 'Doanh thu [Chuyển khoản]', 'Doanh thu [QR]', 'Doanh thu tổng'],
  43: ['Nguồn thu', 'Tổng đơn', 'Doanh thu [Tiền mặt]', 'Doanh thu [Chuyển khoản]', 'Doanh thu [QR]', 'Doanh thu tổng'],
}

// Cot co trong data (dung de map dung vi tri gia tri) nhung KHONG hien thi ra bang -- vd cot so
// lieu dung de tinh nhanh o backend/frontend, khong phai thong tin cho nguoi dung xem.
const HIDDEN_COLUMN_INDEXES: Record<number, number[]> = {
  41: [7], // "Số nguồn thu" trong REPORT_COLUMNS[41]
}

// WEEKLY/MONTHLY CASH (ALL): bang pivot co dinh 6 dong theo loai tien (user chot 2026-09-29).
// LUON hien du 6 dong ke ca khi du lieu backend tra ve it dong hon -- dong thieu de trong o.
const ROW_LABELED_REPORTS: Record<number, string[]> = {
  3: ['Phí thời gian', 'Phí dịch vụ', 'Số tiền đã tặng', 'Thời gian miễn phí', 'Thời gian sử dụng', 'Doanh thu'],
  4: ['Phí thời gian', 'Phí dịch vụ', 'Số tiền đã tặng', 'Thời gian miễn phí', 'Thời gian sử dụng', 'Doanh thu'],
  5: ['Phí thời gian', 'Phí dịch vụ', 'Số tiền đã tặng', 'Thời gian miễn phí', 'Thời gian sử dụng', 'Doanh thu'],
  6: ['Phí thời gian', 'Phí dịch vụ', 'Số tiền đã tặng', 'Thời gian miễn phí', 'Thời gian sử dụng', 'Doanh thu'],
}

export function DynamicReportPage() {
  const [reportType, setReportType] = useState<number>(43)
  const [fromDate, setFromDate] = useState(getToday())
  const [toDate, setToDate] = useState(getToday())

  const reportQuery = useQuery({
    queryKey: ['dynamic-report', reportType, fromDate, toDate],
    queryFn: async () => {
      const res = await fetchDynamicReport({
        type: reportType,
        from_date: fromDate,
        to_date: toDate,
        from_time: '00:00:00',
        to_time: '23:59:59',
        staffid: 0, // 0 means all staff.
      })
      
      // fetchDynamicReport returns result.data directly, which is already an array or object
      return res
    },
    retry: false,
  })

  // Helper to render a single table from an array of objects or array of arrays.
  // fixedColumns (khi co): dung ten cot co dinh + LUON hien header du khi dataArray rong --
  // map gia tri theo VI TRI (Object.values/row[]), khong theo ten key JSON (key JSON la ten
  // bien C++ noi bo, khong phai ten cot nguoi dung xem, xem REPORT_COLUMNS o tren).
  const renderTable = (dataArray: any[], title?: string, fixedColumns?: string[], rowLabels?: string[], hiddenIndexes?: number[]) => {
    // Bang pivot (WEEKLY/MONTHLY CASH): dong co dinh theo rowLabels, cot dau tien la ten dong
    // (header rong), cac cot con lai lay tu fixedColumns[1..]. Luon du so dong ke ca thieu data.
    if (rowLabels && fixedColumns) {
      const dataColumns = fixedColumns.slice(1)
      return (
        <div className="table-card" style={{ marginBottom: '24px', overflowX: 'auto' }}>
          {title && <h3 className="endpoint-title" style={{ padding: '16px 16px 0' }}>{title}</h3>}
          <table className="data-table" style={{ whiteSpace: 'nowrap' }}>
            <thead>
              <tr>
                {fixedColumns.map((h, i) => (
                  <th key={i}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rowLabels.map((label, rowIdx) => {
                const row = Array.isArray(dataArray) ? dataArray[rowIdx] : undefined
                const values: any[] = row ? (Array.isArray(row) ? row : Object.values(row)) : []
                return (
                  <tr key={rowIdx}>
                    <td>{label}</td>
                    {dataColumns.map((_, colIdx) => (
                      <td key={colIdx}>{String(values[colIdx] ?? '')}</td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )
    }

    const hasData = Array.isArray(dataArray) && dataArray.length > 0
    if (!hasData && !fixedColumns) {
      return (
        <div className="table-card" style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
          {title && <h3 className="endpoint-title">{title}</h3>}
          Chưa có dữ liệu
        </div>
      )
    }

    const firstRow = hasData ? dataArray[0] : undefined
    const isArrayOfArrays = Array.isArray(firstRow)
    const allHeaders = fixedColumns
      ?? (isArrayOfArrays
        ? Array.from({ length: firstRow.length }).map((_, i) => `Cột ${i + 1}`)
        : Object.keys(firstRow))
    // hiddenIndexes chi ap dung khi co fixedColumns (vi tri gia tri co dinh, biet chac cot nao
    // la du lieu tinh toan noi bo khong danh hien thi) -- giu nguyen vi tri goc de doi chieu voi
    // values[], chi loc ra luc build headers hien thi va luc doc gia tri tung dong ben duoi.
    const visibleIdx = fixedColumns
      ? allHeaders.map((_, i) => i).filter((i) => !hiddenIndexes?.includes(i))
      : allHeaders.map((_, i) => i)
    const headers = fixedColumns ? visibleIdx.map((i) => allHeaders[i]) : allHeaders

    return (
      <div className="table-card" style={{ marginBottom: '24px', overflowX: 'auto' }}>
        {title && <h3 className="endpoint-title" style={{ padding: '16px 16px 0' }}>{title}</h3>}
        <table className="data-table" style={{ whiteSpace: 'nowrap' }}>
          <thead>
            <tr>
              {headers.map((h, i) => (
                <th key={i}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!hasData ? (
              <tr>
                <td colSpan={headers.length} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                  Chưa có dữ liệu
                </td>
              </tr>
            ) : (
              dataArray.map((row, idx) => {
                const values: any[] = fixedColumns
                  ? (Array.isArray(row) ? row : Object.values(row))
                  : []
                return (
                  <tr key={idx}>
                    {fixedColumns ? (
                      headers.map((_, i) => (
                        <td key={i}>{String(values[visibleIdx[i]] ?? '')}</td>
                      ))
                    ) : isArrayOfArrays ? (
                      row.map((cell: any, cellIdx: number) => (
                        <td key={cellIdx}>{String(cell ?? '')}</td>
                      ))
                    ) : (
                      headers.map((h, i) => (
                        <td key={i}>{String(row[h] ?? '')}</td>
                      ))
                    )}
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    )
  }

  const renderContent = () => {
    if (reportQuery.isLoading) return <p className="status-text">Đang tải báo cáo...</p>
    if (reportQuery.isError) return <p className="status-text error-text">Lỗi: {(reportQuery.error as Error).message}</p>
    
    const data = reportQuery.data
    const fixedColumns = REPORT_COLUMNS[reportType]
    const hiddenIndexes = HIDDEN_COLUMN_INDEXES[reportType]
    const rowLabels = ROW_LABELED_REPORTS[reportType]
    if (rowLabels) return renderTable(Array.isArray(data) ? data : [], undefined, fixedColumns, rowLabels)
    if (!data) {
      if (fixedColumns) return renderTable([], undefined, fixedColumns, undefined, hiddenIndexes)
      return <p className="status-text">Chưa có dữ liệu</p>
    }

    if (Array.isArray(data)) {
      return renderTable(data, undefined, fixedColumns, undefined, hiddenIndexes)
    }

    if (typeof data === 'object') {
      // It might be an object with multiple arrays (multiple tables)
      return (
        <div>
          {Object.entries(data).map(([key, value]) => {
            if (Array.isArray(value)) {
              return renderTable(value, key, fixedColumns, undefined, hiddenIndexes)
            }
            return (
              <div key={key} style={{ marginBottom: '16px' }}>
                <strong>{key}:</strong> {String(value)}
              </div>
            )
          })}
        </div>
      )
    }

    // Fallback if data is raw string
    return (
      <pre style={{ background: 'var(--bg-input)', padding: '16px', borderRadius: '8px', overflowX: 'auto' }}>
        {typeof data === 'string' ? data : JSON.stringify(data, null, 2)}
      </pre>
    )
  }

  return (
    <section className="page-card">
      <div className="page-header">
        <div>
          <p className="eyebrow">Báo cáo đa năng</p>
          <h2 className="section-title">Dynamic Reports (/rptv2)</h2>
        </div>
      </div>

      <div className="toolbar-grid toolbar-grid-3">
        <label className="field compact-field">
          <span>Loại báo cáo</span>
          <Select
            value={reportType}
            onChange={(e) => setReportType(Number(e.target.value))}
          >
            {REPORT_TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </Select>
        </label>
        <DateRangePicker
          fromDate={fromDate}
          toDate={toDate}
          onFromDateChange={setFromDate}
          onToDateChange={setToDate}
        />
      </div>

      <div style={{ marginTop: '24px' }}>
        {renderContent()}
      </div>
    </section>
  )
}
