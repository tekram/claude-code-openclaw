'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { X, ExternalLink } from 'lucide-react';
import { formatDuration, getReasonLabel, getReasonColor } from '@/lib/sessions/formatting';
import type { InterruptReason } from '@/types/sessions';

interface SessionStats {
  totalSessions: number;
  byStatus: {
    active: number;
    paused: number;
    completed: number;
    exited: number;
    dismissed: number;
  };
  byProject: Record<string, {
    total: number;
    completed: number;
    interrupted: number;
    avgDurationMs?: number;
  }>;
  interruptionReasons: Record<InterruptReason, number>;
  avgDurationMs?: number;
  totalDurationMs: number;
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-muted/50 rounded-lg p-3">
      <div className="text-[10px] text-muted-foreground mb-1">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function StatusBar({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="w-20 text-xs text-muted-foreground text-right shrink-0">{label}</div>
      <div className="flex-1 bg-muted rounded-full h-1.5 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="w-6 text-xs tabular-nums text-right shrink-0">{count}</div>
    </div>
  );
}

const INTERRUPT_REASONS: InterruptReason[] = ['manual', 'crash', 'timeout', 'superseded', 'dismissed', 'unknown'];

const STATUS_BARS = [
  { key: 'active' as const, label: 'Active', color: 'bg-green-500' },
  { key: 'completed' as const, label: 'Completed', color: 'bg-blue-500' },
  { key: 'paused' as const, label: 'Paused', color: 'bg-amber-500' },
  { key: 'exited' as const, label: 'Exited', color: 'bg-red-500' },
  { key: 'dismissed' as const, label: 'Dismissed', color: 'bg-gray-400' },
];

interface Props {
  onClose: () => void;
}

export function AnalyticsModal({ onClose }: Props) {
  const [stats, setStats] = useState<SessionStats | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch('/api/sessions/stats')
      .then((r) => r.json())
      .then(setStats)
      .catch(() => setError(true));
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const sortedProjects = stats
    ? Object.entries(stats.byProject).sort((a, b) => b[1].total - a[1].total)
    : [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-background border border-border rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <span className="text-sm font-semibold">Session Analytics</span>
          <div className="flex items-center gap-1">
            <Link
              href="/analytics"
              target="_blank"
              className="h-6 px-2 flex items-center gap-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <ExternalLink className="w-3 h-3" />
              Full page
            </Link>
            <button
              type="button"
              onClick={onClose}
              className="h-6 w-6 flex items-center justify-center rounded hover:bg-muted transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-4 space-y-4">
          {error && (
            <p className="text-sm text-red-500">Failed to load statistics.</p>
          )}

          {!stats && !error && (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary" />
            </div>
          )}

          {stats && (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-4 gap-2">
                <StatCard label="Total" value={stats.totalSessions} />
                <StatCard label="Completed" value={stats.byStatus.completed} />
                <StatCard label="Avg Duration" value={stats.avgDurationMs ? formatDuration(stats.avgDurationMs) : '—'} />
                <StatCard label="Total Time" value={stats.totalDurationMs > 0 ? formatDuration(stats.totalDurationMs) : '—'} />
              </div>

              {/* Status breakdown */}
              <div>
                <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">By Status</div>
                <div className="space-y-2">
                  {STATUS_BARS.map(({ key, label, color }) => (
                    <StatusBar key={key} label={label} count={stats.byStatus[key]} total={stats.totalSessions} color={color} />
                  ))}
                </div>
              </div>

              {/* Per-project table */}
              {sortedProjects.length > 0 && (
                <div>
                  <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">By Project</div>
                  <div className="border border-border rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border bg-muted/30">
                          <th className="text-left px-3 py-2 font-medium text-muted-foreground">Project</th>
                          <th className="text-right px-3 py-2 font-medium text-muted-foreground">Total</th>
                          <th className="text-right px-3 py-2 font-medium text-muted-foreground">Done</th>
                          <th className="text-right px-3 py-2 font-medium text-muted-foreground">Interrupted</th>
                          <th className="text-right px-3 py-2 font-medium text-muted-foreground">Avg</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedProjects.map(([project, p]) => (
                          <tr key={project} className="border-b border-border last:border-0 hover:bg-muted/20">
                            <td className="px-3 py-2 font-medium">{project}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{p.total}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-blue-500">{p.completed}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-red-500">{p.interrupted}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                              {p.avgDurationMs ? formatDuration(p.avgDurationMs) : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Exit reasons */}
              {INTERRUPT_REASONS.some((r) => stats.interruptionReasons[r] > 0) && (
                <div>
                  <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">Exit Reasons</div>
                  <div className="flex flex-wrap gap-1.5">
                    {INTERRUPT_REASONS.filter((r) => stats.interruptionReasons[r] > 0).map((reason) => {
                      const colors = getReasonColor(reason);
                      return (
                        <div
                          key={reason}
                          className={`flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs ${colors.text} ${colors.bg} ${colors.border}`}
                        >
                          <span>{getReasonLabel(reason)}</span>
                          <span className="font-semibold tabular-nums">{stats.interruptionReasons[reason]}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
