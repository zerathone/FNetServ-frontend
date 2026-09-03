import type { RetentionSettings } from '../../api/settings'

export const DEFAULT_RETENTION_SETTINGS: RetentionSettings = {
  systemLogDays: 90,
  voucherDays: 90,
  webDays: 90,
  backupDays: 90,
  serverLogRecords: 0,
  usingLogDays: 90,
  warningLogDays: 90,
}

export const RETENTION_FIELDS: Array<{
  key: keyof RetentionSettings
  label: string
  max: number
  hint: string
}> = [
  { key: 'systemLogDays', label: 'Nhật ký hệ thống', max: 9_999, hint: 'ngày' },
  { key: 'voucherDays', label: 'Nhật ký thẻ nạp', max: 9_999, hint: 'ngày' },
  { key: 'webDays', label: 'Nhật ký website', max: 9_999, hint: 'ngày' },
  { key: 'backupDays', label: 'Nhật ký sao lưu', max: 9_999, hint: 'ngày' },
  { key: 'serverLogRecords', label: 'Nhật ký máy chủ', max: 99_999, hint: 'bản ghi' },
  { key: 'usingLogDays', label: 'Nhật ký sử dụng', max: 9_999, hint: 'ngày' },
  { key: 'warningLogDays', label: 'Nhật ký cảnh báo', max: 9_999, hint: 'ngày' },
]

export function validateSystemSettings(input: {
  retention: RetentionSettings
  roundingUnit: number
  priceMin: number | null
  priceMinForMember: number | null
  userDeductPriceMin: number | null
}) {
  for (const field of RETENTION_FIELDS) {
    const value = input.retention[field.key]
    if (!Number.isInteger(value) || value < 0 || value > field.max) {
      return `${field.label} phải là số nguyên từ 0 đến ${field.max.toLocaleString('vi-VN')} ${field.hint}`
    }
  }

  if (!Number.isInteger(input.roundingUnit) || input.roundingUnit <= 0 || input.roundingUnit % 2 !== 0) {
    return 'Đơn vị làm tròn phải là số chẵn dương.'
  }

  const moneyFields = [
    ['Mức nạp tối thiểu khách', input.priceMin],
    ['Mức nạp tối thiểu hội viên', input.priceMinForMember],
    ['Số dư tối thiểu để khấu trừ', input.userDeductPriceMin],
  ] as const
  for (const [label, value] of moneyFields) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 999_999) {
      return `${label} phải là số nguyên từ 0 đến 999.999 đ.`
    }
  }

  return null
}
