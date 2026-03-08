import { Button } from '@/components/ui/button'

import type { BootstrapStatusPayload, DirectivePayload } from '../types/dashboard'
import type { DashboardPage } from '../lib/dashboardView'

const PAGE_LABELS: Record<DashboardPage, string> = {
  overview: 'Briefing',
  work: 'Work',
  inbox: 'Inbox',
  discovery: 'Discovery',
  memory: 'Memory & Audit',
  control: 'Control',
}

interface DashboardShellProps {
  activePage: DashboardPage
  bootstrapStatus: BootstrapStatusPayload | null
  directive: DirectivePayload | null
  metaText: string
  pauseLoading: boolean
  inboxUnread?: number
  onNavigate: (page: DashboardPage) => void
  onTogglePause: () => void
  children: React.ReactNode
}

export function DashboardShell({
  activePage,
  bootstrapStatus,
  directive,
  metaText,
  pauseLoading,
  inboxUnread = 0,
  onNavigate,
  onTogglePause,
  children,
}: DashboardShellProps) {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(185,169,133,0.18),transparent_32%),linear-gradient(180deg,#f8f4ec_0%,#f3efe6_46%,#f8f5f0_100%)] text-stone-900">
      <main className="mx-auto grid min-h-screen max-w-[1580px] gap-8 px-4 py-6 md:px-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <div className="sticky top-6 space-y-8 pr-6">
            <div className="space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-stone-500">Sprout Agent V2</p>
              <div className="space-y-2">
                <h1 className="font-serif text-4xl leading-none tracking-[-0.04em] text-stone-950">Review Desk</h1>
                <p className="text-sm leading-6 text-stone-600">
                  Async visibility, evidence, and intervention for the autonomous loop.
                </p>
              </div>
            </div>

            <nav className="space-y-1">
              {Object.entries(PAGE_LABELS).map(([page, label]) => {
                const isActive = activePage === page
                return (
                  <button
                    key={page}
                    className={`flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left text-sm transition ${
                      isActive
                        ? 'bg-stone-950 text-stone-50 shadow-[0_16px_36px_rgba(40,32,22,0.18)]'
                        : 'text-stone-700 hover:bg-white/75 hover:text-stone-950'
                    }`}
                    onClick={() => onNavigate(page as DashboardPage)}
                    type="button"
                  >
                    <span className="font-medium">{label}</span>
                    {page === 'inbox' && inboxUnread > 0 ? (
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${isActive ? 'bg-stone-50 text-stone-950' : 'bg-amber-100 text-amber-800'}`}>
                        {inboxUnread}
                      </span>
                    ) : (
                      <span className={`text-[11px] uppercase tracking-[0.16em] ${isActive ? 'text-stone-300' : 'text-stone-400'}`}>
                        0{Object.keys(PAGE_LABELS).indexOf(page) + 1}
                      </span>
                    )}
                  </button>
                )
              })}
            </nav>

            <div className="rounded-[1.5rem] border border-stone-200 bg-white/75 p-4 shadow-[0_16px_40px_rgba(53,44,34,0.05)]">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">Runtime</p>
              <p className="mt-2 text-sm font-medium text-stone-950">
                {directive?.paused ? 'Paused for operator review' : 'Polling and collecting context'}
              </p>
              <p className="mt-2 text-sm leading-6 text-stone-600">{metaText}</p>
            </div>
          </div>
        </aside>

        <section className="min-w-0 space-y-5">
          <header className="space-y-4 rounded-[1.75rem] border border-stone-200 bg-white/78 px-5 py-5 shadow-[0_20px_50px_rgba(53,44,34,0.05)] backdrop-blur md:px-6">
            <div className="flex flex-wrap gap-2 lg:hidden">
              {Object.entries(PAGE_LABELS).map(([page, label]) => (
                <Button
                  className={activePage === page ? 'bg-stone-950 text-stone-50 hover:bg-stone-800' : 'border-stone-200 bg-white text-stone-700 hover:bg-stone-50'}
                  key={page}
                  size="sm"
                  variant="outline"
                  onClick={() => onNavigate(page as DashboardPage)}
                >
                  {label}
                </Button>
              ))}
            </div>

            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500">{PAGE_LABELS[activePage]}</p>
                <div className="space-y-1">
                  <h2 className="font-serif text-[clamp(2rem,4vw,3.5rem)] leading-[0.96] tracking-[-0.04em] text-stone-950">
                    {activePage === 'overview' ? 'Catch up before you intervene' : PAGE_LABELS[activePage]}
                  </h2>
                  <p className="max-w-3xl text-sm leading-6 text-stone-600">
                    {activePage === 'overview'
                      ? 'Start with the briefing, then follow the evidence trail into tasks, inbox threads, discovery, or audit.'
                      : 'Deeper inspection and operator actions live here once the homepage gives you enough context.'}
                  </p>
                </div>
              </div>

              <div className="flex flex-col items-start gap-3 md:items-end">
                {directive && (
                  <Button
                    className={directive.paused ? 'rounded-full bg-amber-700 text-amber-50 hover:bg-amber-800' : 'rounded-full bg-stone-950 text-stone-50 hover:bg-stone-800'}
                    onClick={onTogglePause}
                    disabled={pauseLoading}
                  >
                    <span className={`mr-2 h-2.5 w-2.5 rounded-full ${directive.paused ? 'bg-amber-200' : 'bg-emerald-300 animate-pulse-dot'}`} />
                    {pauseLoading ? 'Working...' : directive.paused ? 'Resume agent' : 'Pause agent'}
                  </Button>
                )}
                <p className="text-xs uppercase tracking-[0.18em] text-stone-500">{metaText}</p>
              </div>
            </div>
          </header>

          {bootstrapStatus?.requires_setup && (
            <div className="flex flex-col gap-3 rounded-[1.5rem] border border-amber-300 bg-amber-50/95 px-5 py-4 shadow-[0_14px_30px_rgba(180,120,36,0.08)] md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">Initialization Required</p>
                <p className="mt-1 text-sm leading-6 text-amber-900">{bootstrapStatus.message}</p>
              </div>
              <Button className="rounded-full bg-amber-700 text-amber-50 hover:bg-amber-800" onClick={() => onNavigate('control')}>
                Open control
              </Button>
            </div>
          )}

          {children}
        </section>
      </main>
    </div>
  )
}
