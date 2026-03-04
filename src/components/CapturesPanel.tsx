'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Plus, Check, ListTodo, RefreshCw, Trash2, Bot, X, Terminal,
  FileOutput, Search, ArrowUpCircle, Download, GripVertical,
  ArrowUpDown, AlertCircle,
} from 'lucide-react';
import type { TodoItem, TodosData } from '@/types/todos';
import type { OpenClawAgent } from '@/types/notifications';
import type { TaskResult } from '@/app/api/tasks/result/route';

const POLL_INTERVAL = 30_000;

type DispatchMode = 'openclaw' | 'claude';
type SortBy = 'default' | 'project' | 'alpha';

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
  const [quickAddProject, setQuickAddProject] = useState('');
  const [busy, setBusy] = useState(false);
  const [agents, setAgents] = useState<OpenClawAgent[]>([]);
  const [projectPaths, setProjectPaths] = useState<Record<string, string>>({});
  const [defaultProjectPath, setDefaultProjectPath] = useState('');

  // Search & filter
  const [search, setSearch] = useState('');
  const [filterProject, setFilterProject] = useState<string | null>(null);

  // Sort
  const [sortBy, setSortBy] = useState<SortBy>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('captures-sort') as SortBy) || 'default';
    }
    return 'default';
  });

  // Inline editing
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [editProject, setEditProject] = useState('');

  // Bulk selection
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Duplicate detection
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);

  // Promote toast
  const [promoteToast, setPromoteToast] = useState<string | null>(null);

  // Promote project picker modal
  const [promoteModal, setPromoteModal] = useState<{ index: number; item: TodoItem } | null>(null);
  const [promoteTarget, setPromoteTarget] = useState<string>('__home__');

  // Drag-to-reorder
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dragStartY = useRef(0);
  const pendingItemRefs = useRef<(HTMLDivElement | null)[]>([]);

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
  const [cancelBusy, setCancelBusy] = useState(false);

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
      .then((d) => {
        if (d?.projects) setProjectPaths(d.projects as Record<string, string>);
        if (d?.defaultProjectPath) setDefaultProjectPath(d.defaultProjectPath as string);
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

  // Persist sort preference
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('captures-sort', sortBy);
    }
  }, [sortBy]);

  // Dismiss promote toast after 2s
  useEffect(() => {
    if (promoteToast) {
      const t = setTimeout(() => setPromoteToast(null), 2000);
      return () => clearTimeout(t);
    }
  }, [promoteToast]);

  const handleQuickAdd = async (force = false) => {
    const text = quickAddText.trim();
    if (!text || busy) return;

    // Duplicate detection (client-side)
    if (!force && data?.items) {
      const dup = data.items.find(
        (item) => item.text.toLowerCase() === text.toLowerCase() && !item.completed
      );
      if (dup) {
        setDuplicateWarning(text);
        return;
      }
    }
    setDuplicateWarning(null);

    setBusy(true);
    try {
      const res = await fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, project: quickAddProject.trim() || undefined }),
      });
      if (res.ok) {
        const { items } = await res.json();
        setData((prev) => prev ? { ...prev, items } : prev);
        setQuickAddText('');
        setQuickAddProject('');
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
        setSelected((prev) => {
          const next = new Set(prev);
          next.delete(index);
          return next;
        });
      }
    } catch (err) {
      console.error('Delete failed:', err);
    } finally {
      setBusy(false);
    }
  };

  const handleBulkDelete = async () => {
    if (busy || selected.size === 0) return;
    setBusy(true);
    try {
      const res = await fetch('/api/todos', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ indices: Array.from(selected) }),
      });
      if (res.ok) {
        const { items } = await res.json();
        setData((prev) => prev ? { ...prev, items } : prev);
        setSelected(new Set());
      }
    } catch (err) {
      console.error('Bulk delete failed:', err);
    } finally {
      setBusy(false);
    }
  };

  const handleBulkMarkDone = async () => {
    if (busy || selected.size === 0) return;
    setBusy(true);
    try {
      for (const idx of Array.from(selected)) {
        await fetch('/api/todos', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ index: idx, completed: true }),
        });
      }
      await fetchTodos();
      setSelected(new Set());
    } catch (err) {
      console.error('Bulk mark done failed:', err);
    } finally {
      setBusy(false);
    }
  };

  const handleClearCompleted = async () => {
    if (!data || busy) return;
    const completedIndices = data.items
      .map((item, i) => item.completed ? i : -1)
      .filter((i) => i !== -1);
    if (completedIndices.length === 0) return;
    setBusy(true);
    try {
      const res = await fetch('/api/todos', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ indices: completedIndices }),
      });
      if (res.ok) {
        const { items } = await res.json();
        setData((prev) => prev ? { ...prev, items } : prev);
      }
    } catch (err) {
      console.error('Clear completed failed:', err);
    } finally {
      setBusy(false);
    }
  };

  // Inline edit handlers
  const startEdit = (globalIdx: number, item: TodoItem) => {
    setEditingIndex(globalIdx);
    setEditText(item.text);
    setEditProject(item.project || '');
  };

  const confirmEdit = async () => {
    if (editingIndex === null || busy) return;
    const trimmed = editText.trim();
    if (!trimmed) {
      cancelEdit();
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/todos', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          index: editingIndex,
          text: trimmed,
          project: editProject.trim() || null,
        }),
      });
      if (res.ok) {
        const { items } = await res.json();
        setData((prev) => prev ? { ...prev, items } : prev);
      }
    } catch (err) {
      console.error('Edit failed:', err);
    } finally {
      setBusy(false);
      setEditingIndex(null);
    }
  };

  const cancelEdit = () => {
    setEditingIndex(null);
    setEditText('');
    setEditProject('');
  };

  // Promote handler — opens picker if project is unresolvable
  const handlePromote = (globalIdx: number, item: TodoItem) => {
    const resolvedPath = item.project ? projectPaths[item.project] : null;
    if (!resolvedPath) {
      // Need to ask the user where to send it
      const firstProject = Object.keys(projectPaths)[0] || '__home__';
      setPromoteTarget(item.project && Object.keys(projectPaths).length === 0 ? '__home__' : firstProject);
      setPromoteModal({ index: globalIdx, item });
    } else {
      doPromote(globalIdx, undefined);
    }
  };

  const doPromote = async (globalIdx: number, targetPath: string | undefined) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/todos', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ index: globalIdx, promoted: true, targetPath }),
      });
      if (res.ok) {
        const { items } = await res.json();
        setData((prev) => prev ? { ...prev, items } : prev);
        setPromoteToast('Promoted to TODO');
      }
    } catch (err) {
      console.error('Promote failed:', err);
    } finally {
      setBusy(false);
      setPromoteModal(null);
    }
  };

  const confirmPromote = () => {
    if (!promoteModal) return;
    const path = promoteTarget === '__home__' ? undefined : projectPaths[promoteTarget];
    doPromote(promoteModal.index, path);
  };

  // Drag handlers
  const handleDragStart = (e: React.MouseEvent, pendingIdx: number) => {
    if (sortBy !== 'default') return; // drag disabled when sorted
    setDragIndex(pendingIdx);
    dragStartY.current = e.clientY;
  };

  const handleDragOver = (pendingIdx: number) => {
    if (dragIndex === null) return;
    setDragOverIndex(pendingIdx);
  };

  const handleDragEnd = async (pendingItems: TodoItem[], allItems: TodoItem[]) => {
    if (dragIndex === null || dragOverIndex === null || dragIndex === dragOverIndex) {
      setDragIndex(null);
      setDragOverIndex(null);
      return;
    }

    // Build reordered global indices
    const newPending = [...pendingItems];
    const [moved] = newPending.splice(dragIndex, 1);
    newPending.splice(dragOverIndex, 0, moved);

    // Map back to global indices
    const completedItems = allItems.filter((i) => i.completed);
    const reordered = [...newPending, ...completedItems];
    const reorderIndices = reordered.map((item) => allItems.indexOf(item));

    setDragIndex(null);
    setDragOverIndex(null);

    try {
      const res = await fetch('/api/todos', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reorder: reorderIndices }),
      });
      if (res.ok) {
        const { items } = await res.json();
        setData((prev) => prev ? { ...prev, items } : prev);
      }
    } catch (err) {
      console.error('Reorder failed:', err);
    }
  };

  const openAssignModal = (index: number, item: TodoItem) => {
    setAssignModal({ index, item });
    setAssignMode('openclaw');
    setAssignMessage(item.text);
    setAssignAgentId(agents[0]?.id || '');
    setClaudeTask(item.text);
    setClaudeProjectPath(item.project ? (projectPaths[item.project] || defaultProjectPath) : defaultProjectPath);
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

  const openResultModal = (item: TodoItem) => {
    if (!item.taskId) return;
    setResultModal({ taskId: item.taskId, itemText: item.text });
    setTaskResult(null);
    setResultError('');
    setResultLoading(true);
  };

  // SSE stream: connect when result modal opens
  useEffect(() => {
    if (!resultModal) return;

    let receivedData = false;
    const es = new EventSource(`/api/tasks/stream?id=${encodeURIComponent(resultModal.taskId)}`);

    es.onmessage = (event: MessageEvent) => {
      receivedData = true;
      try {
        const result = JSON.parse(event.data as string) as TaskResult;
        setTaskResult(result);
        setResultLoading(false);
      } catch { /* ignore parse errors */ }
    };

    es.onerror = () => {
      setResultLoading(false);
      es.close();
      if (!receivedData) {
        setResultError('Result not found — the file may have been deleted.');
      }
    };

    return () => { es.close(); };
  }, [resultModal]);

  const closeResultModal = () => {
    setResultModal(null);
    setTaskResult(null);
    setResultError('');
  };

  const handleCancelTask = async () => {
    if (!resultModal || cancelBusy) return;
    setCancelBusy(true);
    try {
      const res = await fetch('/api/tasks/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: resultModal.taskId }),
      });
      if (res.ok) {
        const updated = await res.json() as TaskResult;
        setTaskResult(updated);
      }
    } catch (err) {
      console.error('Cancel failed:', err);
    } finally {
      setCancelBusy(false);
    }
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

  const allPending = data.items.filter((i) => !i.completed);
  const completed = data.items.filter((i) => i.completed);
  const canAssign = agents.length > 0 || true;

  // Apply search + project filter to pending items
  const filteredPending = allPending.filter((item) => {
    const matchesSearch = !search || item.text.toLowerCase().includes(search.toLowerCase());
    const matchesProject = !filterProject || item.project === filterProject;
    return matchesSearch && matchesProject;
  });

  // Apply sort
  const sortedPending = [...filteredPending].sort((a, b) => {
    if (sortBy === 'alpha') return a.text.localeCompare(b.text);
    if (sortBy === 'project') return (a.project || '').localeCompare(b.project || '');
    return 0; // default: original order
  });

  // Filtered completed (search only, not project filter)
  const filteredCompleted = completed.filter((item) =>
    !search || item.text.toLowerCase().includes(search.toLowerCase())
  );

  // Unique projects for filter
  const allProjects = Array.from(new Set(allPending.map((i) => i.project).filter(Boolean))) as string[];

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 px-4 pt-4 pb-3 border-b border-border">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <ListTodo className="w-3.5 h-3.5" />
            <span className="text-xs text-muted-foreground">
              {allPending.length} pending / {completed.length} done
            </span>
          </div>
          <div className="flex items-center gap-1">
            {/* Sort toggle */}
            <button
              type="button"
              className="ui-btn-icon h-7 w-7 !bg-transparent hover:!bg-muted relative"
              title={`Sort: ${sortBy}`}
              onClick={() => {
                const next: SortBy = sortBy === 'default' ? 'alpha' : sortBy === 'alpha' ? 'project' : 'default';
                setSortBy(next);
              }}
            >
              <ArrowUpDown className="w-3.5 h-3.5" />
              {sortBy !== 'default' && (
                <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-primary" />
              )}
            </button>
            {/* Export button */}
            <a
              href="/api/todos/export?format=csv"
              download="captures.csv"
              className="ui-btn-icon h-7 w-7 !bg-transparent hover:!bg-muted flex items-center justify-center"
              title="Export as CSV"
            >
              <Download className="w-3.5 h-3.5" />
            </a>
            <button
              type="button"
              className="ui-btn-icon h-7 w-7 !bg-transparent hover:!bg-muted"
              onClick={fetchTodos}
              title="Refresh"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Quick add */}
        <div className="flex gap-2 mb-2">
          <input
            type="text"
            className="ui-input flex-1 rounded-md px-2.5 py-1.5 text-xs"
            placeholder="Quick add capture..."
            value={quickAddText}
            onChange={(e) => {
              setQuickAddText(e.target.value);
              setDuplicateWarning(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleQuickAdd();
            }}
          />
          <input
            type="text"
            className="ui-input w-24 rounded-md px-2.5 py-1.5 text-xs"
            placeholder="project"
            value={quickAddProject}
            onChange={(e) => setQuickAddProject(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleQuickAdd();
            }}
          />
          <button
            type="button"
            className="ui-btn-primary px-2.5 py-1.5 text-[10px] font-medium flex items-center gap-1"
            onClick={() => handleQuickAdd()}
            disabled={busy || !quickAddText.trim()}
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>

        {/* Duplicate warning */}
        {duplicateWarning && (
          <div className="flex items-center gap-2 rounded-md bg-yellow-500/10 border border-yellow-500/30 px-2.5 py-1.5 text-xs text-yellow-600 dark:text-yellow-400 mb-2">
            <AlertCircle className="w-3 h-3 flex-shrink-0" />
            <span className="flex-1">Already captured: &quot;{duplicateWarning}&quot;</span>
            <button
              type="button"
              className="underline hover:no-underline flex-shrink-0"
              onClick={() => handleQuickAdd(true)}
            >
              Add anyway
            </button>
            <button
              type="button"
              className="hover:text-foreground flex-shrink-0"
              onClick={() => setDuplicateWarning(null)}
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* Search bar */}
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
          <input
            type="text"
            className="ui-input w-full rounded-md pl-7 pr-7 py-1.5 text-xs"
            placeholder="Search captures..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setSearch('')}
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Active project filter pill */}
        {filterProject && (
          <div className="flex items-center gap-1.5 mt-1.5">
            <span className="text-[10px] text-muted-foreground">Filter:</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
              {filterProject}
              <button
                type="button"
                className="hover:text-primary/60"
                onClick={() => setFilterProject(null)}
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          </div>
        )}
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex-shrink-0 px-4 py-2 bg-primary/5 border-b border-border flex items-center gap-2">
          <span className="text-xs text-muted-foreground flex-1">{selected.size} selected</span>
          <button
            type="button"
            className="ui-btn px-2.5 py-1 text-[10px] flex items-center gap-1"
            onClick={handleBulkMarkDone}
            disabled={busy}
          >
            <Check className="w-3 h-3" /> Mark done
          </button>
          <button
            type="button"
            className="ui-btn px-2.5 py-1 text-[10px] text-destructive hover:text-destructive flex items-center gap-1"
            onClick={handleBulkDelete}
            disabled={busy}
          >
            <Trash2 className="w-3 h-3" /> Delete {selected.size}
          </button>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => setSelected(new Set())}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Promote toast */}
      {promoteToast && (
        <div className="flex-shrink-0 mx-4 mt-2 rounded-md bg-green-500/10 border border-green-500/30 px-3 py-1.5 text-xs text-green-600 dark:text-green-400 text-center">
          {promoteToast}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto px-4 py-4 space-y-3">
        {allPending.length === 0 && completed.length === 0 ? (
          <div className="text-center py-8 text-xs text-muted-foreground">
            No captures yet. Add ideas via Telegram or the input above.
          </div>
        ) : (
          <>
            {/* Pending items */}
            {sortedPending.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-2">
                  Pending
                  {sortBy !== 'default' && (
                    <span className="ml-1 font-normal normal-case opacity-60">
                      (sorted by {sortBy})
                    </span>
                  )}
                </p>
                <div className="space-y-1.5">
                  {sortedPending.map((item) => {
                    const globalIdx = data.items.indexOf(item);
                    // pendingIdx is the index within sortedPending (for drag)
                    const pendingIdx = sortedPending.indexOf(item);
                    const isEditing = editingIndex === globalIdx;
                    const isSelected = selected.has(globalIdx);
                    const isDragging = dragIndex === pendingIdx;
                    const isDragOver = dragOverIndex === pendingIdx;

                    return (
                      <div
                        key={globalIdx}
                        ref={(el) => { pendingItemRefs.current[pendingIdx] = el; }}
                        className={`flex items-start gap-2 text-xs rounded-md p-2 transition ${
                          isDragging ? 'opacity-40' : ''
                        } ${isDragOver && dragIndex !== null ? 'border-t-2 border-primary' : ''} ${
                          isSelected
                            ? 'bg-primary/10 hover:bg-primary/15'
                            : 'bg-muted/20 hover:bg-muted/40'
                        } group`}
                        onDragOver={(e) => { e.preventDefault(); handleDragOver(pendingIdx); }}
                        onDrop={() => handleDragEnd(sortedPending, data.items)}
                      >
                        {/* Drag handle */}
                        {sortBy === 'default' && (
                          <div
                            className="mt-0.5 flex-shrink-0 cursor-grab text-muted-foreground/40 hover:text-muted-foreground active:cursor-grabbing"
                            draggable
                            onMouseDown={(e) => handleDragStart(e, pendingIdx)}
                            onDragStart={(e) => {
                              e.dataTransfer.effectAllowed = 'move';
                              handleDragStart(e as unknown as React.MouseEvent, pendingIdx);
                            }}
                            onDragEnd={() => handleDragEnd(sortedPending, data.items)}
                          >
                            <GripVertical className="w-3 h-3" />
                          </div>
                        )}

                        {/* Selection checkbox */}
                        <button
                          type="button"
                          className={`mt-0.5 flex-shrink-0 h-4 w-4 rounded border flex items-center justify-center transition-colors ${
                            isSelected
                              ? 'border-primary bg-primary/20'
                              : 'border-border hover:border-primary/50'
                          }`}
                          onClick={() => {
                            setSelected((prev) => {
                              const next = new Set(prev);
                              if (next.has(globalIdx)) next.delete(globalIdx);
                              else next.add(globalIdx);
                              return next;
                            });
                          }}
                        >
                          {isSelected && <Check className="w-2.5 h-2.5 text-primary" />}
                        </button>

                        {/* Content — edit mode or display */}
                        <div className="flex-1 min-w-0">
                          {isEditing ? (
                            <div
                              className="space-y-1"
                              onBlur={(e) => {
                                // Only confirm if focus leaves the whole edit group
                                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                                  confirmEdit();
                                }
                              }}
                            >
                              <input
                                type="text"
                                autoFocus
                                className="ui-input w-full rounded px-2 py-0.5 text-xs"
                                value={editText}
                                onChange={(e) => setEditText(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') confirmEdit();
                                  if (e.key === 'Escape') cancelEdit();
                                }}
                              />
                              <input
                                type="text"
                                className="ui-input w-full rounded px-2 py-0.5 text-[10px]"
                                placeholder="project tag"
                                value={editProject}
                                onChange={(e) => setEditProject(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') confirmEdit();
                                  if (e.key === 'Escape') cancelEdit();
                                }}
                              />
                            </div>
                          ) : (
                            <>
                              <span
                                className="cursor-text"
                                onDoubleClick={() => startEdit(globalIdx, item)}
                              >
                                {item.text}
                              </span>
                              {item.project && (
                                <button
                                  type="button"
                                  className="ml-1.5 inline-flex rounded bg-primary/10 px-1 py-0.5 text-[9px] font-medium text-primary hover:bg-primary/20 transition-colors"
                                  onClick={() => setFilterProject(item.project === filterProject ? null : item.project!)}
                                  title={filterProject === item.project ? 'Clear filter' : `Filter by ${item.project}`}
                                >
                                  {item.project}
                                </button>
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
                            </>
                          )}
                        </div>

                        {/* Action buttons */}
                        {!isEditing && (
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
                              className="text-muted-foreground hover:text-green-500"
                              onClick={() => handlePromote(globalIdx, item)}
                              title="Promote to TODO"
                            >
                              <ArrowUpCircle className="w-3 h-3" />
                            </button>
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
                        )}
                      </div>
                    );
                  })}
                </div>
                {sortBy !== 'default' && (
                  <p className="text-[10px] text-muted-foreground mt-1.5 italic">
                    Drag-to-reorder is disabled while sorted. Switch to &quot;default&quot; order first.
                  </p>
                )}
              </div>
            )}

            {/* Empty filtered state */}
            {sortedPending.length === 0 && allPending.length > 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">
                No pending captures match your filter.
              </p>
            )}

            {/* Completed */}
            {filteredCompleted.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-muted-foreground">
                    Completed ({filteredCompleted.length})
                  </p>
                  <button
                    type="button"
                    className="text-[10px] text-muted-foreground hover:text-destructive transition-colors"
                    onClick={handleClearCompleted}
                    disabled={busy}
                    title="Delete all completed"
                  >
                    Clear all
                  </button>
                </div>
                <div className="space-y-1.5">
                  {filteredCompleted.map((item) => {
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

      {/* Promote Project Picker Modal */}
      {promoteModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={(e) => { if (e.target === e.currentTarget) setPromoteModal(null); }}
        >
          <div className="bg-background border border-border rounded-lg shadow-xl w-full max-w-xs mx-4 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-1.5">
                <ArrowUpCircle className="w-3.5 h-3.5 text-green-500" />
                <span className="text-sm font-semibold">Promote to TODO</span>
              </div>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => setPromoteModal(null)}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-muted-foreground mb-3 truncate">
              &quot;{promoteModal.item.text}&quot;
            </p>

            <div className="mb-4">
              <label className="block text-xs text-muted-foreground mb-1">Send to</label>
              <select
                className="ui-input w-full rounded-md px-2.5 py-1.5 text-xs"
                value={promoteTarget}
                onChange={(e) => setPromoteTarget(e.target.value)}
              >
                <option value="__home__">~/TODO.md (home)</option>
                {Object.keys(projectPaths).map((name) => (
                  <option key={name} value={name}>{name} — TODO.md</option>
                ))}
              </select>
            </div>

            <div className="flex gap-2 justify-end">
              <button
                type="button"
                className="ui-btn px-3 py-1.5 text-xs"
                onClick={() => setPromoteModal(null)}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="ui-btn-primary px-3 py-1.5 text-xs flex items-center gap-1.5"
                onClick={confirmPromote}
                disabled={busy}
              >
                <ArrowUpCircle className="w-3 h-3" />
                {busy ? 'Promoting…' : 'Promote'}
              </button>
            </div>
          </div>
        </div>
      )}

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
              <div className="flex gap-2">
                <button
                  type="button"
                  className={`flex-1 rounded-md border px-3 py-2 text-left transition ${
                    assignMode === 'openclaw'
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:bg-muted/50'
                  }`}
                  onClick={() => setAssignMode('openclaw')}
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <Bot className={`w-3 h-3 ${assignMode === 'openclaw' ? 'text-primary' : 'text-muted-foreground'}`} />
                    <span className={`text-xs font-medium ${assignMode === 'openclaw' ? 'text-primary' : ''}`}>OpenClaw Agent</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground leading-tight">Result delivered back via Telegram or WhatsApp</p>
                </button>
                <button
                  type="button"
                  className={`flex-1 rounded-md border px-3 py-2 text-left transition ${
                    assignMode === 'claude'
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:bg-muted/50'
                  }`}
                  onClick={() => setAssignMode('claude')}
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <Terminal className={`w-3 h-3 ${assignMode === 'claude' ? 'text-primary' : 'text-muted-foreground'}`} />
                    <span className={`text-xs font-medium ${assignMode === 'claude' ? 'text-primary' : ''}`}>Claude Code</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground leading-tight">Runs locally — result viewable in dashboard only</p>
                </button>
              </div>
            </div>

            {assignMode === 'openclaw' ? (
              <>
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
                <div className="mb-3">
                  <label className="block text-xs text-muted-foreground mb-1">Project path</label>
                  <input
                    type="text"
                    className="ui-input w-full rounded-md px-2.5 py-1.5 text-xs font-mono"
                    value={claudeProjectPath}
                    onChange={(e) => setClaudeProjectPath(e.target.value)}
                    placeholder="C:\Users\yourname\my-project"
                  />
                  {assignModal.item.project && !projectPaths[assignModal.item.project] && (
                    <p className="text-[10px] text-muted-foreground mt-1">
                      No path configured for <span className="font-medium">{assignModal.item.project}</span> — add one in{' '}
                      <a href="/settings" className="underline" target="_blank">Settings → Project Paths</a>.
                    </p>
                  )}
                </div>
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
                  <div className="flex items-center gap-2 text-xs flex-wrap">
                    <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 font-medium text-[10px] ${
                      taskResult.status === 'running'
                        ? 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400'
                        : taskResult.status === 'done'
                        ? 'bg-green-500/20 text-green-600 dark:text-green-400'
                        : 'bg-destructive/20 text-destructive'
                    }`}>
                      {taskResult.status === 'running' && (
                        <div className="w-1.5 h-1.5 rounded-full bg-yellow-500 animate-pulse" />
                      )}
                      {taskResult.status === 'running' ? 'Running' : taskResult.status === 'done' ? 'Done' : `Error (exit ${taskResult.exitCode ?? '?'})`}
                    </span>
                    {taskResult.pid && taskResult.status === 'running' && (
                      <span className="text-[10px] text-muted-foreground font-mono">PID {taskResult.pid}</span>
                    )}
                    {taskResult.completedAt && (
                      <span className="text-muted-foreground text-[10px]">
                        Completed {new Date(taskResult.completedAt).toLocaleTimeString()}
                      </span>
                    )}
                  </div>

                  {taskResult.output ? (
                    <pre className="text-xs bg-muted/50 rounded-md p-3 overflow-auto whitespace-pre-wrap break-words font-mono leading-relaxed max-h-64">
                      {taskResult.output}
                    </pre>
                  ) : taskResult.status === 'running' ? (
                    <p className="text-xs text-muted-foreground italic">
                      Waiting for output… check the Sessions panel for live activity.
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">No output captured.</p>
                  )}

                  {taskResult.stderr && (
                    <div>
                      <p className="text-[10px] font-medium text-destructive mb-1">stderr</p>
                      <pre className="text-xs bg-destructive/5 border border-destructive/20 rounded-md p-3 overflow-auto whitespace-pre-wrap break-words font-mono leading-relaxed max-h-32">
                        {taskResult.stderr}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex-shrink-0 flex items-center justify-between mt-3">
              <div>
                {taskResult?.status === 'running' && (
                  <button
                    type="button"
                    className="ui-btn px-3 py-1.5 text-xs text-destructive hover:text-destructive flex items-center gap-1.5"
                    onClick={handleCancelTask}
                    disabled={cancelBusy}
                  >
                    <X className="w-3 h-3" />
                    {cancelBusy ? 'Cancelling…' : 'Cancel task'}
                  </button>
                )}
              </div>
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
