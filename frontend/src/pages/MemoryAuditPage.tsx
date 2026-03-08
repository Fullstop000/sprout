import { BookCopy, Brain, History, Sparkles } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { InlineNotice } from '@/components/ui/inline-notice'
import { PhaseBadge } from '@/components/ui/phase-badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

import { ActivityByTask } from '../components/activity/ActivityByTask'
import { eventBadgeLabel, eventBadgeVariant, formatActivityMessage, formatDateTime, formatTime, type ActivityEvent, type MemoryPanel } from '../lib/dashboardView'
import type { ExperienceEntry, LlmAuditEntry, TaskSummary } from '../types/dashboard'

interface MemoryAuditPageProps {
  activePanel: MemoryPanel
  activity: ActivityEvent[]
  activityModule: string
  activityGroupBy: 'time' | 'task'
  collapsedTasks: Set<string>
  tasks: TaskSummary[]
  audit: LlmAuditEntry[]
  auditDetail: LlmAuditEntry | null
  experiences: ExperienceEntry[]
  activityError?: string
  auditError?: string
  experienceError?: string
  onChangePanel: (panel: MemoryPanel) => void
  onRefreshActivity: () => void
  onRefreshAudit: () => void
  onRefreshExperiences: () => void
  onOpenAuditDetail: (seq: number) => void
  onCloseAuditDetail: () => void
  onChangeActivityModule: (module: string) => void
  onChangeActivityGroupBy: (groupBy: 'time' | 'task') => void
  onToggleCollapsedTask: (taskId: string) => void
}

function panelButtonClass(active: boolean): string {
  return active
    ? 'rounded-full bg-stone-950 text-stone-50 hover:bg-stone-800'
    : 'rounded-full border-stone-200 bg-white text-stone-700 hover:bg-stone-50'
}

function surfaceClass(): string {
  return 'rounded-[1.75rem] border border-stone-200 bg-white/88 shadow-[0_20px_50px_rgba(53,44,34,0.06)]'
}

