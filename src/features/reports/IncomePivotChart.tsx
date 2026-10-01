// Grouped bar chart SVG thuần cho income-summary tuần/tháng (type 41, time_display 1 hoặc 2).
//
// Thay thế stacked bar: mỗi nhóm X (thứ/tuần) gồm N bar nhỏ đặt cạnh nhau,
// tất cả đều bắt đầu từ baseline 0 → so sánh được TỪNG nguồn thu theo thời gian
// VÀ so sánh được các nguồn thu với nhau trong cùng một ngày/tuần.
//
// Data layout (Ver20_IncomeWeekly / Ver20_IncomeMonthly):
//   7 rows cố định: row[i][0] = tên nguồn thu, row[i][1..N] = giá trị
//   Row 0-5 = nguồn thu thực; Row 6 = "Doanh thu" (tổng) → bỏ khỏi chart
//   time_display=1 (tuần) : N=7 → Thứ 2 … Chủ nhật
//   time_display=2 (tháng): N=5 → Tuần 1 … Tuần 5

import { useMemo } from 'react'

// ─── Màu cho 6 nguồn thu ──────────────────────────────────────────────────────
const SOURCE_COLORS = [
  '#6366f1', // Nạp hội viên   — indigo
  '#22d3ee', // Khách vãng lai — cyan
  '#f59e0b', // Combo          — amber
  '#10b981', // Thẻ nạp tiền  — emerald
  '#ec4899', // Dịch vụ [FNet] — pink
  '#8b5cf6', // Công nợ        — violet
]

const WEEKLY_LABELS  = ['T.2', 'T.3', 'T.4', 'T.5', 'T.6', 'T.7', 'C.N']
const MONTHLY_LABELS = ['Tuần 1', 'Tuần 2', 'Tuần 3', 'Tuần 4', 'Tuần 5']

function parseNum(v: unknown): number {
  if (typeof v === 'number') return v
  if (typeof v === 'string') return parseFloat(v) || 0
  return 0
}

function fmt(v: number): string {
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'tr'
  if (v >= 1_000)     return (v / 1_000).toFixed(0) + 'k'
  return String(Math.round(v))
}

interface Source {
  name:   string
  color:  string
  values: number[]   // values[ci] = giá trị tại cột thời gian ci
}

interface ChartData {
  xLabels:   string[]
  sources:   Source[]
  colTotals: number[]  // tổng tất cả nguồn thu theo từng cột
  maxVal:    number    // max của colTotals (để scale trục Y)
}

function buildChartData(data: unknown, timeDisplay: number): ChartData | null {
  if (!Array.isArray(data) || data.length < 6) return null

  const xLabels = timeDisplay === 1 ? WEEKLY_LABELS : MONTHLY_LABELS
  const numCols = xLabels.length

  const sources: Source[] = []

  for (let r = 0; r < 6; r++) {
    const row = data[r]
    if (!Array.isArray(row)) continue
    const name = String(row[0] ?? `Nguồn #${r}`)
    const values: number[] = []
    for (let c = 1; c <= numCols; c++) {
      values.push(parseNum(row[c]))
    }
    sources.push({ name, color: SOURCE_COLORS[r] ?? '#aaa', values })
  }

  // Tổng mỗi cột = basis cho backdrop bar + scale trục Y
  const colTotals = Array.from({ length: numCols }, (_, ci) =>
    sources.reduce((s, src) => s + (src.values[ci] ?? 0), 0),
  )
  const maxVal = Math.max(...colTotals, 1)

  if (maxVal === 0) return null
  return { xLabels, sources, colTotals, maxVal }
}

// ─── SVG dimensions ───────────────────────────────────────────────────────────
const SVG_W   = 780
const SVG_H   = 280
const PAD_L   = 52
const PAD_R   = 12
const PAD_T   = 20
const PAD_B   = 44
const CHART_W = SVG_W - PAD_L - PAD_R
const CHART_H = SVG_H - PAD_T - PAD_B

