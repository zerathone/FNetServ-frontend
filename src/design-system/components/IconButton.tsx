import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Button, type ButtonVariant } from './Button'

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  label: string
  icon: ReactNode
  variant?: ButtonVariant
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, variant = 'ghost', className = '', ...props },
  ref,
) {
  return (
    <Button
      ref={ref}
      variant={variant}
      className={`ds-icon-button ${className}`.trim()}
      aria-label={label}
      title={label}
      {...props}
    >
      <span aria-hidden="true">{icon}</span>
    </Button>
  )
})
