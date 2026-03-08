import { AlertTriangle, RefreshCw } from 'lucide-react'

import { Button } from '@/components/ui/button'

interface InlineNoticeProps {
  title: string
  detail: string
  tone?: 'warning' | 'error' | 'info'
  actionLabel?: string
  onAction?: () => void
}

function toneClass(tone: 'warning' | 'error' | 'info'): string {
  if (tone === 'error') return 'border-rose-200 bg-rose-50 text-rose-900'
  if (tone === 'warning') return 'border-amber-200 bg-amber-50 text-amber-900'
  return 'border-stone-200 bg-stone-50 text-stone-800'
}

export function InlineNotice({
  title,
  detail,
  tone = 'warning',
  actionLabel = 'Try again',
  onAction,
}: InlineNoticeProps) {
  return (
    <div className={`rounded-[1.25rem] border px-4 py-4 shadow-[0_10px_24px_rgba(53,44,34,0.04)] ${toneClass(tone)}`}>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="space-y-1">
            <p className="text-sm font-medium">{title}</p>
            <p className="text-sm leading-6 opacity-85">{detail}</p>
          </div>
        </div>
        {onAction && (
          <Button className="rounded-full bg-stone-950 text-stone-50 hover:bg-stone-800" size="sm" onClick={onAction}>
            <RefreshCw className="h-4 w-4" />
            {actionLabel}
          </Button>
        )}
      </div>
    </div>
  )
}
