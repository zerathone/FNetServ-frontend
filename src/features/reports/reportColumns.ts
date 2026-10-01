// Hang so ten cot/cot an/bang pivot cho ket qua /rptv2 -- tach khoi ReportResultView (component) de fast-refresh khong canh bao
// va de DynamicReportPage dung chung.

// Ten cot tieng Viet co dinh cho tung loai bao cao (user chot 2026-09-29) -- hien du ten cot
// ke ca khi chua co du lieu (khong dung Object.keys(row) nua vi row rong thi khong co key nao).
// 9/10/27/28/33 (them 2026-09-30, task web-report-params): thu tu cot doc tu jsonRow.add() /
// SELECT trong ReportUtils.cpp (ServiceInMonth*: 2621-2655/2743-2749, CardRechargeInMonth*: 3713, 3791).
export const REPORT_COLUMNS: Record<number, string[]> = {
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
  9: ['Tên dịch vụ', 'Ngày thanh toán', 'Thời điểm', 'Số lượng', 'Số tiền'],
  10: ['Tên dịch vụ', 'Ngày thanh toán', 'Thời điểm', 'Số lượng', 'Số tiền', 'Nhân viên'],
  11: ['Tên máy', 'Ngày', 'Người sử dụng', 'Thời gian (phút)', 'Phí thời gian'],
  12: ['Tên đăng nhập', 'Ngày', 'Thời điểm', 'Thời gian (phút)', 'Ghi chú', 'Nhân viên'],
  13: ['Tên đăng nhập', 'Ngày', 'Thời điểm', 'Số tiền tặng', 'Ghi chú', 'Nhân viên'],
  15: ['Tên đăng nhập', 'Tên', 'Họ', 'Điện thoại', 'Công nợ', 'Nợ dịch vụ', 'Tổng cộng'],
  25: ['Mệnh giá', 'Ngày thanh khoản', 'Thời điểm', 'Số lượng', 'Số tiền', 'Nhân viên'],
  26: ['Mệnh giá', 'Ngày thanh khoản', 'Thời điểm', 'Số lượng', 'Số tiền', 'Nhân viên'],
  27: ['Mệnh giá', 'Ngày thanh khoản', 'Thời điểm', 'Số lượng', 'Số tiền'],
  28: ['Mệnh giá', 'Ngày thanh khoản', 'Thời điểm', 'Số lượng', 'Số tiền', 'Nhân viên'],
  31: ['Tên đăng nhập', 'Tên', 'Họ', 'Điện thoại', 'Tổng thời gian (phút)', 'Tổng tiền'],
  32: ['Tên đăng nhập', 'Ngày', 'Thời điểm', 'Số tiền', 'Phương thức', 'Nhân viên', 'Ghi chú'],
  // 33 tra ve cung dang dong du lieu voi 32 (verify harness 2026-09-30: response 2 type giong het nhau).
  33: ['Tên đăng nhập', 'Ngày', 'Thời điểm', 'Số tiền', 'Phương thức', 'Nhân viên', 'Ghi chú'],
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
export const HIDDEN_COLUMN_INDEXES: Record<number, number[]> = {
  41: [7], // "Số nguồn thu" trong REPORT_COLUMNS[41]
}

// WEEKLY/MONTHLY CASH (ALL): bang pivot co dinh 6 dong theo loai tien (user chot 2026-09-29).
// LUON hien du 6 dong ke ca khi du lieu backend tra ve it dong hon -- dong thieu de trong o.
export const ROW_LABELED_REPORTS: Record<number, string[]> = {
  3: ['Phí thời gian', 'Phí dịch vụ', 'Số tiền đã tặng', 'Thời gian miễn phí', 'Thời gian sử dụng', 'Doanh thu'],
  4: ['Phí thời gian', 'Phí dịch vụ', 'Số tiền đã tặng', 'Thời gian miễn phí', 'Thời gian sử dụng', 'Doanh thu'],
  5: ['Phí thời gian', 'Phí dịch vụ', 'Số tiền đã tặng', 'Thời gian miễn phí', 'Thời gian sử dụng', 'Doanh thu'],
  6: ['Phí thời gian', 'Phí dịch vụ', 'Số tiền đã tặng', 'Thời gian miễn phí', 'Thời gian sử dụng', 'Doanh thu'],
}

// Type 41 tuan/thang (time_display 1/2): Ver20_IncomeWeekly/Monthly tra bang pivot 7 dong x (1 + 7 | 1 + 5)
// cot, NHAN DONG NAM O COT 0 CUA DATA (value[i][0]) -- khac loai 3-6 (nhan nam o FE). Vi vay KHONG dung
// ROW_LABELED_REPORTS o day (se prefix nhan lan thu hai).
export const V41_PIVOT_COLUMNS: Record<number, string[]> = {
  1: ['Nguồn thu', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'],
  2: ['Nguồn thu', 'Tuần 1', 'Tuần 2', 'Tuần 3', 'Tuần 4', 'Tuần 5'],
}

// Cot SO (vi tri trong data, tinh ca cot an) can ngan cach hang nghin khi hien thi. Chi liet ke cot thuc su
// la so tien/so luong/phut -- KHONG gom ngay, gio, ten dang nhap, dien thoai, ma giao dich (se bi chen dau cham).
// Bang pivot (3-6, 41 tuan/thang) khong can khai bao o day: moi cot du lieu deu la so (xem ReportResultView).
export const NUMERIC_COLUMN_INDEXES: Record<number, number[]> = {
  1: [3, 4, 5, 6],
  2: [3, 4, 5, 6],
  7: [3, 4],
  8: [3, 4],
  9: [3, 4],
  10: [3, 4],
  11: [3, 4],
  12: [3],
  13: [3],
  15: [4, 5, 6],
  25: [3, 4],
  26: [3, 4],
  27: [3, 4],
  28: [3, 4],
  31: [4, 5],
  32: [3],
  33: [3],
  41: [4],
  42: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  43: [1, 2, 3, 4, 5],
}