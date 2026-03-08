import { cn } from "@/lib/utils"

interface PriorityBadgeProps {
  priority: number
  className?: string
}

const priorityClasses: Record<number, string> = {
  1: 'border-rose-200 bg-rose-50 text-rose-800',
  2: 'border-amber-200 bg-amber-50 text-amber-800',
  3: 'border-stone-200 bg-stone-100 text-stone-700',
  4: 'border-stone-200 bg-stone-100 text-stone-600',
  5: 'border-stone-200 bg-stone-100 text-stone-500',
}

export function PriorityBadge({ priority, className }: PriorityBadgeProps) {
  const colorClass = priorityClasses[priority] || priorityClasses[3]

  return (
    <span
      className={cn(
        'inline-flex rounded-full border px-2.5 py-1 font-mono text-xs font-semibold',
        colorClass,
        className
      )}
    >
      P{priority}
    </span>
  )
}
