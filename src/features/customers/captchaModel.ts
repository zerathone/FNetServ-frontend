// Mã kiểm tra (captcha) chống thao tác máy móc khi mở khóa sửa tên đăng nhập — parity MFC `CCaptchaInputDlg`:
// ảnh sinh ngay trên máy, so sánh cục bộ, sai tối đa 3 lần thì đóng. Đây là rào chống bấm nhầm / công cụ tự động
// thao tác giao diện, KHÔNG phải kiểm soát bảo mật phía máy chủ (PUT /user vẫn do quyền 221 quyết định).

export const CAPTCHA_LENGTH = 5
export const CAPTCHA_MAX_ATTEMPTS = 3

// 32 ký tự (chia hết 256 ⇒ lấy `byte % 32` không lệch xác suất), bỏ các ký tự dễ nhầm: 0/O, 1/I.
export const CAPTCHA_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function randomBytes(count: number): Uint8Array {
  const bytes = new Uint8Array(count)
  crypto.getRandomValues(bytes)
  return bytes
}

export function generateCaptchaText(random: (count: number) => ArrayLike<number> = randomBytes): string {
  const bytes = random(CAPTCHA_LENGTH)
  let text = ''
  for (let index = 0; index < CAPTCHA_LENGTH; index += 1) {
    text += CAPTCHA_ALPHABET[bytes[index] % CAPTCHA_ALPHABET.length]
  }
  return text
}

/** Không phân biệt hoa/thường, bỏ khoảng trắng (kể cả giữa các ký tự khi người dùng gõ cách). */
export function isCaptchaMatch(expected: string, input: string): boolean {
  const normalize = (value: string) => value.replace(/\s+/g, '').toUpperCase()
  const typed = normalize(input)
  return typed.length > 0 && typed === normalize(expected)
}

/** Số lần thử còn lại sau `failedAttempts` lần sai (không âm). */
export function attemptsLeft(failedAttempts: number): number {
  return Math.max(0, CAPTCHA_MAX_ATTEMPTS - failedAttempts)
}
