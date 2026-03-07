import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { StatusBadge } from '@/components/ui/status-badge'
import { PriorityBadge } from '@/components/ui/priority-badge'
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
  onSelectThread: (threadId: string) => void
  onReply: (threadId: string, body: string) => Promise<void>
  onCreateThread: (title: string, description: string) => Promise<void>
  onCloseThread: (threadId: string, reason: string) => Promise<void>
  onRefresh: () => void
  replying: boolean
  creating: boolean
}

export function InboxPage({
  threads,
  threadDetail,
  onSelectThread,
  onReply,
  onCreateThread,
  onCloseThread,
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

  return (
    <div className="flex gap-4 min-h-0">
      {/* Thread list */}
      <div className="w-80 shrink-0 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Threads
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={onRefresh}>Refresh</Button>
            <Button size="sm" onClick={() => setShowNewForm((v) => !v)}>+ New</Button>
          </div>
        </div>

        {showNewForm && (
          <Card className="border-border/60 bg-card/80">
            <CardContent className="space-y-2 p-3">
              <Input
                placeholder="Title"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
              />
              <Textarea
                placeholder="Description (optional)"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                rows={3}
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={() => void handleCreate()} disabled={creating || !newTitle.trim()}>
                  {creating ? 'Sending…' : 'Send'}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setShowNewForm(false)}>Cancel</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {active.length === 0 && closed.length === 0 && (
          <p className="text-sm text-muted-foreground">No threads yet.</p>
        )}

        {active.length > 0 && (
          <div className="space-y-1">
            {active.map((t) => (
              <ThreadRow
                key={t.id}
                thread={t}
                isSelected={threadDetail?.thread.id === t.id}
                onClick={() => onSelectThread(t.id)}
              />
            ))}
          </div>
        )}

        {closed.length > 0 && (
          <>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mt-4">Closed</p>
            <div className="space-y-1">
              {closed.map((t) => (
                <ThreadRow
                  key={t.id}
                  thread={t}
                  isSelected={threadDetail?.thread.id === t.id}
                  onClick={() => onSelectThread(t.id)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Thread detail */}
      <div className="flex-1 min-w-0">
        {!threadDetail ? (
          <Card className="border-border/60 bg-card/80 h-full flex items-center justify-center">
            <p className="text-sm text-muted-foreground">Select a thread to view the conversation.</p>
          </Card>
        ) : (
          <Card className="border-border/60 bg-card/80">
            <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
              <div className="min-w-0">
                <p className="font-semibold text-foreground truncate">{threadDetail.thread.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Created by {threadDetail.thread.created_by} · {formatDateTime(threadDetail.thread.created_at)}
                </p>
                {threadDetail.task_ids.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-1 flex flex-wrap items-center gap-1">
                    <span>Tasks:</span>
                    {threadDetail.task_ids.map((id) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => void openTaskModal(id)}
                        disabled={Boolean(loadingTaskId)}
                        className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground hover:bg-primary hover:text-primary-foreground transition disabled:opacity-50"
                      >
                        {loadingTaskId === id ? '…' : id}
                      </button>
                    ))}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge variant={STATUS_LABELS[threadDetail.thread.status]?.variant ?? 'outline'}>
                  {STATUS_LABELS[threadDetail.thread.status]?.label ?? threadDetail.thread.status}
                </Badge>
                {threadDetail.thread.status !== 'closed' && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive border-destructive/40 hover:bg-destructive/10"
                    onClick={() => setShowCloseForm((v) => !v)}
                  >
                    Close
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Close form */}
              {showCloseForm && threadDetail.thread.status !== 'closed' && (
                <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 space-y-2">
                  <p className="text-xs font-semibold text-destructive uppercase tracking-wide">Close thread</p>
                  <Textarea
                    placeholder="Reason (optional)"
                    value={closeReason}
                    onChange={(e) => setCloseReason(e.target.value)}
                    rows={2}
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => void handleClose()}
                      disabled={closing}
                    >
                      {closing ? 'Closing…' : 'Confirm close'}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => { setShowCloseForm(false); setCloseReason('') }}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              {/* Messages */}
              <div className="space-y-3 max-h-[480px] overflow-y-auto pr-1">
                {threadDetail.messages.length === 0 && (
                  <p className="text-sm text-muted-foreground">No messages yet.</p>
                )}
                {threadDetail.messages.map((m) => (
                  <div
                    key={m.id}
                    className={`flex ${m.role === 'human' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ${
                        m.role === 'human'
                          ? 'bg-primary text-primary-foreground rounded-br-sm'
                          : 'bg-muted text-foreground rounded-bl-sm'
                      }`}
                    >
                      <p>{m.body}</p>
                      <p className={`text-[10px] mt-1 ${m.role === 'human' ? 'text-primary-foreground/60' : 'text-muted-foreground'}`}>
                        {m.role === 'human' ? 'You' : 'Sprout'} · {formatDateTime(m.created_at)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Reply box */}
              {threadDetail.thread.status !== 'closed' && (
                <div className="flex gap-2 pt-2 border-t border-border/40">
                  <Textarea
                    placeholder="Type your reply…"
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    rows={2}
                    className="flex-1"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void handleReply()
                    }}
                  />
                  <Button
                    onClick={() => void handleReply()}
                    disabled={replying || !replyText.trim()}
                    className="self-end"
                  >
                    {replying ? 'Sending…' : 'Send'}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
      {/* Task detail modal */}
      {taskModal && (
        <Dialog open onOpenChange={(open) => { if (!open) setTaskModal(null) }}>
          <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="pr-6">{taskModal.detail.title}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 text-sm">
              <div className="flex flex-wrap gap-3 text-muted-foreground">
                <span>Status: <StatusBadge status={taskModal.detail.status} /></span>
                <span>Priority: <PriorityBadge priority={taskModal.detail.priority} /></span>
                <span>Source: <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{taskModal.detail.source}</code></span>
                <span>Created: <span className="font-mono text-xs">{formatDateTime(taskModal.detail.created_at)}</span></span>
                <span>Updated: <span className="font-mono text-xs">{formatDateTime(taskModal.detail.updated_at)}</span></span>
              </div>

              {taskModal.detail.description && (
                <section>
                  <h3 className="mb-1.5 text-xs font-semibold uppercase text-muted-foreground">Description</h3>
                  <p className="leading-relaxed">{taskModal.detail.description}</p>
                </section>
              )}

              {taskModal.detail.human_help_request && (
                <section>
                  <h3 className="mb-1.5 text-xs font-semibold uppercase text-amber-400">Human Help Request</h3>
                  <pre className="overflow-auto rounded-md border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-50/90">{taskModal.detail.human_help_request}</pre>
                </section>
              )}

              {taskModal.detail.error_message && (
                <section>
                  <h3 className="mb-1.5 text-xs font-semibold uppercase text-destructive">Error</h3>
                  <pre className="overflow-auto rounded-md border border-destructive/20 bg-destructive/5 p-3 text-xs text-destructive">{taskModal.detail.error_message}</pre>
                </section>
              )}

              {taskModal.detail.plan && (
                <section>
                  <h3 className="mb-1.5 text-xs font-semibold uppercase text-muted-foreground">Execution Plan</h3>
                  <pre className="overflow-auto rounded-md bg-muted p-3 text-xs">{taskModal.detail.plan}</pre>
                </section>
              )}

              {taskModal.detail.execution_log && (
                <section>
                  <h3 className="mb-1.5 text-xs font-semibold uppercase text-muted-foreground">Execution Log</h3>
                  <pre className="overflow-auto rounded-md bg-muted p-3 text-xs">{taskModal.detail.execution_log}</pre>
                </section>
              )}

              {taskModal.detail.verification_result && (
                <section>
                  <h3 className="mb-1.5 text-xs font-semibold uppercase text-muted-foreground">Verification</h3>
                  <pre className="overflow-auto rounded-md bg-muted p-3 text-xs">{taskModal.detail.verification_result}</pre>
                </section>
              )}

              {taskModal.detail.whats_learned && (
                <section>
                  <h3 className="mb-1.5 text-xs font-semibold uppercase text-muted-foreground">What Was Learned</h3>
                  <pre className="overflow-auto rounded-md bg-muted p-3 text-xs">{taskModal.detail.whats_learned}</pre>
                </section>
              )}

              {taskModal.events.length > 0 && (
                <section>
                  <h3 className="mb-1.5 text-xs font-semibold uppercase text-muted-foreground">
                    Events <span className="rounded-full bg-muted px-2 py-0.5">{taskModal.events.length}</span>
                  </h3>
                  <div className="space-y-1.5">
                    {taskModal.events.map((ev, idx) => (
                      <div key={idx} className="flex items-start gap-3 border-l-2 border-muted pl-3">
                        <span className="font-mono text-xs font-semibold text-primary">{ev.event_type}</span>
                        <span className="font-mono text-xs text-muted-foreground">{formatTime(ev.created_at)}</span>
                        {ev.detail && <span className="text-xs text-muted-foreground">{ev.detail}</span>}
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
  onClick,
}: {
  thread: ThreadSummary
  isSelected: boolean
  onClick: () => void
}) {
  const statusInfo = STATUS_LABELS[thread.status] ?? { label: thread.status, variant: 'outline' as const }
  return (
    <button
      type="button"
      className={`w-full rounded-xl px-3 py-2.5 text-left transition ${
        isSelected
          ? 'bg-primary text-primary-foreground'
          : 'bg-transparent hover:bg-muted/70 text-foreground'
      }`}
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium truncate flex-1">{thread.title}</p>
        <Badge
          variant={isSelected ? 'outline' : statusInfo.variant}
          className={`shrink-0 text-[10px] ${isSelected ? 'border-primary-foreground/40 text-primary-foreground' : ''}`}
        >
          {statusInfo.label}
        </Badge>
      </div>
      <p className={`text-xs mt-0.5 ${isSelected ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
        {thread.created_by} · {formatDateTime(thread.updated_at)}
      </p>
    </button>
  )
}
