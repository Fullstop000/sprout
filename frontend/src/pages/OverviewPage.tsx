import { ArrowRight, AlertTriangle, BookOpenText, CheckCircle2, Clock3, Inbox, Settings2 } from 'lucide-react'

import { InlineNotice } from '@/components/ui/inline-notice'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/ui/status-badge'

import { formatDateTime, formatRelativeTime, type DashboardPage } from '../lib/dashboardView'
import type { DashboardSummaryPayload } from '../types/dashboard'

interface OverviewPageProps {
  summary: DashboardSummaryPayload | null
  errorMessage?: string
  onRetry?: () => void
  onNavigate: (page: DashboardPage) => void
  onOpenTaskDetail: (taskId: string) => void
  onOpenThread: (threadId: string) => void
}

function toneClasses(tone: 'default' | 'success' | 'warning'): string {
  if (tone === 'success') return 'border-emerald-200/80 bg-emerald-50/80'
  if (tone === 'warning') return 'border-amber-300/80 bg-amber-50/90'
  return 'border-stone-200 bg-white/85'
}

export function OverviewPage({
  summary,
  errorMessage,
  onRetry,
  onNavigate,
  onOpenTaskDetail,
  onOpenThread,
}: OverviewPageProps) {
  if (!summary && errorMessage) {
    return <InlineNotice detail={errorMessage} onAction={onRetry} title="Overview data is unavailable" tone="error" />
  }

  if (!summary) {
    return (
      <div className="rounded-[1.75rem] border border-stone-200 bg-white/88 px-8 py-12 text-center text-sm text-stone-600 shadow-[0_20px_50px_rgba(53,44,34,0.06)]">
        Loading the latest review briefing…
      </div>
    )
  }

  const { briefing, changes, attention, destinations } = summary

  const handleAction = (
    action:
      | { kind: 'task'; label: string; taskId: string }
      | { kind: 'thread'; label: string; threadId: string }
      | { kind: 'page'; label: string; page: DashboardPage },
  ): void => {
    if (action.kind === 'task') onOpenTaskDetail(action.taskId)
    else if (action.kind === 'thread') onOpenThread(action.threadId)
    else onNavigate(action.page)
  }

  return (
    <div className="space-y-6">
      {errorMessage && (
        <InlineNotice
          detail={errorMessage}
          onAction={onRetry}
          title="Showing the last successful overview snapshot"
          tone="warning"
        />
      )}
      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(280px,0.75fr)]">
        <article className="overflow-hidden rounded-[1.75rem] border border-stone-200 bg-[linear-gradient(135deg,rgba(255,255,255,0.96),rgba(244,240,233,0.94))] shadow-[0_24px_70px_rgba(53,44,34,0.08)]">
          <div className="space-y-6 px-6 py-6 md:px-8 md:py-8">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="max-w-2xl space-y-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-stone-500">{briefing.eyebrow}</p>
                <div className="space-y-2">
                  <h3 className="font-serif text-[clamp(2rem,4vw,3.4rem)] leading-[0.95] tracking-[-0.03em] text-stone-950">
                    {briefing.title}
                  </h3>
                  <p className="max-w-2xl text-base leading-7 text-stone-700">{briefing.summary}</p>
                </div>
              </div>

              <div className="rounded-2xl border border-stone-200 bg-white/75 px-4 py-3 text-sm text-stone-700 shadow-sm">
                <p className="font-medium text-stone-900">{briefing.statusLine}</p>
                <p className="mt-1">Updated {formatRelativeTime(summary.updated_at)}</p>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {briefing.metrics.map((metric) => (
                <div
                  className="rounded-2xl border border-stone-200/90 bg-white/70 px-4 py-4 shadow-[0_8px_24px_rgba(53,44,34,0.04)]"
                  key={metric.label}
                >
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">{metric.label}</p>
                  <p className="mt-2 text-3xl font-semibold tracking-[-0.03em] text-stone-950">{metric.value}</p>
                  <p className="mt-2 text-sm text-stone-600">{metric.hint}</p>
                </div>
              ))}
            </div>

            <div className="grid gap-5 border-t border-stone-200/80 pt-6 md:grid-cols-[minmax(0,1fr)_280px]">
              <div className="space-y-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-stone-500">Natural-Language Handoff</p>
                <div className="space-y-2">
                  {briefing.notes.map((note) => (
                    <p className="text-sm leading-6 text-stone-700" key={note}>
                      {note}
                    </p>
                  ))}
                </div>
              </div>

              <div className="space-y-3 rounded-2xl border border-stone-200 bg-white/70 p-4">
                <div className="flex items-center gap-2 text-stone-500">
                  <Clock3 className="h-4 w-4" />
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">Current Focus</p>
                </div>
                {briefing.activeTask ? (
                  <button
                    className="w-full rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4 text-left transition hover:border-stone-300 hover:bg-white"
                    onClick={() => onOpenTaskDetail(briefing.activeTask!.id)}
                    type="button"
                  >
                    <StatusBadge className="border-none bg-stone-900/5 text-stone-800" status={briefing.activeTask.status} />
                    <p className="mt-3 text-base font-medium text-stone-950">{briefing.activeTask.title}</p>
                    <p className="mt-1 text-xs text-stone-500">
                      {briefing.activeTask.updated_at
                        ? `Touched ${formatRelativeTime(briefing.activeTask.updated_at)}`
                        : 'Waiting for next update'}
                    </p>
                  </button>
                ) : (
                  <div className="rounded-2xl border border-dashed border-stone-300 bg-stone-50/80 px-4 py-5 text-sm text-stone-600">
                    No active task is executing right now.
                  </div>
                )}

                {briefing.latestCycle && (
                  <div className="rounded-2xl bg-stone-950 px-4 py-4 text-stone-100">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-300">Latest cycle</p>
                    <p className="mt-2 text-base font-medium">#{briefing.latestCycle.id}</p>
                    <p className="mt-1 text-sm text-stone-300">
                      {briefing.latestCycle.discovered} discovered, {briefing.latestCycle.executed} executed, {briefing.latestCycle.failed} failed
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </article>

        <aside className="space-y-4">
          <div className="rounded-[1.5rem] border border-stone-200 bg-white/90 p-5 shadow-[0_18px_40px_rgba(53,44,34,0.06)]">
            <div className="flex items-center gap-2 text-stone-500">
              <AlertTriangle className="h-4 w-4" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">Needs Attention</p>
            </div>

            <div className="mt-4 space-y-3">
              {attention.length > 0 ? attention.map((item) => (
                <div className={`rounded-2xl border p-4 ${toneClasses(item.tone)}`} key={item.id}>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">{item.label}</p>
                  <p className="mt-2 text-sm font-medium text-stone-950">{item.title}</p>
                  <p className="mt-2 text-sm leading-6 text-stone-700">{item.detail}</p>
                  <Button
                    className="mt-4 rounded-full bg-stone-900 text-stone-50 hover:bg-stone-800"
                    size="sm"
                    onClick={() => handleAction(item.action)}
                  >
                    {item.action.label}
                  </Button>
                </div>
              )) : (
                <div className="rounded-2xl border border-dashed border-stone-300 bg-stone-50/80 px-4 py-6 text-sm text-stone-600">
                  Nothing urgent is queued for operator attention.
                </div>
              )}
            </div>
          </div>

          <div className="rounded-[1.5rem] border border-stone-200 bg-[linear-gradient(180deg,rgba(249,246,239,0.92),rgba(255,255,255,0.92))] p-5 shadow-[0_18px_40px_rgba(53,44,34,0.06)]">
            <div className="flex items-center gap-2 text-stone-500">
              <BookOpenText className="h-4 w-4" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">Continue Reading</p>
            </div>

            <div className="mt-4 space-y-3">
              {destinations.map((destination) => (
                <button
                  className="flex w-full items-start justify-between gap-4 rounded-2xl border border-stone-200 bg-white/80 px-4 py-4 text-left transition hover:border-stone-300 hover:bg-white"
                  key={destination.page}
                  onClick={() => onNavigate(destination.page)}
                  type="button"
                >
                  <div>
                    <p className="font-medium text-stone-950">{destination.label}</p>
                    <p className="mt-1 text-sm leading-6 text-stone-600">{destination.description}</p>
                    {destination.countLabel && (
                      <p className="mt-2 text-xs uppercase tracking-[0.16em] text-stone-500">{destination.countLabel}</p>
                    )}
                  </div>
                  <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-stone-400" />
                </button>
              ))}
            </div>
          </div>
        </aside>
      </section>

      <section className="rounded-[1.75rem] border border-stone-200 bg-white/88 p-6 shadow-[0_20px_50px_rgba(53,44,34,0.06)]">
        <div className="flex flex-col gap-3 border-b border-stone-200/80 pb-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-stone-500">What Changed</p>
            <h4 className="font-serif text-3xl tracking-[-0.03em] text-stone-950">Recent changes worth reading</h4>
          </div>
          <p className="max-w-xl text-sm leading-6 text-stone-600">
            This is a curated feed, not a raw event dump. Each item should explain why it matters and where to go next.
          </p>
        </div>

        <div className="mt-6 space-y-4">
          {changes.length > 0 ? changes.map((change) => (
            <article className={`rounded-[1.5rem] border p-5 ${toneClasses(change.tone)}`} key={change.id}>
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-stone-900 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-50">
                      {change.label}
                    </span>
                    <span className="text-xs uppercase tracking-[0.16em] text-stone-500">
                      {change.timestamp ? formatRelativeTime(change.timestamp) : 'recently'}
                    </span>
                  </div>
                  <div className="space-y-2">
                    <h5 className="text-xl font-medium tracking-[-0.02em] text-stone-950">{change.title}</h5>
                    <p className="text-sm leading-6 text-stone-700">{change.why}</p>
                  </div>
                </div>

                <Button
                  className="rounded-full bg-stone-900 text-stone-50 hover:bg-stone-800"
                  onClick={() => handleAction(change.action)}
                  size="sm"
                >
                  {change.action.label}
                </Button>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-stone-600">
                <span>{change.meta}</span>
                {change.timestamp && <span>{formatDateTime(change.timestamp)}</span>}
              </div>
            </article>
          )) : (
            <div className="rounded-[1.5rem] border border-dashed border-stone-300 bg-stone-50/80 px-5 py-8 text-sm text-stone-600">
              No high-signal changes are available yet. As activity accumulates, this feed will highlight completions, failures,
              queued discoveries, and other review-worthy transitions.
            </div>
          )}
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-[1.5rem] border border-stone-200 bg-white/85 p-5">
          <div className="flex items-center gap-2 text-stone-500">
            <CheckCircle2 className="h-4 w-4" />
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">Completions</p>
          </div>
          <p className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-stone-950">
            {briefing.metrics.find((metric) => metric.label === 'Recent completions')?.value ?? '0'}
          </p>
          <p className="mt-2 text-sm leading-6 text-stone-600">
            Completed tasks remain visible through the briefing and task list without turning the homepage into a metrics wall.
          </p>
        </div>

        <div className="rounded-[1.5rem] border border-stone-200 bg-white/85 p-5">
          <div className="flex items-center gap-2 text-stone-500">
            <Inbox className="h-4 w-4" />
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">Inbox</p>
          </div>
          <p className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-stone-950">
            {destinations.find((destination) => destination.page === 'inbox')?.countLabel?.split(' ')[0] ?? '0'}
          </p>
          <p className="mt-2 text-sm leading-6 text-stone-600">
            Waiting threads surface in attention, but full conversation context stays in the dedicated Inbox view.
          </p>
        </div>

        <div className="rounded-[1.5rem] border border-stone-200 bg-white/85 p-5">
          <div className="flex items-center gap-2 text-stone-500">
            <Settings2 className="h-4 w-4" />
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">Setup</p>
          </div>
          <p className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-stone-950">
            {attention.some((item) => item.id === 'setup-required') ? 'Pending' : 'Ready'}
          </p>
          <p className="mt-2 text-sm leading-6 text-stone-600">
            Initialization state stays visible, but only as one compact signal rather than multiple repeated cards.
          </p>
        </div>
      </section>
    </div>
  )
}