// ─── Grouped Bar Chart ────────────────────────────────────────────────────────
function GroupedBarChart({ chartData }: { chartData: ChartData }) {
  const { xLabels, sources, colTotals, maxVal } = chartData
  const numGroups  = xLabels.length
  const numSources = sources.length

  // Làm tròn maxVal lên mức đẹp
  const magnitude = Math.pow(10, Math.floor(Math.log10(maxVal)))
  const niceMax   = Math.ceil(maxVal / magnitude) * magnitude
  const gridCount = 4
  const gridStep  = niceMax / gridCount

  const groupW    = CHART_W / numGroups          // width mỗi nhóm X
  const barPad    = groupW * 0.12                // padding 2 bên nhóm
  const barW      = (groupW - barPad * 2) / numSources
  const groupX    = (gi: number) => PAD_L + gi * groupW
  const barX      = (gi: number, si: number) => groupX(gi) + barPad + si * barW
  const toY       = (v: number) => PAD_T + CHART_H * (1 - v / niceMax)
  const toH       = (v: number) => CHART_H * (v / niceMax)

  const baselineY = PAD_T + CHART_H

  return (
    <svg
      viewBox={`0 0 ${SVG_W} ${SVG_H}`}
      style={{ width: '100%', maxWidth: SVG_W, height: 'auto', display: 'block' }}
      aria-label="Biểu đồ doanh thu theo nguồn thu (grouped)"
    >
      {/* Grid lines + Y labels */}
      {Array.from({ length: gridCount + 1 }, (_, i) => {
        const v = gridStep * i
        const y = toY(v)
        return (
          <g key={i}>
            <line
              x1={PAD_L} y1={y} x2={PAD_L + CHART_W} y2={y}
              stroke="var(--color-border-default, #e2e8f0)"
              strokeWidth={i === 0 ? 1.5 : 0.8}
              strokeDasharray={i === 0 ? undefined : '4 3'}
            />
            <text
              x={PAD_L - 6} y={y + 4}
              textAnchor="end"
              fontSize={10}
              fill="var(--color-text-muted, #94a3b8)"
              fontFamily="inherit"
            >
              {fmt(v)}
            </text>
          </g>
        )
      })}

      {/* Group divider lines (mờ) */}
      {xLabels.map((_, gi) => (
        <line
          key={gi}
          x1={groupX(gi)} y1={PAD_T}
          x2={groupX(gi)} y2={baselineY}
          stroke="var(--color-border-subtle, #f1f5f9)"
          strokeWidth={1}
        />
      ))}

      {/* Bars */}
      {xLabels.map((label, gi) => {
        const total = colTotals[gi] ?? 0
        const totalH = toH(total)
        const totalY = toY(total)
        // Width của backdrop = toàn bộ nhóm trừ padding nhỏ 2 bên
        const backdropX = groupX(gi) + barPad * 0.5
        const backdropW = groupW - barPad
        const rx2 = Math.max(2, backdropW * 0.04)
        return (
        <g key={gi}>
          {/* Backdrop: bar tổng bao trùm phía sau, nền mờ + viền */}
          {total > 0 && (
            <>
              <path
                d={`M${backdropX + rx2},${totalY} h${backdropW - rx2 * 2} a${rx2},${rx2} 0 0 1 ${rx2},${rx2} v${totalH - rx2} h${-backdropW} v${-(totalH - rx2)} a${rx2},${rx2} 0 0 1 ${rx2},${-rx2} z`}
                fill="var(--color-text-muted, #94a3b8)"
                opacity={0.08}
              />
              <path
                d={`M${backdropX + rx2},${totalY} h${backdropW - rx2 * 2} a${rx2},${rx2} 0 0 1 ${rx2},${rx2} v${totalH - rx2} h${-backdropW} v${-(totalH - rx2)} a${rx2},${rx2} 0 0 1 ${rx2},${-rx2} z`}
                fill="none"
                stroke="var(--color-text-muted, #94a3b8)"
                strokeWidth={1}
                opacity={0.35}
              />
              {/* Label tổng trên đỉnh backdrop */}
              <text
                x={backdropX + backdropW / 2} y={totalY - 4}
                textAnchor="middle"
                fontSize={10}
                fontWeight={600}
                fill="var(--color-text-secondary, #64748b)"
                fontFamily="inherit"
              >
                {fmt(total)}
              </text>
            </>
          )}
          {/* Bars cho từng source */}
          {sources.map((src, si) => {
            const v = src.values[gi] ?? 0
            if (v <= 0) return null
            const bx = barX(gi, si)
            const bh = toH(v)
            const by = toY(v)
            const rx = Math.max(1, barW * 0.18)
            return (
              <g key={src.name}>
                {/* Bar với bo góc trên */}
                <path
                  d={`M${bx + rx},${by} h${barW - rx * 2} a${rx},${rx} 0 0 1 ${rx},${rx} v${bh - rx} h${-barW} v${-(bh - rx)} a${rx},${rx} 0 0 1 ${rx},${-rx} z`}
                  fill={src.color}
                  opacity={0.82}
                >
                  <title>{`${src.name}: ${new Intl.NumberFormat('vi-VN').format(v)} đ`}</title>
                </path>
                {/* Giá trị trên đầu mỗi bar — luôn hiện */}
                {v > 0 && (
                  <text
                    x={bx + barW / 2} y={by - 3}
                    textAnchor="middle"
                    fontSize={9}
                    fontWeight={600}
                    fill={src.color}
                    opacity={0.9}
                    fontFamily="inherit"
                  >
                    {fmt(v)}
                  </text>
                )}
              </g>
            )
          })}

          {/* X-axis label (tên nhóm) */}
          <text
            x={groupX(gi) + groupW / 2}
            y={baselineY + 16}
            textAnchor="middle"
            fontSize={11}
            fontWeight={600}
            fill="var(--color-text-secondary, #64748b)"
            fontFamily="inherit"
          >
            {label}
          </text>
        </g>
        )
      })}

      {/* Trục Y */}
      <line
        x1={PAD_L} y1={PAD_T}
        x2={PAD_L} y2={baselineY}
        stroke="var(--color-border-default, #e2e8f0)"
        strokeWidth={1.5}
      />
      {/* Trục X */}
      <line
        x1={PAD_L} y1={baselineY}
        x2={PAD_L + CHART_W} y2={baselineY}
        stroke="var(--color-border-default, #e2e8f0)"
        strokeWidth={1.5}
      />
    </svg>
  )
}

