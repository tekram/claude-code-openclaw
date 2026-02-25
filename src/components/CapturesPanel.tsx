'use client';

import { useState, useEffect, useCallback } from 'react';
import { Plus, Check, ListTodo, RefreshCw, Trash2, Bot, X, Terminal, FileOutput } from 'lucide-react';
import type { TodoItem, TodosData } from '@/types/todos';
import type { OpenClawAgent } from '@/types/notifications';
import type { TaskResult } from '@/app/api/tasks/result/route';

const POLL_INTERVAL = 30_000;

type DispatchMode = 'openclaw' | 'claude';

interface AssignModal {
  index: number;
  item: TodoItem;
}

interface ResultModal {
  taskId: string;
  itemText: string;
}

export const CapturesPanel = () => {
  const [data, setData] = useState<TodosData | null>(null);
  const [loading, setLoading] = useState(true);
  const [quickAddText, setQuickAddText] = useState('');
  const [busy, setBusy] = useState(false);
  const [agents, setAgents] = useState<OpenClawAgent[]>([]);
  const [projectPaths, setProjectPaths] = useState<Record<string, string>>({});

  // Assign modal state
  const [assignModal, setAssignModal] = useState<AssignModal | null>(null);
  const [assignMode, setAssignMode] = useState<DispatchMode>('openclaw');
  const [assignAgentId, setAssignAgentId] = useState('');
  const [assignMessage, setAssignMessage] = useState('');
  const [claudeProjectPath, setClaudeProjectPath] = useState('');
  const [claudeTask, setClaudeTask] = useState('');
  const [assignBusy, setAssignBusy] = useState(false);
  const [assignError, setAssignError] = useState('');

  // Result modal state
  const [resultModal, setResultModal] = useState<ResultModal | null>(null);
  const [taskResult, setTaskResult] = useState<TaskResult | null>(null);
  const [resultLoading, setResultLoading] = useState(false);
  const [resultError, setResultError] = useState('');

  const fetchTodos = useCallback(async () => {
    try {
      const response = await fetch('/api/todos');
      if (response.ok) {
        const result: TodosData = await response.json();
        setData(result);
      }
    } catch (err) {
      console.error('Failed to fetch todos:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch agents once on mount
  useEffect(() => {
    fetch('/api/openclaw/config')
      .then((r) => r.ok ? r.json() : null)
      .then((cfg) => {
        if (cfg?.agents?.length) setAgents(cfg.agents);
      })
      .catch(() => {/* agents unavailable */});
  }, []);

  // Fetch project paths once on mount
  useEffect(() => {
    fetch('/api/settings/projects')
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.projects) setProjectPaths(data.projects as Record<string, string>);
      })
      .catch(() => {/* ignore */});
  }, []);

  useEffect(() => {
    fetchTodos();
    const interval = setInterval(fetchTodos, POLL_INTERVAL);
    const handleVisibility = () => { if (!document.hidden) fetchTodos(); };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [fetchTodos]);

  const handleQuickAdd = async () => {
    if (!quickAddText.trim() || busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: quickAddText.trim() }),
      });
      if (res.ok) {
        const { items } = await res.json();
        setData((prev) => prev ? { ...prev, items } : prev);
        setQuickAddText('');
      }
    } catch (err) {
      console.error('Quick add failed:', err);
    } finally {
      setBusy(false);
    }
  };

  const handleToggle = async (index: number, completed: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/todos', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ index, completed: !completed }),
      });
      if (res.ok) {
        const { items } = await res.json();
        setData((prev) => prev ? { ...prev, items } : prev);
      }
    } catch (err) {
      console.error('Toggle failed:', err);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (index: number) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/todos', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ index }),
      });
      if (res.ok) {
        const { items } = await res.json();
        setData((prev) => prev ? { ...prev, items } : prev);
      }
    } catch (err) {
      console.error('Delete failed:', err);
    } finally {
      setBusy(false);
    }
  };

  const openAssignModal = (index: number, item: TodoItem) => {
    setAssignModal({ index, item });
    setAssignMode('openclaw');
    setAssignMessage(item.text);
    setAssignAgentId(agents[0]?.id || '');
    setClaudeTask(item.text);
    setClaudeProjectPath(item.project ? (projectPaths[item.project] || '') : '');
    setAssignError('');
  };

  const closeAssignModal = () => {
    if (assignBusy) return;
    setAssignModal(null);
    setAssignError('');
  };

  const handleAssign = async () => {
    if (!assignModal || assignBusy) return;

    if (assignMode === 'openclaw') {
      if (!assignAgentId || !assignMessage.trim()) return;
    } else {
      if (!claudeTask.trim()) return;
    }

    setAssignBusy(true);
    setAssignError('');
    try {
      const body = assignMode === 'openclaw'
        ? { index: assignModal.index, mode: 'openclaw', agentId: assignAgentId, message: assignMessage.trim() }
        : { index: assignModal.index, mode: 'claude', projectPath: claudeProjectPath.trim(), task: claudeTask.trim() };

      const res = await fetch('/api/todos/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json() as { ok?: boolean; items?: TodoItem[]; taskId?: string; error?: string };
      if (!res.ok || !json.ok) {
        setAssignError(json.error || 'Failed to assign task');
        return;
      }
      if (json.items) {
        setData((prev) => prev ? { ...prev, items: json.items! } : prev);
      }
      setAssignModal(null);
    } catch (err) {
      setAssignError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setAssignBusy(false);
    }
  };

  const openResultModal = async (item: TodoItem) => {
    if (!item.taskId) return;
    setResultModal({ taskId: item.taskId, itemText: item.text });
    setTaskResult(null);
    setResultError('');
    setResultLoading(true);

    try {
      const res = await fetch(`/api/tasks/result?id=${encodeURIComponent(item.taskId)}`);
      if (res.status === 404) {
        setResultError('Result not found — the result file may have been deleted.');
        return;
      }
      if (!res.ok) {
        const json = await res.json() as { error?: string };
        setResultError(json.error || 'Failed to load result');
        return;
      }
      const result = await res.json() as TaskResult;
      setTaskResult(result);
    } catch (err) {
      setResultError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setResultLoading(false);
    }
  };

  const closeResultModal = () => {
    setResultModal(null);
    setTaskResult(null);
    setResultError('');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-3" />
          <p className="text-xs text-muted-foreground">Loading captures...</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-4">
        <div className="text-center py-8 text-xs text-muted-foreground">
          Failed to load captures.
        </div>
      </div>
    );
  }

  const pending = data.items.filter((i) => !i.completed);
  const completed = data.items.filter((i) => i.completed);
  const canAssign = agents.length > 0 || true; // always show assign button (claude mode works without agents)

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 px-4 pt-4 pb-3 border-b border-border">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <ListTodo className="w-3.5 h-3.5" />
            <span className="text-xs text-muted-foreground">
              {pending.length} pending / {completed.length} done
            </span>
          </div>
          <button
            type="button"
            className="ui-btn-icon h-7 w-7 !bg-transparent hover:!bg-muted"
            onClick={fetchTodos}
            title="Refresh"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Quick add */}
        <div className="flex gap-2">
          <input
            type="text"
            className="ui-input flex-1 rounded-md px-2.5 py-1.5 text-xs"
            placeholder="Quick add capture..."
            value={quickAddText}
            onChange={(e) => setQuickAddText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleQuickAdd();
            }}
          />
          <button
            type="button"
            className="ui-btn-primary px-2.5 py-1.5 text-[10px] font-medium flex items-center gap-1"
            onClick={handleQuickAdd}
            disabled={busy || !quickAddText.trim()}
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-4 py-4 space-y-3">
        {pending.length === 0 && completed.length === 0 ? (
          <div className="text-center py-8 text-xs text-muted-foreground">
            No captures yet. Add ideas via Telegram or the input above.
          </div>
        ) : (
          <>
            {/* Pending items */}
            {pending.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-2">Pending</p>
                <div className="space-y-1.5">
                  {pending.map((item) => {
                    const globalIdx = data.items.indexOf(item);
                    return (
                      <div key={globalIdx} className="flex items-start gap-2 text-xs group bg-muted/20 rounded-md p-2 hover:bg-muted/40 transition">
                        <button
                          type="button"
                          className="mt-0.5 flex-shrink-0 h-4 w-4 rounded border border-border hover:border-primary/50 flex items-center justify-center transition-colors"
                          onClick={() => handleToggle(globalIdx, item.completed)}
                        />
                        <div className="flex-1 min-w-0">
                          <span>{item.text}</span>
                          {item.project && (
                            <span className="ml-1.5 inline-flex rounded bg-primary/10 px-1 py-0.5 text-[9px] font-medium text-primary">
                              {item.project}
                            </span>
                          )}
                          {item.assignedTo && (
                            <span className="ml-1 inline-flex items-center gap-0.5 rounded bg-muted px-1 py-0.5 text-[9px] font-medium text-muted-foreground">
                              {item.assignedTo === 'claude' ? (
                                <Terminal className="w-2 h-2" />
                              ) : (
                                <Bot className="w-2 h-2" />
                              )}
                              {item.assignedTo}
                            </span>
                          )}
                        </div>
                        <div className="flex-shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {/* View result button — only for claude-dispatched items */}
                          {item.assignedTo === 'claude' && item.taskId && (
                            <button
                              type="button"
                              className="text-muted-foreground hover:text-primary"
                              onClick={() => openResultModal(item)}
                              title="View task result"
                            >
                              <FileOutput className="w-3 h-3" />
                            </button>
                          )}
                          {canAssign && (
                            <button
                              type="button"
                              className="text-muted-foreground hover:text-primary"
                              onClick={() => openAssignModal(globalIdx, item)}
                              title="Assign task"
                            >
                              <Bot className="w-3 h-3" />
                            </button>
                          )}
                          <button
                            type="button"
                            className="text-muted-foreground hover:text-destructive"
                            onClick={() => handleDelete(globalIdx)}
                            title="Delete"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Completed */}
            {completed.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-2">
                  Completed ({completed.length})
                </p>
                <div className="space-y-1.5">
                  {completed.map((item) => {
                    const globalIdx = data.items.indexOf(item);
                    return (
                      <div key={globalIdx} className="flex items-start gap-2 text-xs text-muted-foreground group bg-muted/10 rounded-md p-2 hover:bg-muted/30 transition">
                        <button
                          type="button"
                          className="mt-0.5 flex-shrink-0 h-4 w-4 rounded border border-primary/30 bg-primary/10 flex items-center justify-center hover:bg-primary/20 transition"
                          onClick={() => handleToggle(globalIdx, item.completed)}
                        >
                          <Check className="w-2.5 h-2.5 text-primary" />
                        </button>
                        <span className="line-through flex-1">{item.text}</span>
                        <div className="flex-shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {item.assignedTo === 'claude' && item.taskId && (
                            <button
                              type="button"
                              className="text-muted-foreground hover:text-primary"
                              onClick={() => openResultModal(item)}
                              title="View task result"
                            >
                              <FileOutput className="w-3 h-3" />
                            </button>
                          )}
                          <button
                            type="button"
                            className="hover:text-destructive"
                            onClick={() => handleDelete(globalIdx)}
                            title="Delete"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Assign Modal */}
      {assignModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={(e) => { if (e.target === e.currentTarget) closeAssignModal(); }}
        >
          <div className="bg-background border border-border rounded-lg shadow-xl w-full max-w-sm mx-4 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-1.5">
                <Bot className="w-3.5 h-3.5" />
                <span className="text-sm font-semibold">Assign Task</span>
              </div>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                onClick={closeAssignModal}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Mode toggle */}
            <div className="mb-3">
              <label className="block text-xs text-muted-foreground mb-1.5">Dispatch via</label>
              <div className="flex rounded-md overflow-hidden border border-border text-xs">
                <button
                  type="button"
                  className={`flex-1 py-1.5 flex items-center justify-center gap-1.5 transition ${
                    assignMode === 'openclaw'
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-muted text-muted-foreground'
                  }`}
                  onClick={() => setAssignMode('openclaw')}
                >
                  <Bot className="w-3 h-3" />
                  OpenClaw Agent
                </button>
                <button
                  type="button"
                  className={`flex-1 py-1.5 flex items-center justify-center gap-1.5 transition border-l border-border ${
                    assignMode === 'claude'
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-muted text-muted-foreground'
                  }`}
                  onClick={() => setAssignMode('claude')}
                >
                  <Terminal className="w-3 h-3" />
                  Claude Code
                </button>
              </div>
            </div>

            {assignMode === 'openclaw' ? (
              <>
                {/* Agent selector */}
                <div className="mb-3">
                  <label className="block text-xs text-muted-foreground mb-1">Agent</label>
                  {agents.length > 0 ? (
                    <select
                      className="ui-input w-full rounded-md px-2.5 py-1.5 text-xs"
                      value={assignAgentId}
                      onChange={(e) => setAssignAgentId(e.target.value)}
                    >
                      {agents.map((a) => (
                        <option key={a.id} value={a.id}>{a.label}</option>
                      ))}
                    </select>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">No OpenClaw agents detected. Start the gateway first.</p>
                  )}
                </div>

                {/* Message textarea */}
                <div className="mb-3">
                  <label className="block text-xs text-muted-foreground mb-1">Message</label>
                  <textarea
                    className="ui-input w-full rounded-md px-2.5 py-1.5 text-xs resize-none"
                    rows={4}
                    value={assignMessage}
                    onChange={(e) => setAssignMessage(e.target.value)}
                    placeholder="Task description for the agent..."
                  />
                </div>
              </>
            ) : (
              <>
                {/* Project path */}
                <div className="mb-3">
                  <label className="block text-xs text-muted-foreground mb-1">Project path</label>
                  <input
                    type="text"
                    className="ui-input w-full rounded-md px-2.5 py-1.5 text-xs font-mono"
                    value={claudeProjectPath}
                    onChange={(e) => setClaudeProjectPath(e.target.value)}
                    placeholder="C:\Users\avrfa\my-project"
                  />
                  {assignModal.item.project && !projectPaths[assignModal.item.project] && (
                    <p className="text-[10px] text-muted-foreground mt-1">
                      No path configured for <span className="font-medium">{assignModal.item.project}</span> — add one in{' '}
                      <a href="/settings" className="underline" target="_blank">Settings → Project Paths</a>.
                    </p>
                  )}
                </div>

                {/* Task textarea */}
                <div className="mb-3">
                  <label className="block text-xs text-muted-foreground mb-1">Task</label>
                  <textarea
                    className="ui-input w-full rounded-md px-2.5 py-1.5 text-xs resize-none"
                    rows={4}
                    value={claudeTask}
                    onChange={(e) => setClaudeTask(e.target.value)}
                    placeholder="Task for claude -p ..."
                  />
                </div>
              </>
            )}

            {assignError && (
              <p className="text-xs text-destructive mb-3">{assignError}</p>
            )}

            {/* Buttons */}
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                className="ui-btn px-3 py-1.5 text-xs"
                onClick={closeAssignModal}
                disabled={assignBusy}
              >
                Cancel
              </button>
              {assignMode === 'openclaw' ? (
                <button
                  type="button"
                  className="ui-btn-primary px-3 py-1.5 text-xs flex items-center gap-1.5"
                  onClick={handleAssign}
                  disabled={assignBusy || !assignAgentId || !assignMessage.trim()}
                >
                  <Bot className="w-3 h-3" />
                  {assignBusy ? 'Sending…' : 'Send to Agent'}
                </button>
              ) : (
                <button
                  type="button"
                  className="ui-btn-primary px-3 py-1.5 text-xs flex items-center gap-1.5"
                  onClick={handleAssign}
                  disabled={assignBusy || !claudeTask.trim()}
                >
                  <Terminal className="w-3 h-3" />
                  {assignBusy ? 'Spawning…' : 'Run with Claude'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Result Modal */}
      {resultModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={(e) => { if (e.target === e.currentTarget) closeResultModal(); }}
        >
          <div className="bg-background border border-border rounded-lg shadow-xl w-full max-w-lg mx-4 p-4 flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between mb-3 flex-shrink-0">
              <div className="flex items-center gap-1.5">
                <FileOutput className="w-3.5 h-3.5" />
                <span className="text-sm font-semibold">Task Result</span>
              </div>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                onClick={closeResultModal}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-muted-foreground mb-3 flex-shrink-0 truncate">{resultModal.itemText}</p>

            <div className="flex-1 overflow-auto min-h-0">
              {resultLoading && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground py-4 justify-center">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary" />
                  Loading result...
                </div>
              )}

              {resultError && (
                <p className="text-xs text-destructive py-4 text-center">{resultError}</p>
              )}

              {taskResult && !resultLoading && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs">
                    <span className={`inline-flex items-center rounded px-2 py-0.5 font-medium text-[10px] ${
                      taskResult.status === 'running'
                        ? 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400'
                        : taskResult.status === 'done'
                        ? 'bg-green-500/20 text-green-600 dark:text-green-400'
                        : 'bg-destructive/20 text-destructive'
                    }`}>
                      {taskResult.status === 'running' ? 'Running' : taskResult.status === 'done' ? 'Done' : `Error (exit ${taskResult.exitCode ?? '?'})`}
                    </span>
                    {taskResult.completedAt && (
                      <span className="text-muted-foreground">
                        Completed {new Date(taskResult.completedAt).toLocaleTimeString()}
                      </span>
                    )}
                  </div>

                  {taskResult.status === 'running' && (
                    <p className="text-xs text-muted-foreground italic">
                      Still running — check the sessions panel for progress.
                    </p>
                  )}

                  {taskResult.output && (
                    <pre className="text-xs bg-muted/50 rounded-md p-3 overflow-auto whitespace-pre-wrap break-words font-mono leading-relaxed max-h-64">
                      {taskResult.output}
                    </pre>
                  )}

                  {!taskResult.output && taskResult.status !== 'running' && (
                    <p className="text-xs text-muted-foreground italic">No output captured.</p>
                  )}
                </div>
              )}
            </div>

            <div className="flex-shrink-0 flex justify-end mt-3">
              <button
                type="button"
                className="ui-btn px-3 py-1.5 text-xs"
                onClick={closeResultModal}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
