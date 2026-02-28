'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Activity, Clock, AlertCircle, CheckCircle, XCircle, RefreshCw,
  X, Check, Download, BarChart3, StickyNote, Play, ListTodo,
  GitBranch, GitPullRequest, List, LayoutGrid,
} from 'lucide-react';
import type { Session, SessionsData, GitInfo, GitInfoMap } from '@/types/sessions';
import { dismissSession, markSessionDone, exportSessions, resumeSession } from '@/lib/sessions/actions';
import { AnalyticsModal } from '@/components/AnalyticsModal';
import { BriefingBanner } from '@/components/BriefingBanner';
import {
  formatDuration,
  formatRelativeTime,
  getReasonIcon,
  getReasonLabel,
  getReasonColor,
} from '@/lib/sessions/formatting';

const formatTime = (timestamp: string) => {
  try {
    return new Date(timestamp).toLocaleString();
  } catch {
    return timestamp;
  }
};

const getElapsedTime = (startTime: string, endTime?: string) => {
  try {
    const start = new Date(startTime);
    const end = endTime ? new Date(endTime) : new Date();
    const diffMs = end.getTime() - start.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours > 0) return `${diffHours}h ${diffMins % 60}m`;
    return `${diffMins}m`;
  } catch {
    return '-';
  }
};

// ── Sub-components ──────────────────────────────────────────────────────────

const SessionNotes = ({ notes }: { notes?: string[] }) => {
  if (!notes || notes.length === 0) return null;
  return (
    <div className="mt-1.5 space-y-0.5">
      {notes.map((note, i) => {
        if (note.startsWith('[web-dispatch]')) {
          return (
            <div key={i} className="mt-1">
              <span className="inline-flex items-center gap-1 rounded-md bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:text-blue-400">
                <ListTodo className="w-2.5 h-2.5" />
                From captures
              </span>
            </div>
          );
        }
        return (
          <div key={i} className="flex items-start gap-1 text-[10px] text-muted-foreground">
            <StickyNote className="w-2.5 h-2.5 mt-0.5 shrink-0 text-amber-500/70" />
            <span className="line-clamp-2">{note}</span>
          </div>
        );
      })}
    </div>
  );
};

