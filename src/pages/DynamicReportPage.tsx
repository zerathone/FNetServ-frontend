import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchDynamicReport } from '../api/dynamic-reports'
import { Select } from '../design-system/components';

function getToday() {
  return new Date().toISOString().slice(0, 10)
}

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
  { id: 14, label: 'Báo cáo 14: ACCOUNT LIST' },
  { id: 15, label: 'Báo cáo 15: ACCOUNT DEBIT' },
  { id: 16, label: 'Báo cáo 16: AUTO ACCOUNT A4' },
  { id: 17, label: 'Báo cáo 17: AUTO ACCOUNT LESS' },
  { id: 18, label: 'Báo cáo 18: AUTO ACCOUNT A4 N' },
  { id: 19, label: 'Báo cáo 19: AUTO ACCOUNT POS58' },
  { id: 20, label: 'Báo cáo 20: AUTO ACCOUNT POS58 N' },
  { id: 21, label: 'Báo cáo 21: MONEY CARD A4' },
  { id: 22, label: 'Báo cáo 22: MONEY CARD A4 N' },
  { id: 23, label: 'Báo cáo 23: MONEY CARD POS58' },
  { id: 24, label: 'Báo cáo 24: MONEY CARD POS58 N' },
  { id: 25, label: 'Báo cáo 25: CARD RECHARGE IN DAY' },
  { id: 26, label: 'Báo cáo 26: CARD RECHARGE IN DAY ALL' },
  { id: 27, label: 'Báo cáo 27: CARD RECHARGE IN MONTH' },
  { id: 28, label: 'Báo cáo 28: CARD RECHARGE IN MONTH ALL' },
  { id: 29, label: 'Báo cáo 29: DAILY CASH ALL FOR EMAIL' },
  { id: 30, label: 'Báo cáo 30: PRICE APP RENT' },
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

  // Helper to render a single table from an array of objects or array of arrays
  const renderTable = (dataArray: any[], title?: string) => {
    if (!Array.isArray(dataArray) || dataArray.length === 0) {
      return (
        <div className="table-card" style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
          {title && <h3 className="endpoint-title">{title}</h3>}
          Chưa có dữ liệu
        </div>
      )
    }

    const firstRow = dataArray[0]
    const isArrayOfArrays = Array.isArray(firstRow)
    const headers = isArrayOfArrays 
      ? Array.from({ length: firstRow.length }).map((_, i) => `Cột ${i + 1}`) 
      : Object.keys(firstRow)

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
            {dataArray.map((row, idx) => (
              <tr key={idx}>
                {isArrayOfArrays ? (
                  row.map((cell: any, cellIdx: number) => (
                    <td key={cellIdx}>{String(cell ?? '')}</td>
                  ))
                ) : (
                  headers.map((h, i) => (
                    <td key={i}>{String(row[h] ?? '')}</td>
                  ))
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  const renderContent = () => {
    if (reportQuery.isLoading) return <p className="status-text">Đang tải báo cáo...</p>
    if (reportQuery.isError) return <p className="status-text error-text">Lỗi: {(reportQuery.error as Error).message}</p>
    
    const data = reportQuery.data
    if (!data) return <p className="status-text">Chưa có dữ liệu</p>

    if (Array.isArray(data)) {
      return renderTable(data)
    }

    if (typeof data === 'object') {
      // It might be an object with multiple arrays (multiple tables)
      return (
        <div>
          {Object.entries(data).map(([key, value]) => {
            if (Array.isArray(value)) {
              return renderTable(value, key)
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
            className="select-input"
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
        <label className="field compact-field">
          <span>Từ ngày</span>
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </label>
        <label className="field compact-field">
          <span>Đến ngày</span>
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </label>
      </div>

      <div style={{ marginTop: '24px' }}>
        {renderContent()}
      </div>
    </section>
  )
}
