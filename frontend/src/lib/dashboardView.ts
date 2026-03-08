import type {
  BootstrapStatusPayload,
  CycleSummary,
  DashboardStats,
  DirectivePayload,
  ThreadSummary,
  TaskSummary,
} from '../types/dashboard'

export type DashboardPage = 'overview' | 'work' | 'discovery' | 'memory' | 'control' | 'inbox'
export type WorkPanel = 'tasks' | 'detail' | 'cycles'
export type MemoryPanel = 'activity' | 'audit' | 'experience'
export type ControlPanel = 'models' | 'directive' | 'help' | 'inject'

export interface ActivityEvent {
  module?: string
  family?: string
  event_name?: string
  phase?: string
  action?: string
  detail?: string
  reasoning?: string
  message?: string
  event?: string
  task_id?: string
  timestamp?: string
  ts?: string
  success?: boolean
  data?: Record<string, unknown>
  task?: {
    id?: string
    title?: string
    status?: string
    branch_name?: string
    pr_url?: string
    execution_trace?: string
    execution_log?: string
    error_message?: string
    updated_at?: string
  }
  [key: string]: unknown
}

export interface TaskGroup {
  taskId: string
  title: string
  events: ActivityEvent[]
}

export interface DiscoverySnapshot {
  latestFunnel?: ActivityEvent
  strategy?: ActivityEvent
  candidates: ActivityEvent[]
  scored: ActivityEvent[]
  filteredOut: ActivityEvent[]
  queued: ActivityEvent[]
}

export interface OverviewMetric {
  label: string
  value: string
  hint: string
}

export interface OverviewChange {
  id: string
  label: string
  title: string
  why: string
  timestamp: string
  meta: string
  tone: 'default' | 'success' | 'warning'
  action:
    | { kind: 'task'; label: string; taskId: string }
    | { kind: 'thread'; label: string; threadId: string }
    | { kind: 'page'; label: string; page: DashboardPage }
}

export interface OverviewAttentionItem {
  id: string
  label: string
  title: string
  detail: string
  tone: 'default' | 'warning'
  action:
    | { kind: 'task'; label: string; taskId: string }
    | { kind: 'thread'; label: string; threadId: string }
    | { kind: 'page'; label: string; page: DashboardPage }
}

export interface OverviewDestination {
  page: DashboardPage
  label: string
  description: string
  countLabel?: string
}

export interface OverviewBriefing {
  eyebrow: string
  title: string
  summary: string
  statusLine: string
  updatedLabel: string
  metrics: OverviewMetric[]
  notes: string[]
  activeTask?: TaskSummary
  latestCycle?: CycleSummary
}

export interface OverviewModel {
  briefing: OverviewBriefing
  changes: OverviewChange[]
  attention: OverviewAttentionItem[]
  destinations: OverviewDestination[]
}

function normalizeModule(module?: string): string {
  return String(module ?? '').trim()
}

export function eventBadgeVariant(event: ActivityEvent): string {
  const module = normalizeModule(event.module).toLowerCase()
  return module || 'system'
}

export function eventBadgeLabel(event: ActivityEvent): string {
  return normalizeModule(event.module) || 'Unknown'
}

export function eventDisplayName(event: ActivityEvent): string {
  return String(event.event_name ?? '')
}

export function formatTime(iso?: string): string {
  if (!iso) return '-'
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return iso.slice(11, 19) || iso
  }
}

