'use client';

import { useState, useEffect } from 'react';
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

export function TasksPanel() {
  const [tasks, setTasks] = useState<TaskListItem[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [viewingTaskId, setViewingTaskId] = useState<string | null>(null);

  useEffect(() => {
    const fetchTasks = async () => {
      try {
        const res = await fetch('/api/tasks/list');
        if (res.ok) setTasks(await res.json() as TaskListItem[]);
      } catch { /* ignore */ }
    };

    fetchTasks();
    const interval = setInterval(fetchTasks, 15_000);
    return () => clearInterval(interval);
  }, []);

  if (tasks.length === 0) return null;

  const runningCount = tasks.filter((t) => t.status === 'running').length;

  return (
    <>
      <div className="border-b border-border flex-shrink-0">
        {/* Collapsible header */}
        <button
          type="button"
          className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-muted/30 transition-colors"
          onClick={() => setCollapsed((c) => !c)}
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

        {!collapsed && (
          <div className="max-h-[220px] overflow-y-auto divide-y divide-border/50">
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
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-medium text-muted-foreground shrink-0">
                      {task.projectName}
                    </span>
                    <span className="text-[10px] text-muted-foreground shrink-0">·</span>
                    <span className="text-[10px] text-muted-foreground shrink-0 flex items-center gap-0.5">
                      <Clock className="w-2.5 h-2.5" />
                      {formatRelativeTime(task.startedAt)}
                    </span>
                  </div>
                  {task.task && (
                    <p className="text-[10px] text-foreground/80 truncate mt-0.5">{task.task}</p>
                  )}
                </div>

                {/* View button — always visible for running, hover for others */}
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
      </div>

      {viewingTaskId && (
        <TaskOutputModal taskId={viewingTaskId} onClose={() => setViewingTaskId(null)} />
      )}
    </>
  );
}
