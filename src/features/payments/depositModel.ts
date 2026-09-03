export type DepositMethod = 'cash' | 'transfer' | 'qr'

export type DepositMethodOption = {
  id: DepositMethod
  label: string
  description: string
}

export const DEPOSIT_METHOD_OPTIONS: DepositMethodOption[] = [
  {
    id: 'cash',
    label: 'Tiền mặt',
    description: 'Thu tiền tại quầy và cộng vào tài khoản chính.',
  },
  {
    id: 'transfer',
    label: 'Chuyển khoản',
    description: 'Nhân viên xác nhận khoản chuyển tại quầy.',
  },
  {
    id: 'qr',
    label: 'QR',
    description: 'Tạo mã QR và theo dõi kết quả bằng polling.',
  },
]

export function getDepositMethodOption(method: DepositMethod) {
  return DEPOSIT_METHOD_OPTIONS.find((option) => option.id === method)!
}

export function toDepositApiPaymentMethod(method: DepositMethod) {
  if (method === 'qr') {
    throw new Error('QR phải đi qua luồng /pyqr, không được ghi bằng /user/deposit.')
  }
  return method === 'transfer' ? ('bank_transfer' as const) : ('cash' as const)
}

export function canSubmitDeposit(
  method: DepositMethod,
  amount: number | null,
  allowNegative = false,
) {
  if (!amount) return false
  if (amount < 0) return allowNegative && method !== 'qr'
  return method !== 'qr' || amount >= 10_000
}

export function parseDepositMoneyUnits(value: string) {
  const parts = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

  if (parts.length === 0 || parts.length > 12) {
    return { units: [] as number[], error: 'Bảng mệnh giá phải có từ 1 đến 12 giá trị.' }
  }

  const units = parts.map(Number)
  if (
    units.some(
      (unit) =>
        !Number.isSafeInteger(unit) ||
        unit <= 0 ||
        unit > 2_147_483_647,
    )
  ) {
    return {
      units: [] as number[],
      error: 'Mỗi mệnh giá phải là số nguyên dương hợp lệ.',
    }
  }

  return { units, error: '' }
}

export function toggleDepositAmountSign(amount: number | null) {
  if (amount === null || amount === 0) return amount
  return -amount
}
