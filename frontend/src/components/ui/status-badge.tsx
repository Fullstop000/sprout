import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

type TaskStatus =
  | 'queued'
  | 'planning'
  | 'running'
  | 'executing'
  | 'completed'
  | 'needs_human'
  | 'human_resolved'
  | 'failed'
  | 'cancelled'
  | 'discovered'

const statusVariants: Record<TaskStatus, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; className: string }> = {
  queued: { variant: 'secondary', className: 'border-sky-200 bg-sky-50 text-sky-800' },
  planning: { variant: 'secondary', className: 'border-violet-200 bg-violet-50 text-violet-800' },
  running: { variant: 'secondary', className: 'border-amber-200 bg-amber-50 text-amber-800' },
  executing: { variant: 'secondary', className: 'border-amber-200 bg-amber-50 text-amber-800' },
  completed: { variant: 'default', className: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
  needs_human: { variant: 'secondary', className: 'border-amber-200 bg-amber-50 text-amber-800 animate-pulse' },
  human_resolved: { variant: 'secondary', className: 'border-lime-200 bg-lime-50 text-lime-800' },
  failed: { variant: 'destructive', className: 'border-rose-200 bg-rose-50 text-rose-800' },
  cancelled: { variant: 'outline', className: 'border-stone-200 bg-stone-100 text-stone-600' },
  discovered: { variant: 'outline', className: 'border-stone-200 bg-stone-100 text-stone-600' },
}

interface StatusBadgeProps {
  status: string
  className?: string
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = statusVariants[status as TaskStatus] || statusVariants.cancelled

  return (
    <Badge
      variant={config.variant}
      className={cn(
        'font-medium capitalize',
        config.className,
        className
      )}
    >
      <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-current" />
      {status.replace(/_/g, ' ')}
    </Badge>
  )
}
