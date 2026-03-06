import { useCallback, useEffect, useMemo, useState } from 'react'
import { dashboardApiClient } from './api/dashboardApi'
import type {
  CycleSummary,
  BootstrapStatusPayload,
  DashboardStats,
  DirectivePayload,
  ExperienceEntry,
  LlmAuditEntry,
  ModelBindingPointEntry,
  RegisteredModelEntry,
  TaskDetail,
  TaskEvent,
  TaskSummary,
} from './types/dashboard'
import './App.css'

type DashboardTab = 'tasks' | 'detail' | 'cycles' | 'activity' | 'audit' | 'help' | 'experience' | 'models' | 'control' | 'inject'

const STATUS_CLASS: Record<string, string> = {
  queued: 'badge-queued',
  planning: 'badge-planning',
  running: 'badge-running',
  executing: 'badge-executing',
  completed: 'badge-completed',
  needs_human: 'badge-needs-human',
  human_resolved: 'badge-human-resolved',
  failed: 'badge-failed',
  cancelled: 'badge-cancelled',
  discovered: 'badge-discovered',
}

const PHASE_CLASS: Record<string, string> = {
  cycle: 'phase-cycle',
  discover: 'phase-discover',
  value: 'phase-value',
  plan: 'phase-plan',
  execute: 'phase-execute',
  verify: 'phase-verify',
  git: 'phase-git',
  decision: 'phase-decision',
  system: 'phase-system',
}

const MODEL_CONNECTION_LABEL: Record<string, string> = {
  success: 'Success',
  fail: 'Fail',
}

function formatTime(iso?: string): string {
  if (!iso) return '-'
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return iso.slice(11, 19) || iso
  }
}

