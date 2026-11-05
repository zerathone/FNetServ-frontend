import type { RefObject } from 'react'
import { CaretDown } from '@phosphor-icons/react'

type SearchListButtonProps = {
  /** Ô nhập có gắn `list="<datalist id>"` — nút sẽ focus ô này và mở danh sách gợi ý. */
  inputRef: RefObject<HTMLInputElement | null>
  label?: string
}

/**
 * Mũi tên mở danh sách gợi ý (datalist) của ô tìm kiếm — thay cho mũi tên gốc của trình duyệt (bị lệch xuống, không
 * canh được ổn định; đã ẩn bằng CSS `.ds-search-input .ds-input[list]::-webkit-calendar-picker-indicator`).
 * Cùng hàng, cùng kích thước ô với nút ✕ xóa (`ds-search-input__clear`) nên hai nút luôn thẳng hàng.
 */
export function SearchListButton({ inputRef, label = 'Chọn từ danh sách' }: SearchListButtonProps) {
  return (
    <button
      type="button"
      className="ds-search-input__list"
      aria-label={label}
      title={label}
      onClick={() => {
        const input = inputRef.current
        if (!input) return
        input.focus()
        try {
          input.showPicker()
        } catch {
          // Trình duyệt không hỗ trợ mở danh sách bằng mã: người dùng vẫn bấm phím ↓ trong ô được.
        }
      }}
    >
      <CaretDown size={14} weight="bold" aria-hidden="true" />
    </button>
  )
}
