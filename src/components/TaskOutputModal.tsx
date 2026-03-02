'use client';

import { useEffect, useState } from 'react';
import { X, Loader2, CheckCircle2, XCircle, Terminal } from 'lucide-react';

interface TaskResult {
  status: 'running' | 'done' | 'error';
  output?: string;
  stderr?: string;
  exitCode?: number;
  startedAt?: string;
  completedAt?: string;
  pid?: number;
  projectName?: string;
  task?: string;
}

interface Props {
  taskId: string;
  onClose: () => void;
}

export function TaskOutputModal({ taskId, onClose }: Props) {
  const [result, setResult] = useState<TaskResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let receivedData = false;
    const es = new EventSource(`/api/tasks/stream?id=${encodeURIComponent(taskId)}`);

    es.onmessage = (event) => {
      receivedData = true;
      try {
        setResult(JSON.parse(event.data as string));
        setLoading(false);
      } catch { /* ignore */ }
    };

    es.onerror = () => {
      setLoading(false);
      es.close();
      if (!receivedData) setError('Result not found or task no longer available.');
    };

    return () => { es.close(); };
  }, [taskId]);

  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const statusIcon = loading
    ? <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
    : result?.status === 'done'
      ? <CheckCircle2 className="w-4 h-4 text-green-500" />
      : result?.status === 'error'
        ? <XCircle className="w-4 h-4 text-red-500" />
        : <Loader2 className="w-4 h-4 animate-spin text-blue-500" />;

  const titleText = loading ? 'Loading…'
    : result?.status === 'running' ? 'Task Running…'
    : result?.status === 'done' ? 'Task Done'
    : result?.status === 'error' ? `Task Error (exit ${result.exitCode ?? -1})`
    : 'Task Result';

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-background border border-border rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            {statusIcon}
            <div className="min-w-0">
              <p className="text-sm font-medium">{titleText}</p>
              {result?.projectName && (
                <p className="text-[10px] text-muted-foreground">{result.projectName}</p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-4 space-y-3 min-h-0">
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          {result?.task && (
            <div>
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Task</p>
              <p className="text-xs text-muted-foreground italic">{result.task}</p>
            </div>
          )}

          {result?.output ? (
            <div>
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Output</p>
              <pre className="text-xs bg-muted/50 rounded p-3 whitespace-pre-wrap font-mono overflow-auto max-h-[45vh]">
                {result.output}
              </pre>
            </div>
          ) : !loading && !error && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground italic py-4">
              <Terminal className="w-4 h-4" />
              No output yet…
            </div>
          )}

          {result?.stderr && (
            <div>
              <p className="text-[10px] font-medium text-red-500 uppercase tracking-wide mb-1">Stderr</p>
              <pre className="text-xs bg-red-500/10 border border-red-500/20 rounded p-3 whitespace-pre-wrap font-mono overflow-auto max-h-[20vh] text-red-700 dark:text-red-400">
                {result.stderr}
              </pre>
            </div>
          )}

          {result?.pid && result.status === 'running' && (
            <p className="text-[10px] text-muted-foreground">PID {result.pid}</p>
          )}
        </div>
      </div>
    </div>
  );
}
