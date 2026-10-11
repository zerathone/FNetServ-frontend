import type { SVGProps } from 'react'

type CallBellIconProps = Omit<SVGProps<SVGSVGElement>, 'width' | 'height'> & { size?: number }

/**
 * Icon chuong goi phuc vu (call bell). Phosphor khong co icon nay va du an chi cho
 * dung Phosphor, nen ve SVG inline cung phong cach net (stroke, bo tron, currentColor).
 */
export function CallBellIcon({ size = 18, ...props }: CallBellIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M3 20h18" />
      <path d="M4.5 17a7.5 7.5 0 0 1 15 0" />
      <path d="M12 6.5v2.5" />
      <path d="M10 6.5h4" />
    </svg>
  )
}
