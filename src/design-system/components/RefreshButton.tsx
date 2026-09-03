import { ArrowsClockwise } from '@phosphor-icons/react'
import { Button, type ButtonProps } from './Button'

type RefreshButtonProps = Omit<ButtonProps, 'children' | 'type' | 'variant'> & {
  label?: string
}

/** Shared secondary action for refetching the data displayed by a workspace. */
export function RefreshButton({ label = 'Làm mới', className = '', ...props }: RefreshButtonProps) {
  return (
    <Button
      type="button"
      variant="secondary"
      icon={<ArrowsClockwise size={18} weight="bold" aria-hidden="true" />}
      className={`ds-refresh-button ${className}`.trim()}
      {...props}
    >
      {label}
    </Button>
  )
}
