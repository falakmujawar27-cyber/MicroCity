import { cn } from '../../lib/utils'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline'
  size?: 'sm' | 'md' | 'lg'
}

export function Button({
  className,
  variant = 'primary',
  size = 'md',
  children,
  ...props
}: ButtonProps) {
  const base =
    'inline-flex items-center justify-center font-medium rounded-md transition-colors disabled:opacity-50 disabled:pointer-events-none focus:outline-none focus:ring-2 focus:ring-offset-1'

  const variants = {
    primary:
      'bg-violet text-ivory hover:bg-[#4638e8] focus:ring-gold ring-offset-0',
    secondary:
      'bg-ivory text-ink hover:bg-ivory-deep focus:ring-gold ring-offset-0',
    outline:
      'border border-ivory/50 bg-transparent text-ivory hover:bg-ivory/5 focus:ring-gold ring-offset-0',
  }

  const sizes = {
    sm: 'h-8 px-2.5 text-sm',
    md: 'h-10 px-4 text-sm',
    lg: 'h-12 px-6 text-base',
  }

  return (
    <button
      className={cn(base, variants[variant], sizes[size], className)}
      {...props}
    >
      {children}
    </button>
  )
}
