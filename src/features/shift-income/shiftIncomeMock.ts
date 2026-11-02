// Dữ liệu GIẢ cho widget "Nguồn thu ca" ở sidebar — sửa thoải mái ở đây rồi xem kết quả trên UI.
//
// Bật mock (chỉ chạy `npm run dev`, không bao giờ vào bản build):
//   thêm vào `fnet-web/.env.development.local` (file *.local không commit) một dòng
//     VITE_SHIFT_INCOME_MOCK=1
//   rồi khởi động lại `npm run dev`. Bỏ dòng đó (hoặc đặt 0) để quay về server thật.
//
// Giá trị của VITE_SHIFT_INCOME_MOCK (để xem từng trạng thái của widget):
//   1        số liệu mẫu bên dưới (mặc định), KHÔNG có cấn trừ — đúng với server hiện tại (chỉ 3 hình thức)
//   deduct   như 1 nhưng CÓ thêm cột cấn trừ — để xem widget khi server thêm cột này vào báo cáo ca
//   empty    ca chưa thu đồng nào — mọi số bằng 0
//   error    server trả lỗi — widget hiện "Không tải được số liệu" + nút Thử lại
//   loading  không bao giờ trả về — widget kẹt ở khung xám đang tải
//   slow     như 1 nhưng trễ 3 giây
//
// Khi bật, widget KHÔNG gọi /rptv2 và KHÔNG kiểm tra quyền 931043 (để xem được bằng tài khoản bất kỳ).
// Dữ liệu trả về đúng dạng type 43 của server (7 dòng [tên, số lượt, tiền mặt, chuyển khoản, QR, tổng],
// giá trị là chuỗi) nên đi qua đúng buildShiftIncome như số thật.

interface MockSource {
  name: string
  count: number
  cash: number
  bank: number
  qr: number
  deduct: number
}

// Thứ tự = thứ tự 6 dòng nguồn thu của type 43: nạp hội viên, khách vãng lai, combo, thẻ nạp tiền, dịch vụ FNet,
// công nợ. Widget gộp 4 dòng (nạp hội viên, khách vãng lai, thẻ nạp tiền, công nợ) thành "Nạp tiền".
const MOCK_SOURCES: readonly MockSource[] = [
  { name: 'Tiền nạp hội viên', count: 86, cash: 2_800_000, bank: 1_500_000, qr: 4_000_000, deduct: 0 },
  { name: 'Tiền giờ Khách vãng lai', count: 41, cash: 1_200_000, bank: 300_000, qr: 900_000, deduct: 0 },
  { name: 'Combo', count: 30, cash: 420_000, bank: 600_000, qr: 900_000, deduct: 120_000 },
  { name: 'Thẻ nạp tiền', count: 12, cash: 500_000, bank: 0, qr: 500_000, deduct: 0 },
  { name: 'Dịch vụ [FNet]', count: 63, cash: 620_000, bank: 340_000, qr: 1_000_000, deduct: 260_000 },
  { name: 'Công nợ (Trả nợ)', count: 3, cash: 300_000, bank: 0, qr: 0, deduct: 0 },
]

/** withDeduct=false: đúng như server hiện tại (6 cột, KHÔNG có cấn trừ). */
function toRow(name: string, source: Omit<MockSource, 'name'>, withDeduct: boolean): string[] {
  const total = source.cash + source.bank + source.qr
  const row = [name, source.count, source.cash, source.bank, source.qr, total]
  return (withDeduct ? [...row, source.deduct] : row).map(String)
}

// Dòng tổng = cộng 6 dòng nguồn (đúng như server: PY_GUESS_SERVICE đã nằm trong dòng Dịch vụ [FNet]).
function createRows(sources: readonly MockSource[], withDeduct: boolean): string[][] {
  const sum = sources.reduce(
    (acc, s) => ({
      count: acc.count + s.count,
      cash: acc.cash + s.cash,
      bank: acc.bank + s.bank,
      qr: acc.qr + s.qr,
      deduct: acc.deduct + s.deduct,
    }),
    { count: 0, cash: 0, bank: 0, qr: 0, deduct: 0 },
  )
  return [...sources.map((s) => toRow(s.name, s, withDeduct)), toRow('Doanh thu', sum, withDeduct)]
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

/** Thay cho fetchDynamicReport({ type: 43, ... }) khi bật mock. */
export async function mockShiftIncomeRows(mode: string): Promise<unknown> {
  if (mode === 'loading') return new Promise<never>(() => {})
  await delay(mode === 'slow' ? 3000 : 250)
  if (mode === 'error') throw new Error('Mock: server trả lỗi')
  if (mode === 'empty') {
    const zero = { count: 0, cash: 0, bank: 0, qr: 0, deduct: 0 }
    return createRows(MOCK_SOURCES.map((s) => ({ ...s, ...zero })), true)
  }
  return createRows(MOCK_SOURCES, mode === 'deduct')
}
