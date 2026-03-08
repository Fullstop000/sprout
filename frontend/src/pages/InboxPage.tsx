import { useState } from 'react'
import { Inbox, MessageSquareReply, MessagesSquare, Plus, RefreshCw, SquareCheckBig } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { PriorityBadge } from '@/components/ui/priority-badge'
import { StatusBadge } from '@/components/ui/status-badge'
import { Textarea } from '@/components/ui/textarea'
import { InlineNotice } from '@/components/ui/inline-notice'

import { dashboardApiClient } from '../api/dashboardApi'
import type { TaskDetail, TaskEvent, ThreadDetail, ThreadSummary } from '../types/dashboard'
import { formatDateTime, formatTime } from '../lib/dashboardView'

const STATUS_LABELS: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  open: { label: 'Open', variant: 'secondary' },
  waiting_reply: { label: 'Waiting for you', variant: 'destructive' },
  replied: { label: 'Replied', variant: 'default' },
  closed: { label: 'Closed', variant: 'outline' },
}

interface InboxPageProps {
  threads: ThreadSummary[]
  threadDetail: ThreadDetail | null
  errorMessage?: string
  onSelectThread: (threadId: string) => void
  onReply: (threadId: string, body: string) => Promise<void>
  onCreateThread: (title: string, description: string) => Promise<void>
  onCloseThread: (threadId: string, reason: string) => Promise<void>
  onBulkClose: (threadIds: string[]) => Promise<void>
  onRefresh: () => void
  replying: boolean
  creating: boolean
}

function surfaceClass(): string {
  return 'rounded-[1.75rem] border border-stone-200 bg-white/88 shadow-[0_20px_50px_rgba(53,44,34,0.06)]'
}