const GitBadges = ({ gitInfo }: { gitInfo?: GitInfo }) => {
  if (!gitInfo?.branch && !gitInfo?.pr) return null;
  return (
    <div className="flex items-center gap-1 flex-wrap mt-1">
      {gitInfo.branch && (
        <span className="inline-flex items-center gap-0.5 rounded bg-muted/60 px-1 py-0.5 text-[9px] font-mono text-muted-foreground max-w-[120px]">
          <GitBranch className="w-2 h-2 shrink-0" />
          <span className="truncate">{gitInfo.branch}</span>
          {gitInfo.isDirty && <span className="text-yellow-500 shrink-0">*</span>}
        </span>
      )}
      {gitInfo.pr && (
        <a
          href={gitInfo.pr.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-0.5 rounded bg-muted/60 px-1 py-0.5 text-[9px] text-muted-foreground hover:text-foreground transition-colors"
          onClick={(e) => e.stopPropagation()}
          title={gitInfo.pr.title}
        >
          <GitPullRequest className="w-2 h-2 shrink-0" />
          <span>#{gitInfo.pr.number}</span>
          {gitInfo.pr.ciStatus === 'passing' && (
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
          )}
          {gitInfo.pr.ciStatus === 'failing' && (
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
          )}
          {gitInfo.pr.ciStatus === 'pending' && (
            <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse shrink-0" />
          )}
        </a>
      )}
    </div>
  );
};

// ── Kanban sub-components ───────────────────────────────────────────────────

interface KanbanCardProps {
  session: Session;
  gitInfo?: GitInfo;
  actions?: React.ReactNode;
}

const InstanceBadge = ({ index }: { index?: number }) =>
  index && index > 1 ? (
    <span className="text-[9px] font-mono text-muted-foreground/60 shrink-0">·{index}</span>
  ) : null;

const KanbanCard = ({ session, gitInfo, actions }: KanbanCardProps) => (
  <div className="bg-background border border-border rounded-md p-2.5 group">
    <div className="flex items-start justify-between gap-1">
      <div className="flex items-center gap-1 min-w-0 flex-1">
        <p className="text-xs font-medium truncate">{session.project}</p>
        <InstanceBadge index={session.instanceIndex} />
      </div>
      {actions && (
        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 flex-shrink-0">
          {actions}
        </div>
      )}
    </div>
    <GitBadges gitInfo={gitInfo} />
    {session.details && (
      <p className="text-[9px] text-muted-foreground mt-1 line-clamp-2">{session.details}</p>
    )}
    <p className="text-[9px] text-muted-foreground mt-1">
      {getElapsedTime(session.startTime, session.endTime)}
    </p>
    <SessionNotes notes={session.notes} />
  </div>
);

interface KanbanColumnProps {
  title: string;
  icon: React.ReactNode;
  colorClass: string;
  children: React.ReactNode;
  count: number;
}

const KanbanColumn = ({ title, icon, colorClass, children, count }: KanbanColumnProps) => (
  <div className="flex flex-col min-w-[185px] flex-1">
    <div className="flex items-center gap-1.5 mb-2 px-0.5">
      {icon}
      <span className={`text-xs font-semibold ${colorClass}`}>{title}</span>
      <span className="text-[10px] text-muted-foreground bg-muted rounded px-1 py-0.5 ml-auto">{count}</span>
    </div>
    <div className="space-y-1.5 overflow-y-auto flex-1">
      {count === 0 ? (
        <p className="text-[10px] text-muted-foreground italic px-0.5">—</p>
      ) : (
        children
      )}
    </div>
  </div>
);

// ── Main component ──────────────────────────────────────────────────────────

export const SessionsPanel = () => {
  const [data, setData] = useState<SessionsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isLive, setIsLive] = useState(false);
  const [showDismissed, setShowDismissed] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'kanban'>('list');
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [gitInfo, setGitInfo] = useState<GitInfoMap>({});
  const reconnectDelayRef = useRef(1000);
  const esRef = useRef<EventSource | null>(null);

  // Persist view mode to localStorage
  useEffect(() => {
    const stored = localStorage.getItem('sessions-view-mode');
    if (stored === 'kanban') setViewMode('kanban');
  }, []);

  const setView = (mode: 'list' | 'kanban') => {
    setViewMode(mode);
    localStorage.setItem('sessions-view-mode', mode);
  };

  // Fallback fetch for after actions
  const fetchSessions = useCallback(async () => {
    try {
      const response = await fetch('/api/sessions');
      if (response.ok) {
        const result: SessionsData = await response.json();
        setData(result);
      }
    } catch (err) {
      console.error('Failed to fetch sessions:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch git info (branch + PR/CI) for all configured projects
  const fetchGitInfo = useCallback(async () => {
    try {
      const res = await fetch('/api/sessions/git-info');
      if (res.ok) {
        const info: GitInfoMap = await res.json();
        setGitInfo(info);
      }
    } catch {
      // git info is best-effort
    }
  }, []);

  // SSE connection with exponential backoff
  useEffect(() => {
    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      const es = new EventSource('/api/sessions/stream');
      esRef.current = es;

      es.onopen = () => {
        if (cancelled) { es.close(); return; }
        setIsLive(true);
        reconnectDelayRef.current = 1000;
      };

      es.onmessage = (event) => {
        if (cancelled) return;
        try {
          const result: SessionsData = JSON.parse(event.data);
          setData(result);
          setLoading(false);
        } catch (err) {
          console.error('Failed to parse SSE data:', err);
        }
      };

      es.onerror = () => {
        if (cancelled) return;
        setIsLive(false);
        es.close();
        esRef.current = null;
        const delay = reconnectDelayRef.current;
        reconnectDelayRef.current = Math.min(delay * 2, 30_000);
        setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      cancelled = true;
      esRef.current?.close();
      esRef.current = null;
      setIsLive(false);
    };
  }, []);

  // Git info: fetch once on mount, then every 30s
  useEffect(() => {
    fetchGitInfo();
    const interval = setInterval(fetchGitInfo, 30_000);
    return () => clearInterval(interval);
  }, [fetchGitInfo]);

  // ── Action handlers ─────────────────────────────────────────────────────

  const handleDismiss = useCallback(async (project: string) => {
    setActionLoading(project);
    try {
      const result = await dismissSession(project, 'User dismissed from UI');
      if (result.success) {
        await fetchSessions();
      } else {
        alert(`Failed to dismiss: ${result.error}`);
      }
    } catch (err) {
      console.error('Error dismissing session:', err);
      alert('Failed to dismiss session');
    } finally {
      setActionLoading(null);
    }
  }, [fetchSessions]);

  const handleResume = useCallback(async (project: string) => {
    setActionLoading(project);
    try {
      const result = await resumeSession(project);
      if (result.success) {
        await fetchSessions();
      } else {
        alert(`Failed to resume: ${result.error}`);
      }
    } catch (err) {
      console.error('Error resuming session:', err);
      alert('Failed to resume session');
    } finally {
      setActionLoading(null);
    }
  }, [fetchSessions]);

  const handleMarkDone = useCallback(async (project: string) => {
    const summary = prompt(`Mark "${project}" as done.\n\nOptional summary:`);
    if (summary === null) return;
    setActionLoading(project);
    try {
      const result = await markSessionDone(project, summary || 'Marked complete from UI');
      if (result.success) {
        await fetchSessions();
      } else {
        alert(`Failed to mark done: ${result.error}`);
      }
    } catch (err) {
      console.error('Error marking session done:', err);
      alert('Failed to mark session done');
    } finally {
      setActionLoading(null);
    }
  }, [fetchSessions]);

  const handleExport = useCallback(async (format: 'json' | 'csv') => {
    try {
      await exportSessions(format);
    } catch (err) {
      console.error('Error exporting sessions:', err);
      alert('Failed to export sessions');
    }
  }, []);

  const handleViewStats = useCallback(() => {
    setShowAnalytics(true);
  }, []);

  // ── Loading / empty states ──────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-3" />
          <p className="text-xs text-muted-foreground">Loading sessions...</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-4">
        <div className="text-center py-8 text-xs text-muted-foreground">
          Failed to load sessions.
        </div>
      </div>
    );
  }

  const dismissedCount = data.dismissed?.length || 0;
  const totalActive = data.active.length + data.paused.length + data.exited.length;

  if (totalActive === 0 && data.completed.length === 0) {
    return (
      <div className="p-4">
        <div className="text-center py-8 text-xs text-muted-foreground">
          No active sessions.
        </div>
      </div>
    );
  }

  // ── Header ──────────────────────────────────────────────────────────────

  const header = (
    <div className="flex-shrink-0 px-4 pt-4 pb-3 border-b border-border">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Activity className="w-3.5 h-3.5" />
          <span>{totalActive} active / {data.completed.length} done</span>
          {isLive && (
            <span className="inline-flex items-center gap-1 rounded-md bg-green-500/15 px-1.5 py-0.5 text-[10px] font-medium text-green-700 dark:text-green-400">
              <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              Live
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* View toggle */}
          <div className="flex items-center rounded-md border border-border overflow-hidden mr-1">
            <button
              type="button"
              className={`h-7 w-7 flex items-center justify-center transition-colors ${viewMode === 'list' ? 'bg-muted' : 'hover:bg-muted/50'}`}
              onClick={() => setView('list')}
              title="List view"
            >
              <List className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              className={`h-7 w-7 flex items-center justify-center transition-colors border-l border-border ${viewMode === 'kanban' ? 'bg-muted' : 'hover:bg-muted/50'}`}
              onClick={() => setView('kanban')}
              title="Kanban view"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            type="button"
            className="ui-btn-icon h-7 w-7 !bg-transparent hover:!bg-muted"
            onClick={handleViewStats}
            title="View Statistics"
          >
            <BarChart3 className="w-3.5 h-3.5" />
          </button>

          <div className="relative group">
            <button
              type="button"
              className="ui-btn-icon h-7 w-7 !bg-transparent hover:!bg-muted"
              title="Export Sessions"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
            <div className="absolute right-0 top-full mt-1 bg-background border border-border rounded-md shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 min-w-[120px]">
              <button
                type="button"
                className="w-full text-left px-3 py-2 text-xs hover:bg-muted transition-colors"
                onClick={() => handleExport('json')}
              >
                Export JSON
              </button>
              <button
                type="button"
                className="w-full text-left px-3 py-2 text-xs hover:bg-muted transition-colors"
                onClick={() => handleExport('csv')}
              >
                Export CSV
              </button>
            </div>
          </div>

          <button
            type="button"
            className="ui-btn-icon h-7 w-7 !bg-transparent hover:!bg-muted"
            onClick={fetchSessions}
            title="Refresh"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );

  // ── Kanban view ─────────────────────────────────────────────────────────

  if (viewMode === 'kanban') {
    return (
      <div className="h-full flex flex-col">
        {header}
        <BriefingBanner />
        <div className="flex-1 overflow-auto px-3 py-3">
          <div className="flex gap-3 h-full min-h-0">

            {/* Active */}
            <KanbanColumn
              title="Active"
              icon={<Activity className="w-3 h-3 text-green-600 dark:text-green-400 animate-pulse" />}
              colorClass="text-muted-foreground"
              count={data.active.length}
            >
              {data.active.map((session, i) => (
                <KanbanCard
                  key={`${session.project}-active-${i}`}
                  session={session}
                  gitInfo={gitInfo[session.project]}
                />
              ))}
            </KanbanColumn>

            {/* Needs Input */}
            <KanbanColumn
              title="Needs Input"
              icon={<AlertCircle className="w-3 h-3 text-yellow-600 dark:text-yellow-400" />}
              colorClass="text-yellow-700 dark:text-yellow-400"
              count={data.paused.length}
            >
              {data.paused.map((session, i) => (
                <KanbanCard
                  key={`${session.project}-paused-${i}`}
                  session={session}
                  gitInfo={gitInfo[session.project]}
                  actions={
                    <>
                      <button
                        type="button"
                        className="ui-btn-icon h-5 w-5 !bg-green-500/20 hover:!bg-green-500/30 text-green-700 dark:text-green-400"
                        onClick={() => handleResume(session.project)}
                        disabled={actionLoading === session.project}
                        title="Mark as active"
                      >
                        <Play className="w-2.5 h-2.5" />
                      </button>
                      <button
                        type="button"
                        className="ui-btn-icon h-5 w-5 !bg-gray-500/20 hover:!bg-gray-500/30 text-gray-700 dark:text-gray-400"
                        onClick={() => handleDismiss(session.project)}
                        disabled={actionLoading === session.project}
                        title="Dismiss"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </>
                  }
                />
              ))}
            </KanbanColumn>

            {/* Interrupted */}
            <KanbanColumn
              title="Interrupted"
              icon={<XCircle className="w-3 h-3 text-orange-600 dark:text-orange-400" />}
              colorClass="text-muted-foreground"
              count={data.exited.length}
            >
              {data.exited.map((session, i) => (
                <KanbanCard
                  key={`${session.project}-exited-${i}`}
                  session={session}
                  gitInfo={gitInfo[session.project]}
                  actions={
                    <>
                      <button
                        type="button"
                        className="ui-btn-icon h-5 w-5 !bg-green-500/20 hover:!bg-green-500/30 text-green-700 dark:text-green-400"
                        onClick={() => handleMarkDone(session.project)}
                        disabled={actionLoading === session.project}
                        title="Mark as done"
                      >
                        <Check className="w-2.5 h-2.5" />
                      </button>
                      <button
                        type="button"
                        className="ui-btn-icon h-5 w-5 !bg-gray-500/20 hover:!bg-gray-500/30 text-gray-700 dark:text-gray-400"
                        onClick={() => handleDismiss(session.project)}
                        disabled={actionLoading === session.project}
                        title="Dismiss"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </>
                  }
                />
              ))}
            </KanbanColumn>

            {/* Done */}
            <KanbanColumn
              title="Done"
              icon={<CheckCircle className="w-3 h-3 text-muted-foreground" />}
              colorClass="text-muted-foreground"
              count={data.completed.length}
            >
              {data.completed.map((session, i) => (
                <KanbanCard
                  key={`${session.project}-completed-${i}`}
                  session={session}
                  gitInfo={gitInfo[session.project]}
                />
              ))}
            </KanbanColumn>

          </div>
        </div>
      </div>
    );
  }

  // ── List view (default) ─────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col">
      {showAnalytics && <AnalyticsModal onClose={() => setShowAnalytics(false)} />}
      {header}
      <BriefingBanner />

      <div className="flex-1 overflow-auto px-4 py-4 space-y-3">

        {/* Paused */}
        {data.paused.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle className="w-3.5 h-3.5 text-yellow-600 dark:text-yellow-400" />
              <p className="text-xs font-semibold text-yellow-700 dark:text-yellow-400">Needs Your Input</p>
            </div>
            <div className="space-y-2">
              {data.paused.map((session, i) => (
                <div
                  key={`${session.project}-paused-${i}`}
                  className="bg-yellow-500/15 border border-yellow-500/30 rounded-md p-3 group"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1">
                        <p className="text-xs font-semibold">{session.project}</p>
                        <InstanceBadge index={session.instanceIndex} />
                      </div>
                      <GitBadges gitInfo={gitInfo[session.project]} />
                      {session.details && (
                        <p className="text-xs text-yellow-800 dark:text-yellow-300 mt-1 line-clamp-2">
                          {session.details}
                        </p>
                      )}
                      <SessionNotes notes={session.notes} />
                      <p className="text-[10px] text-muted-foreground mt-1">
                        Paused {formatRelativeTime(session.lastActivityTime || session.startTime)} · started {formatTime(session.startTime)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                      <button
                        type="button"
                        className="ui-btn-icon h-6 w-6 !bg-green-500/20 hover:!bg-green-500/30 text-green-700 dark:text-green-400"
                        onClick={() => handleResume(session.project)}
                        disabled={actionLoading === session.project}
                        title="Mark as active"
                      >
                        <Play className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        className="ui-btn-icon h-6 w-6 !bg-gray-500/20 hover:!bg-gray-500/30 text-gray-700 dark:text-gray-400"
                        onClick={() => handleDismiss(session.project)}
                        disabled={actionLoading === session.project}
                        title="Dismiss"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Active */}
        {data.active.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Activity className="w-3.5 h-3.5 text-green-600 dark:text-green-400 animate-pulse" />
              <p className="text-xs font-semibold text-muted-foreground">Active</p>
            </div>
            <div className="space-y-2">
              {data.active.map((session, i) => (
                <div
                  key={`${session.project}-active-${i}`}
                  className={`rounded-md p-3 ${session.isWorking
                    ? 'bg-green-500/15 border border-green-500/30'
                    : 'bg-green-500/10 border border-green-500/20'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-medium">{session.project}</p>
                      <InstanceBadge index={session.instanceIndex} />
                      {session.isWorking && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-green-500/20 px-1.5 py-0.5 text-[10px] font-medium text-green-700 dark:text-green-400">
                          <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                          Working
                        </span>
                      )}
                    </div>
                    <span className="inline-flex items-center gap-1 rounded-md bg-green-500/20 px-1.5 py-0.5 text-[10px] font-medium text-green-700 dark:text-green-400">
                      <Clock className="w-2.5 h-2.5" />
                      {getElapsedTime(session.startTime)}
                    </span>
                  </div>
                  <GitBadges gitInfo={gitInfo[session.project]} />
                  {session.details && (
                    <p className="text-[10px] text-muted-foreground mt-1">{session.details}</p>
                  )}
                  <SessionNotes notes={session.notes} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Interrupted */}
        {data.exited.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <XCircle className="w-3.5 h-3.5 text-orange-600 dark:text-orange-400" />
              <p className="text-xs font-semibold text-muted-foreground">Interrupted</p>
            </div>
            <div className="space-y-2">
              {data.exited.map((session, i) => {
                const ReasonIcon = session.interruptReason ? getReasonIcon(session.interruptReason) : XCircle;
                const reasonLabel = session.interruptReason ? getReasonLabel(session.interruptReason) : 'Unknown';
                const colors = session.interruptReason ? getReasonColor(session.interruptReason) : {
                  text: 'text-orange-700 dark:text-orange-400',
                  bg: 'bg-orange-500/10',
                  border: 'border-orange-500/20',
                };
                return (
                  <div
                    key={`${session.project}-exited-${i}`}
                    className={`${colors.bg} border ${colors.border} rounded-md p-3 group`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{session.project}</p>
                        <GitBadges gitInfo={gitInfo[session.project]} />
                        <div className="flex items-center gap-1 mt-1">
                          <ReasonIcon className={`w-3 h-3 ${colors.text}`} />
                          <span className={`text-[10px] ${colors.text}`}>{reasonLabel}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                          {session.durationMs && (
                            <span className="flex items-center gap-0.5">
                              <Clock className="w-2.5 h-2.5" />
                              {formatDuration(session.durationMs)}
                            </span>
                          )}
                          {session.lastActivityTime && (
                            <span>• {formatRelativeTime(session.lastActivityTime)}</span>
                          )}
                        </div>
                        {session.details && (
                          <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2">{session.details}</p>
                        )}
                        <SessionNotes notes={session.notes} />
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          type="button"
                          className="ui-btn-icon h-6 w-6 !bg-green-500/20 hover:!bg-green-500/30 text-green-700 dark:text-green-400"
                          onClick={() => handleMarkDone(session.project)}
                          disabled={actionLoading === session.project}
                          title="Mark as done"
                        >
                          <Check className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          className="ui-btn-icon h-6 w-6 !bg-gray-500/20 hover:!bg-gray-500/30 text-gray-700 dark:text-gray-400"
                          onClick={() => handleDismiss(session.project)}
                          disabled={actionLoading === session.project}
                          title="Dismiss"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Dismissed */}
        {showDismissed && data.dismissed && data.dismissed.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <X className="w-3.5 h-3.5 text-muted-foreground" />
              <p className="text-xs font-semibold text-muted-foreground">Dismissed</p>
            </div>
            <div className="space-y-2">
              {data.dismissed.map((session, i) => (
                <div
                  key={`${session.project}-dismissed-${i}`}
                  className="bg-muted/30 border border-muted/50 rounded-md p-3 opacity-60"
                >
                  <p className="text-xs font-medium">{session.project}</p>
                  {session.details && (
                    <p className="text-[10px] text-muted-foreground mt-1">{session.details}</p>
                  )}
                  {session.dismissedAt && (
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Dismissed {formatRelativeTime(session.dismissedAt)}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Completed */}
        {data.completed.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle className="w-3.5 h-3.5 text-muted-foreground" />
              <p className="text-xs font-semibold text-muted-foreground">Completed</p>
            </div>
            <div className="space-y-2">
              {data.completed.map((session, i) => {
                const isManualExit = session.status === 'exited' && session.interruptReason === 'manual';
                const isSuperseded = session.status === 'exited' && session.interruptReason === 'superseded';
                return (
                  <div
                    key={`${session.project}-completed-${i}`}
                    className="bg-muted/30 border border-muted/50 rounded-md p-3"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-medium">{session.project}</p>
                        {isManualExit && (
                          <span className="inline-flex items-center rounded-md bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:text-blue-400">
                            Exited
                          </span>
                        )}
                        {isSuperseded && (
                          <span className="inline-flex items-center rounded-md bg-purple-500/10 px-1.5 py-0.5 text-[10px] font-medium text-purple-700 dark:text-purple-400">
                            Superseded
                          </span>
                        )}
                      </div>
                      {session.endTime && (
                        <span className="text-[10px] text-muted-foreground">
                          {getElapsedTime(session.startTime, session.endTime)}
                        </span>
                      )}
                    </div>
                    <GitBadges gitInfo={gitInfo[session.project]} />
                    {session.details && (
                      <p className="text-[10px] text-muted-foreground mt-1">{session.details}</p>
                    )}
                    <SessionNotes notes={session.notes} />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Show dismissed toggle */}
        {dismissedCount > 0 && (
          <div className="pt-2 border-t border-border">
            <button
              type="button"
              className="w-full text-xs text-muted-foreground hover:text-foreground py-2 px-3 rounded hover:bg-muted/50 transition-colors flex items-center justify-center gap-2"
              onClick={() => setShowDismissed(!showDismissed)}
            >
              {showDismissed ? 'Hide' : 'Show'} dismissed sessions ({dismissedCount})
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
