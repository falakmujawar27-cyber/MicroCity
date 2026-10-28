import { cn } from '../../lib/utils'

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  padded?: boolean
}

export function Card({ className, padded = true, children, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'border border-violet/40 bg-obsidian text-ivory',
        padded && 'p-6',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}
