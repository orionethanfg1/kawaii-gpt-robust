import { ButtonHTMLAttributes, forwardRef } from 'react'

type Variant = 'primary' | 'ghost'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
}

export const Button = forwardRef<HTMLButtonElement, Props>(
  ({ variant = 'primary', className = '', children, ...rest }, ref) => {
    const base = variant === 'primary' ? 'btn-kawaii' : 'btn-kawaii-ghost'
    return (
      <button ref={ref} className={`${base} ${className}`} {...rest}>
        {children}
      </button>
    )
  }
)
Button.displayName = 'Button'