export function formatDateTime(iso?: string): string {
  if (!iso) return '-'
  try {
    const d = new Date(iso)
    return d.toLocaleString('en-GB', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    return iso
  }
}

export function formatCompactNumber(value?: number): string {
  const numeric = Number(value ?? 0)
  if (!Number.isFinite(numeric)) return '0'
  return numeric.toLocaleString('en-US')
}

export function formatRelativeTime(iso?: string): string {
  if (!iso) return 'just now'
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return 'recently'
  const diffSeconds = Math.max(0, Math.floor((Date.now() - then) / 1000))
  if (diffSeconds < 60) return `${diffSeconds}s ago`
  const diffMinutes = Math.floor(diffSeconds / 60)
  if (diffMinutes < 60) return `${diffMinutes}m ago`
  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}d ago`
}

export function groupActivityByTask(
  events: ActivityEvent[],
  taskList: TaskSummary[],
): { global: ActivityEvent[]; groups: TaskGroup[] } {
  const titleMap = new Map<string, string>()
  for (const t of taskList) titleMap.set(t.id, t.title)

  const global: ActivityEvent[] = []
  const byTask = new Map<string, ActivityEvent[]>()

  for (const ev of events) {
    const tid = String(ev.task_id ?? '')
    if (!tid) {
      global.push(ev)
      continue
    }
    const arr = byTask.get(tid)
    if (arr) arr.push(ev)
    else byTask.set(tid, [ev])
  }

  const groups = Array.from(byTask.entries()).map(([taskId, evts]) => ({
    taskId,
    title: titleMap.get(taskId) ?? `Task ${taskId.slice(0, 8)}`,
    events: evts,
  }))

  groups.sort((a, b) => {
    const aTs = String(a.events[a.events.length - 1]?.timestamp ?? a.events[a.events.length - 1]?.ts ?? '')
    const bTs = String(b.events[b.events.length - 1]?.timestamp ?? b.events[b.events.length - 1]?.ts ?? '')
    return bTs.localeCompare(aTs)
  })

  return { global, groups }
}

export function buildDiscoverySnapshot(events: ActivityEvent[]): DiscoverySnapshot {
  const discover = events.filter((ev) =>
    ev.module === 'Discovery'
    && ['strategy', 'candidate', 'queue', 'funnel'].includes(String(ev.family ?? '')),
  )
  const value = events.filter((ev) =>
    ev.module === 'Discovery' && ev.family === 'valuation',
  )
  return {
    latestFunnel: [...discover].reverse().find((ev) => ev.event_name === 'funnel_summarized'),
    strategy: [...discover].reverse().find((ev) => ev.event_name === 'strategy_selected'),
    candidates: discover.filter((ev) => ev.event_name === 'candidate_found').slice(-12).reverse(),
    scored: value.filter((ev) => ev.event_name === 'candidate_scored').slice(-12).reverse(),
    filteredOut: value.filter((ev) => ev.event_name === 'candidate_filtered_out').slice(-12).reverse(),
    queued: discover.filter((ev) => ev.event_name === 'candidate_queued').slice(-12).reverse(),
  }
}

export function formatActivityMessage(event: ActivityEvent): string {
  return String(event.message ?? event.detail ?? event.event ?? JSON.stringify(event))
}

function findTaskTitle(taskId: string, tasks: TaskSummary[], event: ActivityEvent): string {
  return (
    event.task?.title
    ?? tasks.find((task) => task.id === taskId)?.title
    ?? `Task ${taskId.slice(0, 8)}`
  )
}

function buildChangeFromEvent(event: ActivityEvent, tasks: TaskSummary[]): OverviewChange | null {
  const eventName = String(event.event_name ?? '')
  const taskId = String(event.task_id ?? '')
  const timestamp = String(event.timestamp ?? event.ts ?? '')
  const detail = String(event.detail ?? event.message ?? '')
  const reasoning = String(event.reasoning ?? '')
  const taskTitle = taskId ? findTaskTitle(taskId, tasks, event) : ''
  const cycleId = event.cycle_id ? `cycle-${String(event.cycle_id)}` : ''
  const related = [taskId ? `task ${taskId.slice(0, 8)}` : '', cycleId].filter(Boolean).join(' · ')

  if (eventName === 'task_completed' && taskId) {
    return {
      id: `${eventName}-${taskId}-${timestamp}`,
      label: 'Completed',
      title: taskTitle,
      why: reasoning || 'This work finished successfully and may unlock follow-up tasks.',
      timestamp,
      meta: related || 'Execution state change',
      tone: 'success',
      action: { kind: 'task', label: 'Open task', taskId },
    }
  }

  if ((eventName === 'task_failed' || eventName === 'task_needs_human') && taskId) {
    return {
      id: `${eventName}-${taskId}-${timestamp}`,
      label: eventName === 'task_failed' ? 'Failed' : 'Needs human',
      title: taskTitle,
      why: reasoning || detail || 'This task needs inspection before progress continues.',
      timestamp,
      meta: related || 'Execution state change',
      tone: 'warning',
      action: { kind: 'task', label: 'Review task', taskId },
    }
  }

  if (eventName === 'verification_completed' && event.success === false && taskId) {
    return {
      id: `${eventName}-${taskId}-${timestamp}`,
      label: 'Verification',
      title: taskTitle,
      why: reasoning || detail || 'Verification did not pass and the evidence trail needs review.',
      timestamp,
      meta: related || 'Verification result',
      tone: 'warning',
      action: { kind: 'task', label: 'Open verification', taskId },
    }
  }

  if (eventName === 'candidate_queued') {
    const candidateTitle = String(event.data?.title ?? detail ?? 'Discovery candidate queued')
    return {
      id: `${eventName}-${taskId || candidateTitle}-${timestamp}`,
      label: 'Discovery',
      title: candidateTitle,
      why: reasoning || 'The agent promoted a discovered opportunity into the task queue.',
      timestamp,
      meta: related || 'Discovery queue update',
      tone: 'default',
      action: { kind: 'page', label: 'Open discovery', page: 'discovery' },
    }
  }

  if (eventName === 'cycle_completed') {
    return {
      id: `${eventName}-${timestamp}`,
      label: 'Cycle',
      title: detail || 'Cycle completed',
      why: reasoning || 'The latest agent cycle finished and its results are ready for review.',
      timestamp,
      meta: cycleId || 'Cycle lifecycle',
      tone: 'default',
      action: { kind: 'page', label: 'Open work', page: 'work' },
    }
  }

  if ((event.module === 'ControlPlane' || event.module === 'Cycle') && detail) {
    return {
      id: `${eventName || event.module}-${timestamp}`,
      label: normalizeModule(event.module) || 'Runtime',
      title: detail,
      why: reasoning || 'The runtime state changed in a way worth operator awareness.',
      timestamp,
      meta: related || `${normalizeModule(event.family)} update`,
      tone: 'default',
      action: { kind: 'page', label: 'Open control', page: 'control' },
    }
  }

  return null
}

interface BuildOverviewModelArgs {
  activity: ActivityEvent[]
  bootstrapStatus: BootstrapStatusPayload | null
  cycles: CycleSummary[]
  directive: DirectivePayload | null
  helpRequests: TaskSummary[]
  stats: DashboardStats
  tasks: TaskSummary[]
  threads: ThreadSummary[]
}

export function buildOverviewModel({
  activity,
  bootstrapStatus,
  cycles,
  directive,
  helpRequests,
  stats,
  tasks,
  threads,
}: BuildOverviewModelArgs): OverviewModel {
  const activeTask = tasks.find((task) => ['running', 'executing', 'planning'].includes(task.status))
  const latestCycle = cycles[0]
  const recentCompletions = tasks.filter((task) => ['completed', 'human_resolved'].includes(task.status)).length
  const blockerCount = helpRequests.length + (bootstrapStatus?.requires_setup ? 1 : 0)
  const waitingThreads = threads.filter((thread) => thread.status === 'waiting_reply')
  const updatedAt = String(
    activity[activity.length - 1]?.timestamp
      ?? activity[activity.length - 1]?.ts
      ?? tasks[0]?.updated_at
      ?? cycles[0]?.completed_at
      ?? '',
  )

  const metrics: OverviewMetric[] = [
    {
      label: 'Input tokens',
      value: formatCompactNumber(stats.input_tokens),
      hint: 'cumulative prompt volume',
    },
    {
      label: 'Output tokens',
      value: formatCompactNumber(stats.output_tokens),
      hint: 'cumulative model output',
    },
    {
      label: 'Recent completions',
      value: formatCompactNumber(recentCompletions),
      hint: 'finished tasks in the current list',
    },
    {
      label: 'Current blockers',
      value: formatCompactNumber(blockerCount),
      hint: 'human or setup issues',
    },
  ]

  const summaryParts = [
    recentCompletions > 0
      ? `The agent recently closed ${recentCompletions} task${recentCompletions === 1 ? '' : 's'}.`
      : 'No recent completions are visible yet.',
    activeTask
      ? `It is currently focused on "${activeTask.title}".`
      : 'It is not actively executing a task right now.',
    blockerCount > 0 || waitingThreads.length > 0
      ? `${blockerCount + waitingThreads.length} item${blockerCount + waitingThreads.length === 1 ? '' : 's'} may need operator attention.`
      : 'There are no visible operator queues waiting right now.',
  ]

  const notes = [
    directive?.paused ? 'Runtime is paused by directive.' : 'Runtime is polling normally.',
    bootstrapStatus?.requires_setup
      ? bootstrapStatus.message
      : 'Bootstrap requirements are satisfied.',
    latestCycle
      ? `Latest cycle #${latestCycle.id}: ${latestCycle.discovered} discovered, ${latestCycle.executed} executed, ${latestCycle.failed} failed.`
      : 'No cycle summary is available yet.',
  ]

  const changes = [...activity]
    .reverse()
    .map((event) => buildChangeFromEvent(event, tasks))
    .filter((item): item is OverviewChange => item !== null)
    .slice(0, 6)

  const attention: OverviewAttentionItem[] = []
  if (bootstrapStatus?.requires_setup) {
    attention.push({
      id: 'setup-required',
      label: 'Setup',
      title: 'Initialization still needs attention',
      detail: bootstrapStatus.message,
      tone: 'warning',
      action: { kind: 'page', label: 'Open control', page: 'control' },
    })
  }
  for (const task of helpRequests.slice(0, 2)) {
    attention.push({
      id: `help-${task.id}`,
      label: 'Needs human',
      title: task.title,
      detail: task.human_help_request || 'This task is waiting for operator guidance.',
      tone: 'warning',
      action: { kind: 'task', label: 'Review task', taskId: task.id },
    })
  }
  for (const thread of waitingThreads.slice(0, 2)) {
    attention.push({
      id: `thread-${thread.id}`,
      label: 'Inbox',
      title: thread.title,
      detail: 'A human-agent thread is waiting for a reply or acknowledgement.',
      tone: 'default',
      action: { kind: 'thread', label: 'Open thread', threadId: thread.id },
    })
  }

  const destinations: OverviewDestination[] = [
    {
      page: 'work',
      label: 'Work',
      description: 'Inspect tasks, execution traces, and cycle outcomes.',
      countLabel: `${formatCompactNumber(tasks.length)} tasks`,
    },
    {
      page: 'inbox',
      label: 'Inbox',
      description: 'Continue async conversation with the agent.',
      countLabel: `${formatCompactNumber(waitingThreads.length)} waiting`,
    },
    {
      page: 'discovery',
      label: 'Discovery',
      description: 'Review newly queued opportunities and source signals.',
    },
    {
      page: 'memory',
      label: 'Memory & Audit',
      description: 'Read detailed evidence, activity, and LLM audit trails.',
    },
    {
      page: 'control',
      label: 'Control',
      description: 'Adjust models, directives, and manual interventions.',
      countLabel: bootstrapStatus?.requires_setup ? 'setup pending' : undefined,
    },
  ]

  return {
    briefing: {
      eyebrow: 'Review Briefing',
      title: 'What changed since you last looked',
      summary: summaryParts.join(' '),
      statusLine: directive?.paused ? 'Paused for review' : 'Live and ready for async review',
      updatedLabel: updatedAt ? `Updated ${formatRelativeTime(updatedAt)}` : 'Waiting for first refresh',
      metrics,
      notes,
      activeTask,
      latestCycle,
    },
    changes,
    attention,
    destinations,
  }
}