export function MemoryAuditPage({
  activePanel,
  activity,
  activityModule,
  activityGroupBy,
  collapsedTasks,
  tasks,
  audit,
  auditDetail,
  experiences,
  activityError,
  auditError,
  experienceError,
  onChangePanel,
  onRefreshActivity,
  onRefreshAudit,
  onRefreshExperiences,
  onOpenAuditDetail,
  onCloseAuditDetail,
  onChangeActivityModule,
  onChangeActivityGroupBy,
  onToggleCollapsedTask,
}: MemoryAuditPageProps) {
  const panels: Array<{ id: MemoryPanel; label: string; icon: typeof History }> = [
    { id: 'activity', label: 'Activity Feed', icon: History },
    { id: 'audit', label: 'LLM Audit', icon: BookCopy },
    { id: 'experience', label: 'Experience Memory', icon: Brain },
  ]

  return (
    <div className="space-y-5">
      {activePanel === 'activity' && activityError && (
        <InlineNotice detail={activityError} onAction={onRefreshActivity} title="Activity feed could not refresh" tone="warning" />
      )}
      {activePanel === 'audit' && auditError && (
        <InlineNotice detail={auditError} onAction={onRefreshAudit} title="LLM audit is temporarily unavailable" tone="warning" />
      )}
      {activePanel === 'experience' && experienceError && (
        <InlineNotice detail={experienceError} onAction={onRefreshExperiences} title="Experience memory could not refresh" tone="warning" />
      )}
      <section className="flex flex-wrap items-start justify-between gap-4 rounded-[1.5rem] border border-stone-200 bg-[linear-gradient(180deg,rgba(249,246,239,0.92),rgba(255,255,255,0.92))] px-5 py-5 shadow-[0_16px_40px_rgba(53,44,34,0.05)]">
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500">Memory & Audit</p>
          <h3 className="font-serif text-3xl tracking-[-0.03em] text-stone-950">Evidence, audit, and long-term learning</h3>
          <p className="max-w-3xl text-sm leading-6 text-stone-600">
            This area is for deep reading. Activity, model traces, and extracted experience now share the same calmer reading surface as the rest of the dashboard.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {panels.map((panel) => {
            const Icon = panel.icon
            return (
              <Button
                className={panelButtonClass(activePanel === panel.id)}
                key={panel.id}
                size="sm"
                variant="outline"
                onClick={() => onChangePanel(panel.id)}
              >
                <Icon className="h-4 w-4" />
                {panel.label}
              </Button>
            )
          })}
        </div>
      </section>

      {activePanel === 'activity' && (
        <section className={surfaceClass()}>
          <div className="flex flex-col gap-4 border-b border-stone-200 px-6 py-5 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">Activity Feed</p>
              <h4 className="font-serif text-3xl tracking-[-0.03em] text-stone-950">Trace agent behavior by time or task</h4>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Select value={activityModule || '__all__'} onValueChange={(value: string) => onChangeActivityModule(value === '__all__' ? '' : value)}>
                <SelectTrigger className="w-[170px] border-stone-200 bg-white text-stone-700">
                  <SelectValue placeholder="All modules" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All modules</SelectItem>
                  <SelectItem value="Cycle">Cycle</SelectItem>
                  <SelectItem value="Discovery">Discovery</SelectItem>
                  <SelectItem value="Execution">Execution</SelectItem>
                  <SelectItem value="Memory">Memory</SelectItem>
                  <SelectItem value="Inbox">Inbox</SelectItem>
                  <SelectItem value="LLM">LLM</SelectItem>
                  <SelectItem value="ControlPlane">ControlPlane</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex rounded-full border border-stone-200 bg-stone-50 p-1">
                <Button className={activityGroupBy === 'time' ? 'rounded-full bg-stone-950 text-stone-50 hover:bg-stone-800' : 'rounded-full text-stone-700 hover:bg-white'} size="sm" variant="ghost" onClick={() => onChangeActivityGroupBy('time')}>Timeline</Button>
                <Button className={activityGroupBy === 'task' ? 'rounded-full bg-stone-950 text-stone-50 hover:bg-stone-800' : 'rounded-full text-stone-700 hover:bg-white'} size="sm" variant="ghost" onClick={() => onChangeActivityGroupBy('task')}>By Task</Button>
              </div>
              <Button className="rounded-full border-stone-200 bg-white text-stone-700 hover:bg-stone-50" size="sm" variant="outline" onClick={onRefreshActivity}>Refresh</Button>
            </div>
          </div>
          <div className="px-6 py-6">
            {activityGroupBy === 'time' ? (
              <div className="space-y-2">
                {activity.length > 0 ? [...activity].reverse().map((event, idx) => {
                  const taskId = String(event.task_id ?? '')
                  return (
                    <div className="flex items-start gap-3 rounded-2xl border border-stone-200 bg-stone-50/70 px-4 py-3 text-sm" key={idx}>
                      <span className="w-20 shrink-0 font-mono text-xs text-stone-500">{formatTime(String(event.ts ?? event.timestamp ?? ''))}</span>
                      <PhaseBadge phase={eventBadgeVariant(event)} label={eventBadgeLabel(event)} />
                      <div className="min-w-0 flex-1 text-stone-700">
                        {taskId && <code className="mr-2 rounded-full bg-white px-2 py-0.5 text-xs text-stone-600">{taskId.slice(0, 8)}</code>}
                        {formatActivityMessage(event)}
                      </div>
                    </div>
                  )
                }) : (
                  <p className="py-10 text-center italic text-stone-500">No activity events</p>
                )}
              </div>
            ) : (
              <div className="max-h-[75vh] overflow-y-auto">
                <ActivityByTask
                  activity={activity}
                  collapsedTasks={collapsedTasks}
                  onToggle={onToggleCollapsedTask}
                  tasks={tasks}
                />
              </div>
            )}
          </div>
        </section>
      )}

      {activePanel === 'audit' && (
        <section className={surfaceClass()}>
          <div className="flex flex-col gap-3 border-b border-stone-200 px-6 py-5 md:flex-row md:items-end md:justify-between">
            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">LLM Audit</p>
              <h4 className="font-serif text-3xl tracking-[-0.03em] text-stone-950">Prompt and completion evidence</h4>
            </div>
            <Button className="rounded-full border-stone-200 bg-white text-stone-700 hover:bg-stone-50" size="sm" variant="outline" onClick={onRefreshAudit}>Refresh</Button>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-stone-200">
                  <TableHead className="text-stone-500">Seq</TableHead>
                  <TableHead className="text-stone-500">Model</TableHead>
                  <TableHead className="text-stone-500">Prompt / Completion</TableHead>
                  <TableHead className="text-right text-stone-500">Latency</TableHead>
                  <TableHead className="text-right text-stone-500">Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...audit].reverse().map((entry) => (
                  <TableRow className="cursor-pointer border-stone-100 hover:bg-stone-50/80" key={entry.seq} onClick={() => onOpenAuditDetail(entry.seq)}>
                    <TableCell className="font-mono text-stone-700">{entry.seq}</TableCell>
                    <TableCell><code className="rounded-full bg-stone-100 px-2 py-1 text-xs text-stone-700">{entry.model ?? '-'}</code></TableCell>
                    <TableCell className="font-mono text-xs text-stone-600">
                      {(entry.prompt_tokens ?? 0).toLocaleString()} / {(entry.completion_tokens ?? 0).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs text-stone-600">
                      {entry.duration_ms ? `${(entry.duration_ms / 1000).toFixed(1)}s` : '-'}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs text-stone-600">{formatTime(entry.ts)}</TableCell>
                  </TableRow>
                ))}
                {audit.length === 0 && (
                  <TableRow className="border-stone-100">
                    <TableCell className="py-10 text-center italic text-stone-500" colSpan={5}>No audit entries</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </section>
      )}

      {activePanel === 'experience' && (
        <section className={surfaceClass()}>
          <div className="flex flex-col gap-3 border-b border-stone-200 px-6 py-5 md:flex-row md:items-end md:justify-between">
            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">Experience Memory</p>
              <h4 className="font-serif text-3xl tracking-[-0.03em] text-stone-950">What the agent has learned over time</h4>
            </div>
            <Button className="rounded-full border-stone-200 bg-white text-stone-700 hover:bg-stone-50" size="sm" variant="outline" onClick={onRefreshExperiences}>Refresh</Button>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-stone-200">
                  <TableHead className="text-stone-500">Task ID</TableHead>
                  <TableHead className="text-stone-500">Category</TableHead>
                  <TableHead className="min-w-[260px] text-stone-500">Summary</TableHead>
                  <TableHead className="text-right text-stone-500">Confidence</TableHead>
                  <TableHead className="text-right text-stone-500">Applied Count</TableHead>
                  <TableHead className="text-stone-500">Outcome</TableHead>
                  <TableHead className="text-right text-stone-500">Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {experiences.map((entry) => (
                  <TableRow className="border-stone-100 hover:bg-stone-50/80" key={entry.id}>
                    <TableCell className="font-mono text-xs text-stone-700">{entry.task_id || '-'}</TableCell>
                    <TableCell><code className="rounded-full bg-stone-100 px-2 py-1 text-xs text-stone-700">{entry.category}</code></TableCell>
                    <TableCell>
                      <div className="text-sm text-stone-800">{entry.summary}</div>
                      {entry.detail && <div className="mt-1 text-xs text-stone-500">{entry.detail}</div>}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs text-stone-600">{typeof entry.confidence === 'number' ? entry.confidence.toFixed(2) : '-'}</TableCell>
                    <TableCell className="text-right text-stone-700">{Number(entry.applied_count ?? 0)}</TableCell>
                    <TableCell><code className="rounded-full bg-stone-100 px-2 py-1 text-xs text-stone-700">{entry.source_outcome || '-'}</code></TableCell>
                    <TableCell className="text-right font-mono text-xs text-stone-600">{formatDateTime(entry.created_at)}</TableCell>
                  </TableRow>
                ))}
                {experiences.length === 0 && (
                  <TableRow className="border-stone-100">
                    <TableCell className="py-10 text-center italic text-stone-500" colSpan={7}>No experience entries yet</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </section>
      )}

      <Dialog onOpenChange={onCloseAuditDetail} open={!!auditDetail}>
        <DialogContent className="max-h-[80vh] max-w-3xl overflow-auto border-stone-200 bg-[#faf7f2]">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl tracking-[-0.03em] text-stone-950">Audit Entry #{auditDetail?.seq}</DialogTitle>
            <DialogDescription>
              Model: {auditDetail?.model} · {auditDetail?.duration_ms ? `${(auditDetail.duration_ms / 1000).toFixed(1)}s` : '-'}
            </DialogDescription>
          </DialogHeader>
          {auditDetail && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">
                <Sparkles className="h-4 w-4" />
                Raw audit payload
              </div>
              <pre className="overflow-auto rounded-2xl bg-stone-100 p-4 text-xs text-stone-800">{JSON.stringify(auditDetail, null, 2)}</pre>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