function formatDateTime(iso?: string): string {
  if (!iso) return '-'
  try {
    const d = new Date(iso)
    return d.toLocaleString('en-GB', {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
  } catch {
    return iso
  }
}

interface TaskGroup {
  taskId: string
  title: string
  events: Record<string, unknown>[]
}

function groupActivityByTask(
  events: Record<string, unknown>[],
  taskList: TaskSummary[],
): { global: Record<string, unknown>[]; groups: TaskGroup[] } {
  const titleMap = new Map<string, string>()
  for (const t of taskList) titleMap.set(t.id, t.title)

  const global: Record<string, unknown>[] = []
  const byTask = new Map<string, Record<string, unknown>[]>()

  for (const ev of events) {
    const tid = String(ev.task_id ?? '')
    if (!tid) {
      global.push(ev)
    } else {
      const arr = byTask.get(tid)
      if (arr) arr.push(ev)
      else byTask.set(tid, [ev])
    }
  }

  const groups: TaskGroup[] = []
  for (const [taskId, evts] of byTask) {
    groups.push({
      taskId,
      title: titleMap.get(taskId) ?? `Task ${taskId.slice(0, 8)}`,
      events: evts,
    })
  }
  groups.sort((a, b) => {
    const aTs = String(a.events[a.events.length - 1]?.timestamp ?? '')
    const bTs = String(b.events[b.events.length - 1]?.timestamp ?? '')
    return bTs.localeCompare(aTs)
  })

  return { global, groups }
}

function ActivityByTask({
  activity,
  collapsedTasks,
  onToggle,
  tasks,
}: {
  activity: Record<string, unknown>[]
  collapsedTasks: Set<string>
  onToggle: (id: string) => void
  tasks: TaskSummary[]
}) {
  const { global, groups } = useMemo(
    () => groupActivityByTask(activity, tasks),
    [activity, tasks],
  )

  return (
    <div className="activity-grouped">
      {global.length > 0 ? (
        <div className="task-group">
          <div className="task-group-header">
            <span className="task-group-icon">●</span>
            <span className="task-group-title">Global Events</span>
            <span className="task-group-count">{global.length}</span>
          </div>
          <div className="task-group-events">
            {global.map((ev, idx) => {
              const phase = String(ev.phase ?? '')
              const ts = String(ev.ts ?? ev.timestamp ?? '')
              const msg = String(ev.message ?? ev.detail ?? ev.event ?? JSON.stringify(ev))
              return (
                <div className="activity-item" key={`g-${idx}`}>
                  <span className="activity-ts">{formatTime(ts)}</span>
                  <span className={`activity-phase ${PHASE_CLASS[phase] ?? 'phase-system'}`}>{phase || '?'}</span>
                  <span className="activity-msg">{msg}</span>
                </div>
              )
            })}
          </div>
        </div>
      ) : null}

      {groups.map((group) => {
        const isCollapsed = collapsedTasks.has(group.taskId)
        const lastPhase = String(group.events[group.events.length - 1]?.phase ?? '')
        return (
          <div className="task-group" key={group.taskId}>
            <div
              className="task-group-header"
              onClick={() => onToggle(group.taskId)}
            >
              <span className={`task-group-chevron ${isCollapsed ? 'collapsed' : ''}`}>▾</span>
              <span className={`task-group-phase-dot ${PHASE_CLASS[lastPhase] ?? 'phase-system'}`} />
              <span className="task-group-title">{group.title}</span>
              <span className="task-group-id">{group.taskId.slice(0, 8)}</span>
              <span className="task-group-count">{group.events.length}</span>
            </div>
            {!isCollapsed ? (
              <div className="task-group-events">
                {group.events.map((ev, idx) => {
                  const phase = String(ev.phase ?? '')
                  const ts = String(ev.ts ?? ev.timestamp ?? '')
                  const action = String(ev.action ?? '')
                  const msg = String(ev.message ?? ev.detail ?? ev.event ?? '')
                  const success = ev.success
                  const reasoning = String(ev.reasoning ?? '')
                  return (
                    <div className={`activity-item-grouped ${success === false ? 'is-error' : ''}`} key={idx}>
                      <span className="activity-ts">{formatTime(ts)}</span>
                      <span className={`activity-phase ${PHASE_CLASS[phase] ?? 'phase-system'}`}>{phase}</span>
                      <div className="activity-body">
                        <span className="activity-action">{action}</span>
                        {msg ? <span className="activity-detail">{msg}</span> : null}
                        {success === true ? <span className="activity-ok">✓</span> : null}
                        {success === false ? <span className="activity-fail">✗</span> : null}
                        {reasoning ? <span className="activity-reasoning">{reasoning}</span> : null}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : null}
          </div>
        )
      })}

      {global.length === 0 && groups.length === 0 ? (
        <p className="log-empty">No activity events</p>
      ) : null}
    </div>
  )
}

function DashboardRoot() {
  const [activeTab, setActiveTab] = useState<DashboardTab>('tasks')
  const [metaText, setMetaText] = useState<string>('Loading...')
  const [toastText, setToastText] = useState<string>('')
  const [toastOk, setToastOk] = useState<boolean>(true)

  const [tasks, setTasks] = useState<TaskSummary[]>([])
  const [cycles, setCycles] = useState<CycleSummary[]>([])
  const [stats, setStats] = useState<DashboardStats>({})
  const [directive, setDirective] = useState<DirectivePayload | null>(null)
  const [bootstrapStatus, setBootstrapStatus] = useState<BootstrapStatusPayload | null>(null)

  const [taskDetail, setTaskDetail] = useState<TaskDetail | null>(null)
  const [taskEvents, setTaskEvents] = useState<TaskEvent[]>([])

  const [activity, setActivity] = useState<Record<string, unknown>[]>([])
  const [activityPhase, setActivityPhase] = useState<string>('')
  const [activityGroupBy, setActivityGroupBy] = useState<'time' | 'task'>('task')
  const [collapsedTasks, setCollapsedTasks] = useState<Set<string>>(new Set())

  const [audit, setAudit] = useState<LlmAuditEntry[]>([])
  const [auditDetail, setAuditDetail] = useState<Record<string, unknown> | null>(null)
  const [helpRequests, setHelpRequests] = useState<TaskSummary[]>([])
  const [helpCount, setHelpCount] = useState<number>(0)
  const [experiences, setExperiences] = useState<ExperienceEntry[]>([])
  const [registeredModels, setRegisteredModels] = useState<RegisteredModelEntry[]>([])
  const [bindingPoints, setBindingPoints] = useState<ModelBindingPointEntry[]>([])
  const [modelBindings, setModelBindings] = useState<Record<string, string>>({})

  const [injectTitle, setInjectTitle] = useState<string>('')
  const [injectDescription, setInjectDescription] = useState<string>('')
  const [injectPriority, setInjectPriority] = useState<number>(2)
  const [sourcesJson, setSourcesJson] = useState<string>('{}')
  const [modelType, setModelType] = useState<'llm' | 'embedding'>('llm')
  const [modelBaseUrl, setModelBaseUrl] = useState<string>('')
  const [modelApiPath, setModelApiPath] = useState<string>('')
  const [modelName, setModelName] = useState<string>('')
  const [modelApiKey, setModelApiKey] = useState<string>('')
  const [modelDesc, setModelDesc] = useState<string>('')
  const [editingModelId, setEditingModelId] = useState<string>('')
  const [deletingModelId, setDeletingModelId] = useState<string>('')

  const [pauseLoading, setPauseLoading] = useState<boolean>(false)
  const [resolvingTaskId, setResolvingTaskId] = useState<string>('')

  const showToast = (message: string, ok = true): void => {
    setToastText(message)
    setToastOk(ok)
    window.setTimeout(() => setToastText(''), 2800)
  }

  const refreshSummary = useCallback(async (): Promise<void> => {
    try {
      const [taskPayload, cyclePayload, statsPayload, directivePayload, bootstrapPayload] = await Promise.all([
        dashboardApiClient.getTasks(),
        dashboardApiClient.getCycles(),
        dashboardApiClient.getStats(),
        dashboardApiClient.getDirective(),
        dashboardApiClient.getBootstrapStatus(),
      ])

      setTasks(taskPayload.tasks ?? [])
      setCycles(cyclePayload.cycles ?? [])
      setStats(statsPayload)
      setHelpCount(Number(statsPayload.status_counts?.needs_human ?? 0))
      setDirective(directivePayload)
      setBootstrapStatus(bootstrapPayload)
      setSourcesJson(JSON.stringify(directivePayload.task_sources ?? {}, null, 2))
      setMetaText(`updated ${formatTime(taskPayload.updated_at)} · auto-refresh 5s`)
    } catch (error) {
      const message = `Refresh failed: ${String(error)}`
      setMetaText(message)
      showToast(message, false)
    }
  }, [])

  const togglePause = async (): Promise<void> => {
    if (pauseLoading || !directive) return
    setPauseLoading(true)
    try {
      const result = directive.paused
        ? await dashboardApiClient.resume()
        : await dashboardApiClient.pause()
      showToast(result.paused ? 'Agent paused' : 'Agent resumed')
      await refreshSummary()
    } catch (error) {
      showToast(`Toggle pause failed: ${String(error)}`, false)
    } finally {
      setPauseLoading(false)
    }
  }

  const openTaskDetail = useCallback(async (taskId: string): Promise<void> => {
    try {
      const payload = await dashboardApiClient.getTaskDetail(taskId)
      if (payload.error || !payload.task) {
        showToast(payload.error ?? 'Task not found', false)
        return
      }
      setTaskDetail(payload.task)
      setTaskEvents(payload.events ?? [])
      setActiveTab('detail')
    } catch (error) {
      showToast(`Failed to load task detail: ${String(error)}`, false)
    }
  }, [])

  const refreshActivity = useCallback(async (): Promise<void> => {
    try {
      const payload = await dashboardApiClient.getActivity(300, activityPhase)
      setActivity(payload.events)
    } catch (error) {
      showToast(`Failed to refresh activity: ${String(error)}`, false)
    }
  }, [activityPhase])

  const refreshAudit = useCallback(async (): Promise<void> => {
    try {
      const payload = await dashboardApiClient.getLlmAudit(100)
      setAudit(payload.entries)
    } catch (error) {
      showToast(`Failed to refresh audit: ${String(error)}`, false)
    }
  }, [])

  const openAuditDetail = useCallback(async (seq: number): Promise<void> => {
    try {
      const payload = await dashboardApiClient.getLlmAuditDetail(seq)
      if (payload.error || !payload.entry) {
        showToast(payload.error ?? 'Audit entry not found', false)
        return
      }
      setAuditDetail(payload.entry)
    } catch (error) {
      showToast(`Failed to load audit detail: ${String(error)}`, false)
    }
  }, [])

  const refreshHelpCenter = useCallback(async (): Promise<void> => {
    try {
      const payload = await dashboardApiClient.getHelpCenter()
      setHelpRequests(payload.requests ?? [])
    } catch (error) {
      showToast(`Failed to refresh help center: ${String(error)}`, false)
    }
  }, [])

  const refreshExperiences = useCallback(async (): Promise<void> => {
    try {
      const payload = await dashboardApiClient.getExperiences(200)
      setExperiences(payload.experiences ?? [])
    } catch (error) {
      showToast(`Failed to refresh experiences: ${String(error)}`, false)
    }
  }, [])

  const refreshModels = useCallback(async (): Promise<void> => {
    try {
      const payload = await dashboardApiClient.getModels()
      setRegisteredModels(payload.models ?? [])
      setBindingPoints(payload.binding_points ?? [])
      setModelBindings(
        Object.fromEntries(
          Object.entries(payload.bindings ?? {}).map(([bindingPoint, binding]) => [bindingPoint, binding.model_id ?? '']),
        ),
      )
    } catch (error) {
      showToast(`Failed to refresh model registry: ${String(error)}`, false)
    }
  }, [])

  const resetModelForm = useCallback((): void => {
    setEditingModelId('')
    setModelType('llm')
    setModelBaseUrl('')
    setModelApiPath('')
    setModelName('')
    setModelApiKey('')
    setModelDesc('')
  }, [])

  const startEditingModel = useCallback((model: RegisteredModelEntry): void => {
    setEditingModelId(model.id)
    setModelType(model.model_type)
    setModelBaseUrl(model.base_url ?? '')
    setModelApiPath(model.api_path ?? '')
    setModelName(model.model_name)
    setModelApiKey('')
    setModelDesc(model.desc ?? '')
  }, [])

  const resolveHelpRequest = async (taskId: string): Promise<void> => {
    if (resolvingTaskId) return
    const resolution = window.prompt(
      'Describe what you resolved (or leave blank):',
      '',
    )
    if (resolution === null) return
    setResolvingTaskId(taskId)
    try {
      const payload = await dashboardApiClient.resolveHelpRequest({
        task_id: taskId,
        resolution: resolution || 'Resolved via dashboard',
      })
      if (payload.error) {
        showToast(payload.error, false)
        return
      }
      showToast('Marked resolved, agent will continue verification')
      await Promise.all([refreshSummary(), refreshHelpCenter()])
    } catch (error) {
      showToast(`Resolve failed: ${String(error)}`, false)
    } finally {
      setResolvingTaskId('')
    }
  }

  const saveDirective = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!directive) {
      showToast('Directive not loaded', false)
      return
    }

    try {
      const form = new FormData(event.currentTarget)
      const payload: DirectivePayload = {
        paused: String(form.get('paused')) === 'true',
        poll_interval_seconds: Number(form.get('poll_interval_seconds') ?? 120),
        max_file_changes_per_task: Number(form.get('max_file_changes_per_task') ?? 10),
        focus_areas: String(form.get('focus_areas') ?? '')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
        forbidden_paths: String(form.get('forbidden_paths') ?? '')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
        custom_instructions: String(form.get('custom_instructions') ?? ''),
        task_sources: JSON.parse(sourcesJson),
      }

      await dashboardApiClient.saveDirective(payload)
      showToast('Directive saved')
      await refreshSummary()
    } catch (error) {
      showToast(`Save directive failed: ${String(error)}`, false)
    }
  }

  const injectTask = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const title = injectTitle.trim()
    if (!title) {
      showToast('Title required', false)
      return
    }

    try {
      await dashboardApiClient.injectTask({
        title,
        description: injectDescription,
        priority: injectPriority,
      })
      showToast('Task injected')
      setInjectTitle('')
      setInjectDescription('')
      setInjectPriority(2)
      await refreshSummary()
    } catch (error) {
      showToast(`Inject task failed: ${String(error)}`, false)
    }
  }

  const registerModel = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const baseUrl = modelBaseUrl.trim()
    const apiPath = modelApiPath.trim()
    const trimmedModelName = modelName.trim()
    const apiKey = modelApiKey.trim()
    const isEmbeddingRegistration = modelType === 'embedding'
    const hasRequiredEndpoint = isEmbeddingRegistration ? Boolean(apiPath) : Boolean(baseUrl)
    const requiresApiKey = !editingModelId
    if (!hasRequiredEndpoint || !trimmedModelName || (requiresApiKey && !apiKey)) {
      const message = requiresApiKey
        ? `${isEmbeddingRegistration ? 'API path' : 'Base URL'}, model name, and AK are required`
        : `${isEmbeddingRegistration ? 'API path' : 'Base URL'} and model name are required`
      showToast(message, false)
      return
    }

    try {
      const modelPayload = {
        model_type: modelType,
        base_url: baseUrl,
        api_path: apiPath,
        model_name: trimmedModelName,
        api_key: apiKey,
        desc: modelDesc.trim(),
      }
      const payload = editingModelId
        ? await dashboardApiClient.updateModel(editingModelId, modelPayload)
        : await dashboardApiClient.registerModel(modelPayload)
      if (payload.error) {
        showToast(payload.error, false)
        return
      }
      showToast(editingModelId ? 'Model updated' : 'Model registered')
      resetModelForm()
      await Promise.all([refreshModels(), refreshSummary()])
    } catch (error) {
      showToast(`${editingModelId ? 'Update' : 'Register'} model failed: ${String(error)}`, false)
    }
  }

  const deleteModel = async (model: RegisteredModelEntry): Promise<void> => {
    if (deletingModelId) return
    const confirmed = window.confirm(`Delete model "${model.model_name}"? Related bindings will be cleared.`)
    if (!confirmed) return

    setDeletingModelId(model.id)
    try {
      const payload = await dashboardApiClient.deleteModel(model.id)
      if (payload.error) {
        showToast(payload.error, false)
        return
      }
      if (editingModelId === model.id) {
        resetModelForm()
      }
      showToast('Model deleted')
      await Promise.all([refreshModels(), refreshSummary()])
    } catch (error) {
      showToast(`Delete model failed: ${String(error)}`, false)
    } finally {
      setDeletingModelId('')
    }
  }

  const saveModelBindings = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    try {
      const payload = await dashboardApiClient.saveModelBindings({ bindings: modelBindings })
      if (payload.error) {
        showToast(payload.error, false)
        return
      }
      showToast('Model bindings saved')
      await Promise.all([refreshModels(), refreshSummary()])
    } catch (error) {
      showToast(`Save model bindings failed: ${String(error)}`, false)
    }
  }

  useEffect(() => {
    const kickoffId = window.setTimeout(() => void refreshSummary(), 0)
    const timerId = window.setInterval(() => void refreshSummary(), 5000)
    return () => {
      window.clearTimeout(kickoffId)
      window.clearInterval(timerId)
    }
  }, [refreshSummary])

  useEffect(() => {
    if (activeTab !== 'activity') return
    const kickoffId = window.setTimeout(() => void refreshActivity(), 0)
    const timerId = window.setInterval(() => void refreshActivity(), 3000)
    return () => {
      window.clearTimeout(kickoffId)
      window.clearInterval(timerId)
    }
  }, [activeTab, refreshActivity])

  useEffect(() => {
    if (activeTab !== 'audit') return
    const kickoffId = window.setTimeout(() => void refreshAudit(), 0)
    const timerId = window.setInterval(() => void refreshAudit(), 5000)
    return () => {
      window.clearTimeout(kickoffId)
      window.clearInterval(timerId)
    }
  }, [activeTab, refreshAudit])

  useEffect(() => {
    if (activeTab !== 'help') return
    const kickoffId = window.setTimeout(() => void refreshHelpCenter(), 0)
    const timerId = window.setInterval(() => void refreshHelpCenter(), 5000)
    return () => {
      window.clearTimeout(kickoffId)
      window.clearInterval(timerId)
    }
  }, [activeTab, refreshHelpCenter])

  useEffect(() => {
    if (activeTab !== 'experience') return
    const kickoffId = window.setTimeout(() => void refreshExperiences(), 0)
    const timerId = window.setInterval(() => void refreshExperiences(), 8000)
    return () => {
      window.clearTimeout(kickoffId)
      window.clearInterval(timerId)
    }
  }, [activeTab, refreshExperiences])

  useEffect(() => {
    if (activeTab !== 'models') return
    const kickoffId = window.setTimeout(() => void refreshModels(), 0)
    const timerId = window.setInterval(() => void refreshModels(), 8000)
    return () => {
      window.clearTimeout(kickoffId)
      window.clearInterval(timerId)
    }
  }, [activeTab, refreshModels])

  useEffect(() => {
    if (!bootstrapStatus?.requires_setup) return
    if (activeTab !== 'models') {
      setActiveTab('models')
    }
  }, [activeTab, bootstrapStatus])

  const sortedStatus = useMemo(() => {
    return Object.entries(stats.status_counts ?? {}).sort((left, right) => Number(right[1]) - Number(left[1]))
  }, [stats])
  const isEditingModel = Boolean(editingModelId)
  const isEmbeddingModel = modelType === 'embedding'
  const modelEndpointLabel = isEmbeddingModel ? 'API Path' : 'Base URL'
  const modelEndpointHint = isEmbeddingModel
    ? 'The full embedding endpoint path, for example `https://ark-cn-beijing.bytedance.net/api/v3/embeddings/multimodal`.'
    : 'The OpenAI-compatible API root for this provider, for example `https://example.com/v1`.'
  const modelEndpointPlaceholder = isEmbeddingModel
    ? 'https://ark-cn-beijing.bytedance.net/api/v3/embeddings/multimodal'
    : 'https://example.com/v1'
  const modelFormTitle = isEditingModel ? 'Edit Model' : 'Register Model'
  const modelFormSubtitle = isEditingModel
    ? 'Update one registered model. Leave AK empty to keep the current secret.'
    : 'Store reusable LLM base URLs or embedding API paths for dashboard binding.'

  return (
    <main className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Sprout Agent V2</p>
          <h1>Control Plane</h1>
        </div>
        <div className="hero-actions">
          {directive ? (
            <button
              type="button"
              className={`pause-btn ${directive.paused ? 'is-paused' : 'is-running'}`}
              disabled={pauseLoading}
              onClick={() => void togglePause()}
            >
              <span className="status-dot" />
              {pauseLoading ? '...' : directive.paused ? 'Resume Agent' : 'Pause Agent'}
            </button>
          ) : null}
          <p className="meta">{metaText}</p>
        </div>
      </header>

      <section className="stat-grid">
        {bootstrapStatus?.requires_setup ? (
          <article className="stat-card setup-card">
            <p>Initialization</p>
            <strong>Required</strong>
            <small className="setup-copy">{bootstrapStatus.message}</small>
          </article>
        ) : null}
        <article className="stat-card"><p>Total Tasks</p><strong>{stats.total_tasks ?? 0}</strong></article>
        <article className="stat-card"><p>Total Cycles</p><strong>{stats.total_cycles ?? 0}</strong></article>
        <article className="stat-card"><p>Total Tokens</p><strong>{(stats.total_tokens ?? 0).toLocaleString()}</strong></article>
        {sortedStatus.map(([status, count]) => (
          <article className="stat-card" key={status}><p>{status}</p><strong>{String(count)}</strong></article>
        ))}
      </section>

      <nav className="tabbar">
        <button data-active={activeTab === 'tasks'} onClick={() => setActiveTab('tasks')}>Tasks</button>
        {taskDetail ? <button data-active={activeTab === 'detail'} onClick={() => setActiveTab('detail')}>Detail</button> : null}
        <button data-active={activeTab === 'cycles'} onClick={() => setActiveTab('cycles')}>Cycles</button>
        <button data-active={activeTab === 'activity'} onClick={() => setActiveTab('activity')}>Activity</button>
        <button data-active={activeTab === 'audit'} onClick={() => setActiveTab('audit')}>LLM Audit</button>
        <button data-active={activeTab === 'help'} onClick={() => setActiveTab('help')}>
          Help Center {helpCount > 0 ? `(${helpCount})` : ''}
        </button>
        <button data-active={activeTab === 'experience'} onClick={() => setActiveTab('experience')}>Experience</button>
        <button data-active={activeTab === 'models'} onClick={() => setActiveTab('models')}>Models</button>
        <button data-active={activeTab === 'control'} onClick={() => setActiveTab('control')}>Control</button>
        <button data-active={activeTab === 'inject'} onClick={() => setActiveTab('inject')}>Inject</button>
      </nav>

      {/* ── Tasks Table ─── */}
      {activeTab === 'tasks' ? (
        <section className="panel">
          <table>
            <thead>
              <tr>
                <th style={{ minWidth: 260 }}>Task</th>
                <th>Status</th>
                <th>Priority</th>
                <th>Source</th>
                <th>Tokens</th>
                <th>Time</th>
                <th>PR</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => (
                <tr key={task.id} onClick={() => void openTaskDetail(task.id)}>
                  <td>
                    <strong>{task.title}</strong>
                    <small>{task.id}</small>
                  </td>
                  <td>
                    <span className={`badge ${STATUS_CLASS[task.status] ?? ''}`}>
                      {task.status}
                    </span>
                  </td>
                  <td>
                    <span className={`priority priority-${task.priority}`}>P{task.priority}</span>
                  </td>
                  <td><span className="source-tag">{task.source}</span></td>
                  <td className="numeric">{task.token_cost ? task.token_cost.toLocaleString() : '-'}</td>
                  <td className="numeric">{task.time_cost_seconds ? `${task.time_cost_seconds.toFixed(1)}s` : '-'}</td>
                  <td>
                    {task.pr_url
                      ? <a className="pr-link" href={task.pr_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>PR</a>
                      : <span className="numeric">-</span>}
                  </td>
                </tr>
              ))}
              {tasks.length === 0 ? (
                <tr><td colSpan={7} className="log-empty">No tasks yet</td></tr>
              ) : null}
            </tbody>
          </table>
        </section>
      ) : null}

      {/* ── Task Detail ─── */}
      {activeTab === 'detail' && taskDetail ? (
        <section className="panel">
          <div className="detail-header">
            <h2>{taskDetail.title}</h2>
            <dl className="detail-meta">
              <div>
                <dt>Status</dt>
                <dd><span className={`badge ${STATUS_CLASS[taskDetail.status] ?? ''}`}>{taskDetail.status}</span></dd>
              </div>
              <div>
                <dt>Priority</dt>
                <dd><span className={`priority priority-${taskDetail.priority}`}>P{taskDetail.priority}</span></dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd><span className="source-tag">{taskDetail.source}</span></dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{formatDateTime(taskDetail.created_at)}</dd>
              </div>
              <div>
                <dt>Updated</dt>
                <dd style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{formatDateTime(taskDetail.updated_at)}</dd>
              </div>
              {taskDetail.token_cost ? (
                <div>
                  <dt>Tokens</dt>
                  <dd style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{taskDetail.token_cost.toLocaleString()}</dd>
                </div>
              ) : null}
              {taskDetail.time_cost_seconds ? (
                <div>
                  <dt>Duration</dt>
                  <dd style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{taskDetail.time_cost_seconds.toFixed(1)}s</dd>
                </div>
              ) : null}
              {taskDetail.branch_name ? (
                <div>
                  <dt>Branch</dt>
                  <dd style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{taskDetail.branch_name}</dd>
                </div>
              ) : null}
              {taskDetail.pr_url ? (
                <div>
                  <dt>PR</dt>
                  <dd><a className="pr-link" href={taskDetail.pr_url} target="_blank" rel="noreferrer">View Pull Request</a></dd>
                </div>
              ) : null}
            </dl>
          </div>

          <div className="detail-body">
            {taskDetail.description ? (
              <div className="detail-section">
                <h3 className="detail-section-title">Description</h3>
                <p style={{ margin: 0, lineHeight: 1.6, fontSize: 13 }}>{taskDetail.description}</p>
              </div>
            ) : null}

            {taskDetail.error_message ? (
              <div className="detail-section">
                <h3 className="detail-section-title" style={{ color: 'var(--danger)' }}>Error</h3>
                <pre style={{ borderColor: 'rgba(248,81,73,0.3)', color: 'var(--danger)' }}>{taskDetail.error_message}</pre>
              </div>
            ) : null}

            {taskDetail.human_help_request ? (
              <div className="detail-section">
                <h3 className="detail-section-title" style={{ color: 'var(--warn)' }}>Human Help Request</h3>
                <pre style={{ borderColor: 'rgba(210,153,34,0.3)', color: 'var(--warn)' }}>{taskDetail.human_help_request}</pre>
              </div>
            ) : null}

            {taskDetail.plan ? (
              <div className="detail-section">
                <h3 className="detail-section-title">Execution Plan</h3>
                <pre>{taskDetail.plan}</pre>
              </div>
            ) : null}

            {taskDetail.execution_log ? (
              <div className="detail-section">
                <h3 className="detail-section-title">Execution Log</h3>
                <pre>{taskDetail.execution_log}</pre>
              </div>
            ) : null}

            {taskDetail.verification_result ? (
              <div className="detail-section">
                <h3 className="detail-section-title">Verification</h3>
                <pre>{taskDetail.verification_result}</pre>
              </div>
            ) : null}

            {taskDetail.whats_learned ? (
              <div className="detail-section">
                <h3 className="detail-section-title">What Was Learned</h3>
                <pre>{taskDetail.whats_learned}</pre>
              </div>
            ) : null}

            <div className="detail-section">
              <h3 className="detail-section-title">
                Events <span className="count">{taskEvents.length}</span>
              </h3>
              {taskEvents.length > 0 ? (
                <div className="timeline">
                  {taskEvents.map((ev, idx) => (
                    <div className="timeline-item" key={idx}>
                      <span className="timeline-type">{ev.event_type}</span>
                      <span className="timeline-time">{formatTime(ev.created_at)}</span>
                      {ev.detail ? <div className="timeline-detail">{ev.detail}</div> : null}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="log-empty">No events recorded</p>
              )}
            </div>
          </div>
        </section>
      ) : null}

      {/* ── Cycles Table ─── */}
      {activeTab === 'cycles' ? (
        <section className="panel">
          <table>
            <thead>
              <tr>
                <th>Cycle</th>
                <th>Status</th>
                <th>Started</th>
                <th>Completed</th>
                <th>Discovered</th>
                <th>Executed</th>
                <th>Completed</th>
                <th>Failed</th>
              </tr>
            </thead>
            <tbody>
              {cycles.map((cycle) => (
                <tr key={cycle.id}>
                  <td className="numeric">#{cycle.id}</td>
                  <td><span className={`badge ${STATUS_CLASS[cycle.status] ?? ''}`}>{cycle.status}</span></td>
                  <td className="numeric">{formatDateTime(cycle.started_at)}</td>
                  <td className="numeric">{formatDateTime(cycle.completed_at)}</td>
                  <td className="numeric">{cycle.discovered}</td>
                  <td className="numeric">{cycle.executed}</td>
                  <td className="numeric">{cycle.completed}</td>
                  <td className="numeric">{cycle.failed > 0 ? <span style={{ color: 'var(--danger)' }}>{cycle.failed}</span> : cycle.failed}</td>
                </tr>
              ))}
              {cycles.length === 0 ? (
                <tr><td colSpan={8} className="log-empty">No cycles yet</td></tr>
              ) : null}
            </tbody>
          </table>
        </section>
      ) : null}

      {/* ── Activity Feed ─── */}
      {activeTab === 'activity' ? (
        <section className="panel">
          <div className="toolbar">
            <select value={activityPhase} onChange={(event) => setActivityPhase(event.target.value)}>
              <option value="">All phases</option>
              <option value="cycle">cycle</option>
              <option value="discover">discover</option>
              <option value="value">value</option>
              <option value="plan">plan</option>
              <option value="execute">execute</option>
              <option value="verify">verify</option>
              <option value="git">git</option>
              <option value="decision">decision</option>
              <option value="system">system</option>
            </select>
            <div className="view-toggle">
              <button
                type="button"
                className={activityGroupBy === 'time' ? 'active' : ''}
                onClick={() => setActivityGroupBy('time')}
              >Timeline</button>
              <button
                type="button"
                className={activityGroupBy === 'task' ? 'active' : ''}
                onClick={() => setActivityGroupBy('task')}
              >By Task</button>
            </div>
            <button type="button" onClick={() => void refreshActivity()}>Refresh</button>
          </div>

          {activityGroupBy === 'time' ? (
            <div className="activity-feed">
              {activity.length > 0 ? (
                [...activity].reverse().map((ev, idx) => {
                  const phase = String(ev.phase ?? '')
                  const ts = String(ev.ts ?? ev.timestamp ?? '')
                  const msg = String(ev.message ?? ev.detail ?? ev.event ?? JSON.stringify(ev))
                  const taskId = String(ev.task_id ?? '')
                  return (
                    <div className="activity-item" key={idx}>
                      <span className="activity-ts">{formatTime(ts)}</span>
                      <span className={`activity-phase ${PHASE_CLASS[phase] ?? 'phase-system'}`}>{phase || '?'}</span>
                      <span className="activity-msg">
                        {taskId ? <span className="activity-task-id">{taskId.slice(0, 8)}</span> : null}
                        {msg}
                      </span>
                    </div>
                  )
                })
              ) : (
                <p className="log-empty">No activity events</p>
              )}
            </div>
          ) : (
            <ActivityByTask
              activity={activity}
              collapsedTasks={collapsedTasks}
              onToggle={(id) => {
                setCollapsedTasks((prev) => {
                  const next = new Set(prev)
                  if (next.has(id)) next.delete(id)
                  else next.add(id)
                  return next
                })
              }}
              tasks={tasks}
            />
          )}
        </section>
      ) : null}

      {/* ── LLM Audit ─── */}
      {activeTab === 'audit' ? (
        <section className="panel">
          <table>
            <thead>
              <tr>
                <th>Seq</th>
                <th>Model</th>
                <th>Prompt / Completion</th>
                <th>Latency</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {[...audit].reverse().map((entry) => (
                <tr key={entry.seq} onClick={() => void openAuditDetail(entry.seq)}>
                  <td className="numeric">{entry.seq}</td>
                  <td><span className="source-tag">{entry.model ?? '-'}</span></td>
                  <td className="numeric">{`${(entry.prompt_tokens ?? 0).toLocaleString()} / ${(entry.completion_tokens ?? 0).toLocaleString()}`}</td>
                  <td className="numeric">{entry.duration_ms ? `${(entry.duration_ms / 1000).toFixed(1)}s` : '-'}</td>
                  <td className="numeric">{formatTime(entry.ts)}</td>
                </tr>
              ))}
              {audit.length === 0 ? (
                <tr><td colSpan={5} className="log-empty">No audit entries</td></tr>
              ) : null}
            </tbody>
          </table>
          {auditDetail ? (
            <div style={{ padding: 16, borderTop: '1px solid var(--line)' }}>
              <h3 className="detail-section-title" style={{ marginBottom: 10 }}>
                Audit Entry #{String(auditDetail.seq ?? '')}
              </h3>
              <pre>{JSON.stringify(auditDetail, null, 2)}</pre>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* ── Help Center ─── */}
      {activeTab === 'help' ? (
        <section className="panel">
          <table>
            <thead>
              <tr>
                <th style={{ minWidth: 240 }}>Task</th>
                <th>Need Human Help</th>
                <th>Status</th>
                <th>Updated</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {helpRequests.map((task) => (
                <tr key={task.id}>
                  <td>
                    <strong>{task.title}</strong>
                    <small>{task.id}</small>
                  </td>
                  <td>
                    <div className="help-request-cell">
                      {task.human_help_request || 'No detail provided'}
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${STATUS_CLASS[task.status] ?? ''}`}>
                      {task.status}
                    </span>
                  </td>
                  <td className="numeric">{formatDateTime(task.updated_at)}</td>
                  <td>
                    <button
                      type="button"
                      className="resolve-btn"
                      disabled={resolvingTaskId === task.id}
                      onClick={() => void resolveHelpRequest(task.id)}
                    >
                      {resolvingTaskId === task.id ? 'Resolving...' : 'Resolve'}
                    </button>
                  </td>
                </tr>
              ))}
              {helpRequests.length === 0 ? (
                <tr><td colSpan={5} className="log-empty">No unresolved human-help requests</td></tr>
              ) : null}
            </tbody>
          </table>
        </section>
      ) : null}

      {/* ── Experience ─── */}
      {activeTab === 'experience' ? (
        <section className="panel">
          <table>
            <thead>
              <tr>
                <th>Task ID</th>
                <th>Category</th>
                <th style={{ minWidth: 260 }}>Summary</th>
                <th>Confidence</th>
                <th>Applied Count</th>
                <th>Outcome</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {experiences.map((exp) => (
                <tr key={exp.id}>
                  <td className="numeric">{exp.task_id || '-'}</td>
                  <td><span className="source-tag">{exp.category}</span></td>
                  <td>
                    <div className="exp-summary">{exp.summary}</div>
                    {exp.detail ? <small className="exp-detail">{exp.detail}</small> : null}
                  </td>
                  <td className="numeric">{typeof exp.confidence === 'number' ? exp.confidence.toFixed(2) : '-'}</td>
                  <td className="numeric">{Number(exp.applied_count ?? 0)}</td>
                  <td><span className="source-tag">{exp.source_outcome || '-'}</span></td>
                  <td className="numeric">{formatDateTime(exp.created_at)}</td>
                </tr>
              ))}
              {experiences.length === 0 ? (
                <tr><td colSpan={7} className="log-empty">No experience entries yet</td></tr>
              ) : null}
            </tbody>
          </table>
        </section>
      ) : null}

      {activeTab === 'models' ? (
        <div className="stack-layout">
          <section className="panel">
            <table>
              <thead>
                <tr>
                  <th>Type</th>
                  <th style={{ minWidth: 320 }}>Model</th>
                  <th style={{ minWidth: 320 }}>Endpoint</th>
                  <th>AK</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {registeredModels.map((model) => (
                  <tr key={model.id}>
                    <td><span className="source-tag">{model.model_type}</span></td>
                    <td>
                      <strong>{model.model_name}</strong>
                      <small>{model.id}</small>
                      {model.connection_status ? (
                        <div className="model-connection">
                          <span className={`connection-dot connection-${model.connection_status}`} />
                          <span className={`connection-label connection-${model.connection_status}`}>
                            {MODEL_CONNECTION_LABEL[model.connection_status] ?? model.connection_status}
                          </span>
                          {model.connection_checked_at ? (
                            <span className="connection-meta">{formatTime(model.connection_checked_at)}</span>
                          ) : null}
                        </div>
                      ) : null}
                      {model.connection_message ? <div className="connection-message">{model.connection_message}</div> : null}
                      {model.desc ? <div className="model-desc">{model.desc}</div> : null}
                    </td>
                    <td className="numeric">{model.model_type === 'embedding' ? model.api_path || '-' : model.base_url || '-'}</td>
                    <td className="numeric">{model.api_key_preview}</td>
                    <td className="numeric">{formatDateTime(model.created_at)}</td>
                    <td>
                      <div className="row-actions">
                        <button
                          type="button"
                          className="table-action"
                          onClick={() => startEditingModel(model)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="table-action table-action-danger"
                          disabled={deletingModelId === model.id}
                          onClick={() => void deleteModel(model)}
                        >
                          {deletingModelId === model.id ? 'Deleting...' : 'Delete'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {registeredModels.length === 0 ? (
                  <tr><td colSpan={6} className="log-empty">No registered models yet</td></tr>
                ) : null}
              </tbody>
            </table>
          </section>

          <section className="panel panel-padded">
            <div className="panel-heading">
              <div>
                <p className="section-kicker">Registry</p>
                <h2 className="panel-title">{modelFormTitle}</h2>
                <p className="panel-subtitle">{modelFormSubtitle}</p>
              </div>
            </div>
            <form onSubmit={(event) => void registerModel(event)}>
              <div className="field-grid">
                <label>Model Type
                  <span className="field-hint">Choose whether this endpoint serves chat/completion calls or embedding vectors.</span>
                  <select value={modelType} onChange={(event) => setModelType(event.target.value as 'llm' | 'embedding')}>
                    <option value="llm">LLM</option>
                    <option value="embedding">Embedding</option>
                  </select>
                </label>
                <label>{modelEndpointLabel}
                  <span className="field-hint">{modelEndpointHint}</span>
                  <input
                    value={isEmbeddingModel ? modelApiPath : modelBaseUrl}
                    onChange={(event) => {
                      if (isEmbeddingModel) {
                        setModelApiPath(event.target.value)
                        return
                      }
                      setModelBaseUrl(event.target.value)
                    }}
                    placeholder={modelEndpointPlaceholder}
                  />
                </label>
                <label>Model Name
                  <span className="field-hint">The remote model identifier sent in the `model` field, such as `doubao-seed-1-6`.</span>
                  <input value={modelName} onChange={(event) => setModelName(event.target.value)} placeholder="doubao-seed-1-6" />
                </label>
                <label>AK
                  <span className="field-hint">
                    {isEditingModel
                      ? 'Optional during edit. Leave empty to keep the current API key.'
                      : 'The API key or access key used to authenticate requests to this endpoint.'}
                  </span>
                  <input value={modelApiKey} onChange={(event) => setModelApiKey(event.target.value)} placeholder="Input API key" />
                </label>
              </div>
              <label>Description
                <span className="field-hint">Optional note for humans. Use it to explain purpose, owner, region, quota, or intended binding.</span>
                <textarea value={modelDesc} onChange={(event) => setModelDesc(event.target.value)} placeholder="Example: Primary production LLM for planning and task scoring." />
              </label>
              <div className="form-actions">
                <button type="submit">{isEditingModel ? 'Save Changes' : 'Register Model'}</button>
                {isEditingModel ? (
                  <button type="button" className="secondary-btn" onClick={() => resetModelForm()}>
                    Cancel
                  </button>
                ) : null}
              </div>
            </form>
          </section>

          <section className="panel panel-padded">
            <div className="panel-heading">
              <div>
                <p className="section-kicker">Routing</p>
                <h2 className="panel-title">Binding Points</h2>
                <p className="panel-subtitle">Map each runtime call site to one registered model.</p>
              </div>
            </div>
            <form onSubmit={(event) => void saveModelBindings(event)}>
              <div className="binding-grid">
                {bindingPoints.map((bindingPoint) => {
                  const availableModels = registeredModels.filter((model) => model.model_type === bindingPoint.model_type)
                  return (
                    <label className="binding-card" key={bindingPoint.binding_point}>
                      <span className="binding-title-row">
                        <span className="binding-title">{bindingPoint.label}</span>
                        <span className="source-tag">{bindingPoint.model_type}</span>
                      </span>
                      <span className="binding-description">{bindingPoint.description}</span>
                      <select
                        value={modelBindings[bindingPoint.binding_point] ?? ''}
                        onChange={(event) => {
                          const nextModelId = event.target.value
                          setModelBindings((current) => ({ ...current, [bindingPoint.binding_point]: nextModelId }))
                        }}
                      >
                        <option value="">Use default registered LLM</option>
                        {availableModels.map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.model_name} · {model.api_key_preview}
                          </option>
                        ))}
                      </select>
                    </label>
                  )
                })}
              </div>
              <div className="form-actions">
                <button type="submit">Save Bindings</button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {/* ── Control Panel ─── */}
      {activeTab === 'control' && directive ? (
        <section className="panel panel-padded">
          <form onSubmit={(event) => void saveDirective(event)}>
            <div className="field-grid">
              <label>Status
                <select name="paused" defaultValue={directive.paused ? 'true' : 'false'}>
                  <option value="false">Running</option>
                  <option value="true">Paused</option>
                </select>
              </label>
              <label>Poll Interval (seconds)
                <input name="poll_interval_seconds" type="number" min={10} defaultValue={directive.poll_interval_seconds} />
              </label>
              <label>Max File Changes
                <input name="max_file_changes_per_task" type="number" min={1} defaultValue={directive.max_file_changes_per_task} />
              </label>
            </div>
            <label>Focus Areas
              <input name="focus_areas" defaultValue={directive.focus_areas.join(', ')} />
            </label>
            <label>Forbidden Paths
              <input name="forbidden_paths" defaultValue={directive.forbidden_paths.join(', ')} />
            </label>
            <label>Custom Instructions
              <textarea name="custom_instructions" defaultValue={directive.custom_instructions} />
            </label>
            <label>Task Sources (JSON)
              <textarea value={sourcesJson} onChange={(event) => setSourcesJson(event.target.value)} rows={8} />
            </label>
            <button type="submit">Save Directive</button>
          </form>
        </section>
      ) : null}

      {/* ── Inject Task ─── */}
      {activeTab === 'inject' ? (
        <section className="panel panel-padded">
          <form onSubmit={(event) => void injectTask(event)}>
            <label>Title
              <input value={injectTitle} onChange={(event) => setInjectTitle(event.target.value)} placeholder="Task title" />
            </label>
            <label>Description
              <textarea value={injectDescription} onChange={(event) => setInjectDescription(event.target.value)} placeholder="What should the agent do?" />
            </label>
            <label>Priority (1 = highest, 5 = lowest)
              <input type="number" min={1} max={5} value={injectPriority} onChange={(event) => setInjectPriority(Number(event.target.value) || 2)} />
            </label>
            <button type="submit">Inject Task</button>
          </form>
        </section>
      ) : null}

      {toastText ? <div className={`toast ${toastOk ? 'ok' : 'error'}`}>{toastText}</div> : null}
    </main>
  )
}

export default DashboardRoot
