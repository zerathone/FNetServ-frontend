import type { SVGProps } from 'react'

type Props = Omit<SVGProps<SVGSVGElement>, 'width' | 'height'> & { size?: number }

/**
 * Icon "sửa tài khoản": người (đầu + vai) kèm cây bút chéo, dạng đặc theo `currentColor`.
 * Phosphor không có biến thể "người + bút" nên vẽ riêng (viewBox 24, vai bị cắt chéo song song với thân bút để chừa khe).
 */
export function UserEditIcon({ size = 24, ...props }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth={0.4}
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {/* đầu */}
      <circle cx="9.5" cy="7" r="3.8" stroke="none" />
      {/* vai, cạnh phải cắt chéo 45° */}
      <path d="M2.5 20.5V18C2.5 15.6 5.6 14 9.5 14c.8 0 1.5.1 2.2.2L8.5 17.4v3.1z" stroke="none" />
      {/* thân bút + mũi bút */}
      <polygon points="10,20.2 13.6,19.28 20.14,12.74 17.46,10.06 10.92,16.6" />
      {/* đầu bút (tách khỏi thân bằng một khe nhỏ) */}
      <polygon points="20.71,12.17 21.84,11.04 19.16,8.36 18.03,9.49" />
    </svg>
  )
}