export function InboxPage({
  threads,
  threadDetail,
  errorMessage,
  onSelectThread,
  onReply,
  onCreateThread,
  onCloseThread,
  onBulkClose,
  onRefresh,
  replying,
  creating,
}: InboxPageProps) {
  const [replyText, setReplyText] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [showNewForm, setShowNewForm] = useState(false)
  const [showCloseForm, setShowCloseForm] = useState(false)
  const [closeReason, setCloseReason] = useState('')
  const [closing, setClosing] = useState(false)
  const [taskModal, setTaskModal] = useState<{ detail: TaskDetail; events: TaskEvent[] } | null>(null)
  const [loadingTaskId, setLoadingTaskId] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const activeStatuses = ['waiting_reply', 'open', 'replied']
  const active = threads.filter((t) => activeStatuses.includes(t.status))
  const closed = threads.filter((t) => t.status === 'closed')

  const handleReply = async () => {
    if (!threadDetail || !replyText.trim() || replying) return
    await onReply(threadDetail.thread.id, replyText.trim())
    setReplyText('')
  }

  const handleCreate = async () => {
    if (!newTitle.trim() || creating) return
    await onCreateThread(newTitle.trim(), newDescription.trim())
    setNewTitle('')
    setNewDescription('')
    setShowNewForm(false)
  }

  const handleClose = async () => {
    if (!threadDetail || closing) return
    setClosing(true)
    await onCloseThread(threadDetail.thread.id, closeReason.trim())
    setClosing(false)
    setCloseReason('')
    setShowCloseForm(false)
  }

  const handleBulkClose = async () => {
    if (selected.size === 0) return
    await onBulkClose([...selected])
    setSelected(new Set())
  }

  const openTaskModal = async (taskId: string) => {
    if (loadingTaskId) return
    setLoadingTaskId(taskId)
    try {
      const payload = await dashboardApiClient.getTaskDetail(taskId)
      if (payload.task) {
        setTaskModal({ detail: payload.task as TaskDetail, events: (payload.events ?? []) as TaskEvent[] })
      }
    } finally {
      setLoadingTaskId('')
    }
  }

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectableIds = active.map((t) => t.id)
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id))
  const toggleSelectAll = () => {
    setSelected(allSelected ? new Set() : new Set(selectableIds))
  }

  return (
    <div className="space-y-5">
      {errorMessage && (
        <InlineNotice
          detail={errorMessage}
          onAction={onRefresh}
          title="Inbox is temporarily unavailable"
          tone="warning"
        />
      )}
      <section className="flex flex-wrap items-start justify-between gap-4 rounded-[1.5rem] border border-stone-200 bg-[linear-gradient(180deg,rgba(249,246,239,0.92),rgba(255,255,255,0.92))] px-5 py-5 shadow-[0_16px_40px_rgba(53,44,34,0.05)]">
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500">Inbox</p>
          <h3 className="font-serif text-3xl tracking-[-0.03em] text-stone-950">Async threads with the agent</h3>
          <p className="max-w-3xl text-sm leading-6 text-stone-600">
            Use this space for low-frequency human-agent exchange. The list is compact, the thread view is readable, and linked task evidence stays one click away.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button className="rounded-full border-stone-200 bg-white text-stone-700 hover:bg-stone-50" size="sm" variant="outline" onClick={onRefresh}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          <Button className="rounded-full bg-stone-950 text-stone-50 hover:bg-stone-800" size="sm" onClick={() => setShowNewForm((v) => !v)}>
            <Plus className="h-4 w-4" />
            New thread
          </Button>
        </div>
      </section>

      <div className="grid min-h-0 gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <aside className={`${surfaceClass()} min-h-0 overflow-hidden`}>
          <div className="space-y-4 px-5 py-5">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">Thread List</p>
                <p className="text-sm text-stone-600">{active.length} active · {closed.length} closed</p>
              </div>
              {selected.size > 0 && (
                <Button className="rounded-full border-stone-200 bg-white text-stone-700 hover:bg-stone-50" size="sm" variant="outline" onClick={() => void handleBulkClose()}>
                  Close {selected.size}
                </Button>
              )}
            </div>

            {showNewForm && (
              <div className="rounded-[1.25rem] border border-stone-200 bg-stone-50/80 p-4">
                <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">
                  <MessagesSquare className="h-4 w-4" />
                  Start new thread
                </div>
                <div className="mt-4 space-y-3">
                  <Input
                    placeholder="Title"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    className="border-stone-200 bg-white text-stone-800"
                  />
                  <Textarea
                    placeholder="Description (optional)"
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                    rows={3}
                    className="border-stone-200 bg-white text-stone-800"
                  />
                  <div className="flex gap-2">
                    <Button className="rounded-full bg-stone-950 text-stone-50 hover:bg-stone-800" size="sm" onClick={() => void handleCreate()} disabled={creating || !newTitle.trim()}>
                      {creating ? 'Sending…' : 'Send'}
                    </Button>
                    <Button className="rounded-full border-stone-200 bg-white text-stone-700 hover:bg-stone-50" size="sm" variant="outline" onClick={() => setShowNewForm(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {active.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 px-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    className="h-3.5 w-3.5 rounded border-stone-300 accent-[hsl(var(--primary))] cursor-pointer"
                  />
                  <SquareCheckBig className="h-4 w-4" />
                  Active threads
                </div>
                <div className="space-y-2">
                  {active.map((thread) => (
                    <ThreadRow
                      key={thread.id}
                      thread={thread}
                      isSelected={threadDetail?.thread.id === thread.id}
                      isChecked={selected.has(thread.id)}
                      onCheck={() => toggleSelect(thread.id)}
                      onClick={() => onSelectThread(thread.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {closed.length > 0 && (
              <div className="space-y-2 border-t border-stone-200 pt-4">
                <p className="px-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">Closed threads</p>
                <div className="space-y-2">
                  {closed.map((thread) => (
                    <ThreadRow
                      key={thread.id}
                      thread={thread}
                      isSelected={threadDetail?.thread.id === thread.id}
                      isChecked={false}
                      onCheck={() => {}}
                      onClick={() => onSelectThread(thread.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {threads.length === 0 && (
              <div className="rounded-[1.25rem] border border-dashed border-stone-300 bg-stone-50/80 p-6 text-center text-sm text-stone-500">
                No threads yet.
              </div>
            )}
          </div>
        </aside>

        <section className={`${surfaceClass()} min-h-0 overflow-hidden`}>
          {!threadDetail ? (
            <div className="flex h-full min-h-[420px] items-center justify-center px-8 py-12 text-center">
              <div className="max-w-md space-y-3">
                <Inbox className="mx-auto h-8 w-8 text-stone-400" />
                <h4 className="font-serif text-3xl tracking-[-0.03em] text-stone-950">Select a thread to read the exchange</h4>
                <p className="text-sm leading-6 text-stone-600">
                  The conversation pane will show the thread, linked tasks, and reply actions once a thread is selected.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex h-full min-h-[520px] flex-col">
              <div className="flex flex-col gap-4 border-b border-stone-200 bg-[linear-gradient(180deg,rgba(249,246,239,0.92),rgba(255,255,255,0.92))] px-6 py-5 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0 space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">Conversation</p>
                  <h4 className="truncate font-serif text-3xl tracking-[-0.03em] text-stone-950">{threadDetail.thread.title}</h4>
                  <p className="text-sm text-stone-600">
                    Created by {threadDetail.thread.created_by} · {formatDateTime(threadDetail.thread.created_at)}
                  </p>
                  {threadDetail.task_ids.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <span className="text-xs uppercase tracking-[0.16em] text-stone-500">Linked tasks</span>
                      {threadDetail.task_ids.map((id) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => void openTaskModal(id)}
                          disabled={Boolean(loadingTaskId)}
                          className="rounded-full bg-stone-100 px-3 py-1 font-mono text-xs text-stone-700 transition hover:bg-stone-900 hover:text-stone-50 disabled:opacity-50"
                        >
                          {loadingTaskId === id ? '…' : id}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <Badge className="self-start border-stone-200 bg-white text-stone-700" variant={STATUS_LABELS[threadDetail.thread.status]?.variant ?? 'outline'}>
                  {STATUS_LABELS[threadDetail.thread.status]?.label ?? threadDetail.thread.status}
                </Badge>
              </div>

              <div className="flex-1 space-y-4 overflow-y-auto px-6 py-6">
                {threadDetail.messages.length === 0 && (
                  <p className="text-sm text-stone-500">No messages yet.</p>
                )}
                {threadDetail.messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex ${message.role === 'human' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-[1.5rem] px-4 py-3 text-sm leading-6 whitespace-pre-wrap ${
                        message.role === 'human'
                          ? 'bg-stone-950 text-stone-50'
                          : 'border border-stone-200 bg-stone-50 text-stone-800'
                      }`}
                    >
                      <p>{message.body}</p>
                      <p className={`mt-2 text-[10px] uppercase tracking-[0.16em] ${message.role === 'human' ? 'text-stone-300' : 'text-stone-500'}`}>
                        {message.role === 'human' ? 'You' : 'Sprout'} · {formatDateTime(message.created_at)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              {threadDetail.thread.status !== 'closed' && (
                <div className="space-y-3 border-t border-stone-200 px-6 py-5">
                  {showCloseForm && (
                    <div className="rounded-[1.25rem] border border-rose-200 bg-rose-50/90 p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-rose-700">Close thread</p>
                      <Textarea
                        placeholder="Reason (optional)"
                        value={closeReason}
                        onChange={(e) => setCloseReason(e.target.value)}
                        rows={2}
                        className="mt-3 border-rose-200 bg-white text-stone-800"
                      />
                      <div className="mt-3 flex gap-2">
                        <Button className="rounded-full bg-rose-700 text-rose-50 hover:bg-rose-800" size="sm" onClick={() => void handleClose()} disabled={closing}>
                          {closing ? 'Closing…' : 'Confirm close'}
                        </Button>
                        <Button className="rounded-full border-stone-200 bg-white text-stone-700 hover:bg-stone-50" size="sm" variant="outline" onClick={() => { setShowCloseForm(false); setCloseReason('') }}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}

                  <div className="flex gap-3">
                    <Textarea
                      placeholder="Type your reply…"
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      rows={3}
                      className="flex-1 border-stone-200 bg-white text-stone-800"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void handleReply()
                      }}
                    />
                    <div className="flex shrink-0 flex-col gap-2 self-end">
                      <Button className="rounded-full border-stone-200 bg-white text-rose-700 hover:bg-rose-50" size="sm" variant="outline" onClick={() => setShowCloseForm((v) => !v)}>
                        Close
                      </Button>
                      <Button className="rounded-full bg-stone-950 text-stone-50 hover:bg-stone-800" size="sm" onClick={() => void handleReply()} disabled={replying || !replyText.trim()}>
                        <MessageSquareReply className="h-4 w-4" />
                        {replying ? 'Sending…' : 'Send'}
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      {taskModal && (
        <Dialog open onOpenChange={(open) => { if (!open) setTaskModal(null) }}>
          <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto border-stone-200 bg-[#faf7f2]">
            <DialogHeader>
              <DialogTitle className="pr-6 font-serif text-2xl tracking-[-0.03em] text-stone-950">{taskModal.detail.title}</DialogTitle>
            </DialogHeader>
            <div className="space-y-5 text-sm">
              <div className="flex flex-wrap gap-3 text-stone-600">
                <span>Status: <StatusBadge status={taskModal.detail.status} /></span>
                <span>Priority: <PriorityBadge priority={taskModal.detail.priority} /></span>
                <span>Source: <code className="rounded-full bg-stone-100 px-2 py-1 text-xs text-stone-700">{taskModal.detail.source}</code></span>
                <span>Created: <span className="font-mono text-xs">{formatDateTime(taskModal.detail.created_at)}</span></span>
                <span>Updated: <span className="font-mono text-xs">{formatDateTime(taskModal.detail.updated_at)}</span></span>
              </div>

              {taskModal.detail.description && (
                <section>
                  <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">Description</h3>
                  <p className="leading-7 text-stone-700">{taskModal.detail.description}</p>
                </section>
              )}

              {taskModal.detail.human_help_request && (
                <section>
                  <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">Human Help Request</h3>
                  <pre className="overflow-auto rounded-2xl border border-amber-200 bg-amber-50/90 p-4 text-xs text-amber-900">{taskModal.detail.human_help_request}</pre>
                </section>
              )}

              {taskModal.detail.error_message && (
                <section>
                  <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-rose-700">Error</h3>
                  <pre className="overflow-auto rounded-2xl border border-rose-200 bg-rose-50/90 p-4 text-xs text-rose-800">{taskModal.detail.error_message}</pre>
                </section>
              )}

              {taskModal.detail.plan && (
                <section>
                  <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">Execution Plan</h3>
                  <pre className="overflow-auto rounded-2xl bg-stone-100 p-4 text-xs text-stone-800">{taskModal.detail.plan}</pre>
                </section>
              )}

              {taskModal.detail.execution_log && (
                <section>
                  <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">Execution Log</h3>
                  <pre className="overflow-auto rounded-2xl bg-stone-100 p-4 text-xs text-stone-800">{taskModal.detail.execution_log}</pre>
                </section>
              )}

              {taskModal.events.length > 0 && (
                <section>
                  <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">Events</h3>
                  <div className="space-y-2">
                    {taskModal.events.map((event, idx) => (
                      <div key={idx} className="flex items-start gap-3 border-l-2 border-stone-200 pl-3">
                        <span className="font-mono text-xs font-semibold text-stone-700">{event.event_type}</span>
                        <span className="font-mono text-xs text-stone-500">{formatTime(event.created_at)}</span>
                        {event.detail && <span className="text-xs text-stone-600">{event.detail}</span>}
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
            <DialogFooter showCloseButton />
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

function ThreadRow({
  thread,
  isSelected,
  isChecked,
  onCheck,
  onClick,
}: {
  thread: ThreadSummary
  isSelected: boolean
  isChecked: boolean
  onCheck: () => void
  onClick: () => void
}) {
  const statusInfo = STATUS_LABELS[thread.status] ?? { label: thread.status, variant: 'outline' as const }
  const isClosed = thread.status === 'closed'

  return (
    <div className={`flex items-center gap-2 rounded-[1.25rem] border px-3 py-3 transition ${isSelected ? 'border-stone-900 bg-stone-900 text-stone-50' : 'border-stone-200 bg-white hover:bg-stone-50'}`}>
      {!isClosed ? (
        <input
          type="checkbox"
          checked={isChecked}
          onChange={(e) => { e.stopPropagation(); onCheck() }}
          onClick={(e) => e.stopPropagation()}
          className="h-3.5 w-3.5 shrink-0 rounded border-stone-300 accent-[hsl(var(--primary))] cursor-pointer"
        />
      ) : (
        <div className="w-3.5 shrink-0" />
      )}
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        onClick={onClick}
      >
        <div className="flex items-start justify-between gap-2">
          <p className={`truncate text-sm font-medium ${isSelected ? 'text-stone-50' : 'text-stone-900'}`}>{thread.title}</p>
          <Badge className={isSelected ? 'border-stone-700 bg-stone-800 text-stone-100' : 'border-stone-200 bg-stone-100 text-stone-700'} variant={statusInfo.variant}>
            {statusInfo.label}
          </Badge>
        </div>
        <p className={`mt-1 text-xs ${isSelected ? 'text-stone-300' : 'text-stone-500'}`}>
          {thread.created_by} · {formatDateTime(thread.updated_at)}
        </p>
      </button>
    </div>
  )
}
