// Hiển thị kết quả /rptv2 — tách từ DynamicReportPage để các trang báo cáo gộp (features/reports)
// và DynamicReportPage dùng chung MỘT bản. Hằng số cột nằm ở reportColumns.ts.
import { HIDDEN_COLUMN_INDEXES, REPORT_COLUMNS, ROW_LABELED_REPORTS, V41_PIVOT_COLUMNS } from './reportColumns'

type DataRow = unknown[] | Record<string, unknown>

function cellText(value: unknown) {
  return String(value ?? '')
}

function rowValues(row: DataRow): unknown[] {
  return Array.isArray(row) ? row : Object.values(row)
}

type TableProps = {
  dataArray: DataRow[]
  title?: string
  fixedColumns?: string[]
  rowLabels?: string[]
  hiddenIndexes?: number[]
}

// Render mot bang tu mang object hoac mang mang.
// fixedColumns (khi co): dung ten cot co dinh + LUON hien header du khi dataArray rong --
// map gia tri theo VI TRI (Object.values/row[]), khong theo ten key JSON (key JSON la ten
// bien C++ noi bo, khong phai ten cot nguoi dung xem, xem REPORT_COLUMNS o tren).
function ReportTable({ dataArray, title, fixedColumns, rowLabels, hiddenIndexes }: TableProps) {
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
              const values = row ? rowValues(row) : []
              return (
                <tr key={rowIdx}>
                  <td>{label}</td>
                  {dataColumns.map((_, colIdx) => (
                    <td key={colIdx}>{cellText(values[colIdx])}</td>
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
  const allHeaders: string[] = fixedColumns
    ?? (isArrayOfArrays
      ? Array.from({ length: (firstRow as unknown[]).length }).map((_, i) => `Cột ${i + 1}`)
      : Object.keys((firstRow ?? {}) as Record<string, unknown>))
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
            dataArray.map((row, idx) => (
              <tr key={idx}>
                {fixedColumns ? (
                  headers.map((_, i) => <td key={i}>{cellText(rowValues(row)[visibleIdx[i]])}</td>)
                ) : isArrayOfArrays ? (
                  (row as unknown[]).map((cell, cellIdx) => <td key={cellIdx}>{cellText(cell)}</td>)
                ) : (
                  headers.map((h, i) => <td key={i}>{cellText((row as Record<string, unknown>)[h])}</td>)
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

type ResultViewProps = {
  type: number
  /** Chi co nghia voi type 41 (0 hang ngay, 1 hang tuan, 2 hang thang). */
  timeDisplay?: number
  data: unknown
}

export function ReportResultView({ type, timeDisplay = 0, data }: ResultViewProps) {
  const isV41Pivot = type === 41 && (timeDisplay === 1 || timeDisplay === 2)
  const fixedColumns = isV41Pivot ? V41_PIVOT_COLUMNS[timeDisplay] : REPORT_COLUMNS[type]
  const hiddenIndexes = isV41Pivot ? undefined : HIDDEN_COLUMN_INDEXES[type]
  const rowLabels = ROW_LABELED_REPORTS[type]

  if (rowLabels) {
    return <ReportTable dataArray={Array.isArray(data) ? (data as DataRow[]) : []} fixedColumns={fixedColumns} rowLabels={rowLabels} />
  }
  if (!data) {
    if (fixedColumns) return <ReportTable dataArray={[]} fixedColumns={fixedColumns} hiddenIndexes={hiddenIndexes} />
    return <p className="status-text">Chưa có dữ liệu</p>
  }

  if (Array.isArray(data)) {
    return <ReportTable dataArray={data as DataRow[]} fixedColumns={fixedColumns} hiddenIndexes={hiddenIndexes} />
  }

  if (typeof data === 'object') {
    // Co the la object nhieu mang (nhieu bang) -- vd dashboard 34-40.
    return (
      <div>
        {Object.entries(data as Record<string, unknown>).map(([key, value]) => {
          if (Array.isArray(value)) {
            return (
              <ReportTable
                key={key}
                dataArray={value as DataRow[]}
                title={key}
                fixedColumns={fixedColumns}
                hiddenIndexes={hiddenIndexes}
              />
            )
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
