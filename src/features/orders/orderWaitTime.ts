// Thời gian khách đã chờ một đơn -- dùng chung cho thẻ đơn ở /orders và thẻ "Combo chờ duyệt" ở /combo_sale.

function waitMinutes(createdAtMs: number, now: number) {
  if (!createdAtMs) return null
  return Math.max(0, Math.floor((now - createdAtMs) / 60_000))
}

export function waitLabel(createdAtMs: number, now: number) {
  const minutes = waitMinutes(createdAtMs, now)
  if (minutes === null) return '–'
  if (minutes < 1) return 'vừa gọi'
  if (minutes < 60) return `${minutes}p`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h}g` : `${h}g ${m}p`
}

export function waitTone(createdAtMs: number, now: number): 'neutral' | 'info' | 'warning' | 'danger' {
  const minutes = waitMinutes(createdAtMs, now)
  if (minutes === null) return 'neutral'
  if (minutes >= 20) return 'danger'
  if (minutes >= 10) return 'warning'
  return 'info'
}
