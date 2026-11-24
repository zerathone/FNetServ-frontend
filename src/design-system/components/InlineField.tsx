import type { ReactNode } from 'react'

/** Nội dung ô tiền tố: icon + tên trường (chữ luôn hiện để dễ hiểu, không chỉ dựa vào icon). */
export function InlineFieldLabel({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <span className="ds-inline-field__text">
      {icon}
      <span>{text}</span>
    </span>
  )
}

/**
 * Ô "nhãn + control" trên MỘT dòng (cùng kiểu form thêm hội viên, dựa trên ds-input-group): ô tiền tố gồm icon + tên
 * trường, control (combo / input) nằm bên phải trong cùng một khung viền. Dùng cho các dòng nhập lặp lại (mỗi dòng
 * nhiều trường) để khỏi cần hàng tiêu đề cột. `title` hiện khi rê chuột — dùng để giải thích nhãn rút gọn.
 */
export function InlineField({
  label,
  icon,
  title,
  children,
}: {
  label: string
  icon: ReactNode
  title?: string
  children: ReactNode
}) {
  return (
    <div className="ds-input-group ds-inline-field" title={title}>
      <span className="ds-input-group-separator ds-inline-field__label">
        <InlineFieldLabel icon={icon} text={label} />
      </span>
      {children}
    </div>
  )
}
