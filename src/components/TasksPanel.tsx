'use client';

import { useState, useEffect, useRef } from 'react';
import { Clock, ChevronDown, ChevronUp, CheckCircle2, XCircle, Loader2, ExternalLink } from 'lucide-react';
import { TaskOutputModal } from '@/components/TaskOutputModal';

interface TaskListItem {
  taskId: string;
  status: 'running' | 'done' | 'error';
  projectName: string;
  task?: string;
  startedAt: string;
  completedAt?: string;
  hasOutput?: boolean;
  hasStderr?: boolean;
  exitCode?: number;
  outputSummary?: string;
  durationMs?: number;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}

function formatRelativeTime(ts: string): string {
  try {
    const diff = Date.now() - new Date(ts).getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'just now';
  } catch {
    return '';
  }
}

interface TasksPanelProps {
  onHasTasks?: (has: boolean) => void;
}

export function TasksPanel({ onHasTasks }: TasksPanelProps) {
  const [tasks, setTasks] = useState<TaskListItem[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [viewingTaskId, setViewingTaskId] = useState<string | null>(null);

  // Use a ref so the fetch effect doesn't need onHasTasks in its deps
  const onHasTasksRef = useRef(onHasTasks);
  useEffect(() => { onHasTasksRef.current = onHasTasks; });

  // Persist collapse state
  useEffect(() => {
    const saved = localStorage.getItem('tasks-panel-collapsed');
    if (saved !== null) setCollapsed(saved === 'true');
  }, []);

  useEffect(() => {
    const fetchTasks = async () => {
      try {
        const res = await fetch('/api/tasks/list');
        if (res.ok) {
          const data = await res.json() as TaskListItem[];
          setTasks(data);
          onHasTasksRef.current?.(data.length > 0);
        }
      } catch { /* ignore */ }
    };

    fetchTasks();
    const interval = setInterval(fetchTasks, 15_000);
    return () => clearInterval(interval);
  }, []);

  // Render empty placeholder so the component stays mounted (keeps polling)
  if (tasks.length === 0) return <div className="h-full" />;

  const runningCount = tasks.filter((t) => t.status === 'running').length;

  return (
    <div className="h-full flex flex-col">
      {/* Collapsible header */}
      <button
        type="button"
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-muted/30 transition-colors flex-shrink-0"
        onClick={() => setCollapsed((c) => {
          const next = !c;
          localStorage.setItem('tasks-panel-collapsed', String(next));
          return next;
        })}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold">Recent Tasks</span>
          <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
            {tasks.length}
          </span>
          {runningCount > 0 && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-blue-700 dark:text-blue-400">
              <Loader2 className="w-2.5 h-2.5 animate-spin" />
              {runningCount} running
            </span>
          )}
        </div>
        {collapsed
          ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
          : <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
        }
      </button>

      {/* Task list — fills remaining height when expanded */}
      {!collapsed && (
        <div className="flex-1 overflow-y-auto divide-y divide-border/50 min-h-0">
          {tasks.map((task) => (
            <div
              key={task.taskId}
              className="flex items-center gap-2 px-4 py-2 hover:bg-muted/20 transition-colors group"
            >
              {/* Status icon */}
              <div className="shrink-0">
                {task.status === 'running' && <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />}
                {task.status === 'done' && <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />}
                {task.status === 'error' && <XCircle className="w-3.5 h-3.5 text-red-500" />}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] font-medium text-foreground/90 shrink-0">
                    {task.projectName}
                  </span>
                  <span className="text-[10px] text-muted-foreground shrink-0">·</span>
                  <span className="text-[10px] text-muted-foreground shrink-0 flex items-center gap-0.5">
                    <Clock className="w-2.5 h-2.5" />
                    {formatRelativeTime(task.startedAt)}
                  </span>
                  {task.durationMs !== undefined && (
                    <>
                      <span className="text-[10px] text-muted-foreground shrink-0">·</span>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {formatDuration(task.durationMs)}
                      </span>
                    </>
                  )}
                  {task.status === 'error' && task.exitCode !== undefined && (
                    <span className="text-[9px] font-mono bg-red-100 dark:bg-red-950 text-red-600 dark:text-red-400 px-1 py-0.5 rounded shrink-0">
                      exit {task.exitCode}
                    </span>
                  )}
                </div>
                {task.task && (
                  <p className="text-[10px] text-foreground/80 truncate mt-0.5">{task.task}</p>
                )}
                {task.outputSummary && (
                  <p className="text-[10px] text-muted-foreground truncate mt-0.5 italic">
                    {task.outputSummary}
                  </p>
                )}
              </div>

              {/* View button */}
              <button
                type="button"
                onClick={() => setViewingTaskId(task.taskId)}
                className={`shrink-0 transition-opacity text-[10px] text-primary hover:underline flex items-center gap-0.5 ${
                  task.status === 'running' ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                }`}
                title="View output"
              >
                View
                <ExternalLink className="w-2.5 h-2.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {viewingTaskId && (
        <TaskOutputModal taskId={viewingTaskId} onClose={() => setViewingTaskId(null)} />
      )}
    </div>
  );
}
