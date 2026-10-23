// Khoá cuộn của trang khi có Dialog/Drawer mở. Dùng bộ đếm dùng chung: nhiều lớp phủ có thể chồng nhau và
// đóng KHÔNG theo thứ tự ngược; nếu mỗi lớp tự "nhớ rồi khôi phục" overflow thì lớp đóng sau sẽ khôi phục về
// 'hidden' do lớp kia để lại -> trang dài ra mà không cuộn được nữa.
let lockCount = 0
let savedOverflow = ''

export function lockBodyScroll(): () => void {
  if (lockCount === 0) {
    savedOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  lockCount += 1

  let released = false
  return () => {
    if (released) return
    released = true
    lockCount -= 1
    if (lockCount === 0) document.body.style.overflow = savedOverflow
  }
}