// ─── Tổng theo nguồn thu: bar ngang xếp cao → thấp (cùng giá trị với cột "Tổng" ở bảng) ──────
const VND = new Intl.NumberFormat('vi-VN')

function TotalsBarChart({ sources }: { sources: Source[] }) {
  const rows = sources
    .map((s) => ({
      name:  s.name,
      color: s.color,
      total: Math.round(s.values.reduce((a, b) => a + b, 0) * 100) / 100,
    }))
    .sort((a, b) => b.total - a.total)
  const grand = rows.reduce((a, r) => a + r.total, 0)
  const maxTotal = Math.max(...rows.map((r) => r.total), 0)

  return (
    <div style={{ flex: '0 1 380px', minWidth: 280, display: 'grid', gap: 12, alignContent: 'start' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted, #94a3b8)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Tổng
        </span>
        <span style={{ fontSize: 20, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-primary, #0f172a)' }}>
          {VND.format(grand)}
        </span>
      </div>

      <div style={{ display: 'grid', gap: 10 }} role="list" aria-label="Tổng doanh thu theo nguồn thu">
        {rows.map((r) => {
          // Độ dài bar theo nguồn lớn nhất (bar đầu luôn đầy) để các chênh lệch nhỏ vẫn nhìn rõ.
          const width = maxTotal > 0 ? (r.total / maxTotal) * 100 : 0
          const pct = grand > 0 ? (r.total / grand) * 100 : 0
          return (
            <div
              key={r.name}
              role="listitem"
              title={`${r.name}: ${VND.format(r.total)} đ (${pct.toFixed(1)}%)`}
              style={{ display: 'grid', gap: 4 }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12 }}>
                <span style={{ color: 'var(--color-text-secondary, #64748b)', fontWeight: 600 }}>{r.name}</span>
                <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500, color: 'var(--color-text-primary, #0f172a)' }}>
                  {VND.format(r.total)}
                  <span style={{ marginLeft: 8, fontWeight: 600, color: 'var(--color-text-muted, #94a3b8)' }}>
                    {pct.toFixed(1)}%
                  </span>
                </span>
              </div>
              <div style={{ height: 10, borderRadius: 5, background: 'var(--color-border-subtle, #f1f5f9)', overflow: 'hidden' }}>
                <div style={{ width: `${width}%`, height: '100%', borderRadius: 5, background: r.color, opacity: 0.85 }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Legend ───────────────────────────────────────────────────────────────────
function Legend({ sources }: { sources: Source[] }) {
  return (
    <div style={{
      display:        'flex',
      flexWrap:       'wrap',
      gap:            '6px 18px',
      padding:        '10px 0 0',
      justifyContent: 'center',
    }}>
      {sources.map((src) => (
        <div key={src.name} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            display:     'inline-block',
            width:       10,
            height:      10,
            borderRadius: 2,
            background:  src.color,
            opacity:     0.85,
            flexShrink:  0,
          }} />
          <span style={{
            fontSize:   12,
            color:      'var(--color-text-secondary, #64748b)',
            fontWeight: 600,
            whiteSpace: 'nowrap',
          }}>
            {src.name}
          </span>
        </div>
      ))}
    </div>
  )
}

// ─── Export ───────────────────────────────────────────────────────────────────
interface Props {
  data:        unknown
  timeDisplay: number   // 1 = tuần, 2 = tháng
}

export function IncomePivotChart({ data, timeDisplay }: Props) {
  const chartData = useMemo(
    () => buildChartData(data, timeDisplay),
    [data, timeDisplay],
  )

  if (!chartData) return null

  const title = timeDisplay === 1
    ? 'Doanh thu theo thứ trong tuần'
    : 'Doanh thu theo tuần trong tháng'

  return (
    <div style={{
      marginBottom: 24,
      padding:      'var(--space-3)',
      border:       '1px solid var(--color-border-default)',
      borderRadius: 'var(--radius-lg)',
      background:   'var(--color-surface-raised)',
    }}>
      <p style={{
        margin:          '0 0 12px',
        fontSize:        'var(--font-size-sm)',
        fontWeight:      600,
        textTransform:   'uppercase',
        letterSpacing:   '0.05em',
        color:           'var(--color-text-muted)',
      }}>
        {title}
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-4, 24px)', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 420px', minWidth: 0 }}>
          <GroupedBarChart chartData={chartData} />
          <Legend sources={chartData.sources} />
        </div>
        <TotalsBarChart sources={chartData.sources} />
      </div>
    </div>
  )
}
