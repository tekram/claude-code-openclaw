'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
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
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function StatusBar({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="w-20 text-xs text-muted-foreground text-right shrink-0">{label}</div>
      <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="w-8 text-xs tabular-nums text-right shrink-0">{count}</div>
    </div>
  );
}

export default function AnalyticsPage() {
  const [stats, setStats] = useState<SessionStats | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch('/api/sessions/stats')
      .then((r) => r.json())
      .then(setStats)
      .catch(() => setError(true));
  }, []);

  const allStatuses: Array<{ key: keyof SessionStats['byStatus']; label: string; color: string }> = [
    { key: 'active', label: 'Active', color: 'bg-green-500' },
    { key: 'completed', label: 'Completed', color: 'bg-blue-500' },
    { key: 'paused', label: 'Paused', color: 'bg-amber-500' },
    { key: 'exited', label: 'Exited', color: 'bg-red-500' },
    { key: 'dismissed', label: 'Dismissed', color: 'bg-gray-400' },
  ];

  const interruptReasons: InterruptReason[] = ['manual', 'crash', 'timeout', 'superseded', 'dismissed', 'unknown'];

  const sortedProjects = stats
    ? Object.entries(stats.byProject).sort((a, b) => b[1].total - a[1].total)
    : [];

  return (
    <main className="h-screen flex flex-col overflow-hidden">
      <div className="flex-shrink-0 px-5 py-3 border-b border-border bg-card/50 flex items-center gap-4">
        <Link href="/" className="text-muted-foreground hover:text-foreground transition-colors text-sm">
          ← Back
        </Link>
        <h1 className="text-sm font-semibold tracking-tight">Session Analytics</h1>
      </div>

      <div className="flex-1 overflow-y-auto">
        {error && (
          <div className="p-6 text-sm text-red-500">Failed to load statistics.</div>
        )}

        {!stats && !error && (
          <div className="flex items-center justify-center h-40">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
          </div>
        )}

        {stats && (
          <div className="p-5 space-y-6 max-w-3xl">
            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard label="Total Sessions" value={stats.totalSessions} />
              <StatCard label="Completed" value={stats.byStatus.completed} />
              <StatCard
                label="Avg Duration"
                value={stats.avgDurationMs ? formatDuration(stats.avgDurationMs) : '—'}
              />
              <StatCard
                label="Total Time"
                value={stats.totalDurationMs > 0 ? formatDuration(stats.totalDurationMs) : '—'}
              />
            </div>

            {/* Status breakdown */}
            <div className="bg-card border border-border rounded-lg p-4">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                By Status
              </div>
              <div className="space-y-2">
                {allStatuses.map(({ key, label, color }) => (
                  <StatusBar
                    key={key}
                    label={label}
                    count={stats.byStatus[key]}
                    total={stats.totalSessions}
                    color={color}
                  />
                ))}
              </div>
            </div>

            {/* Per-project breakdown */}
            {sortedProjects.length > 0 && (
              <div className="bg-card border border-border rounded-lg overflow-hidden">
                <div className="px-4 py-3 border-b border-border">
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    By Project
                  </div>
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left px-4 py-2 font-medium text-muted-foreground">Project</th>
                      <th className="text-right px-4 py-2 font-medium text-muted-foreground">Total</th>
                      <th className="text-right px-4 py-2 font-medium text-muted-foreground">Done</th>
                      <th className="text-right px-4 py-2 font-medium text-muted-foreground">Interrupted</th>
                      <th className="text-right px-4 py-2 font-medium text-muted-foreground">Avg Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedProjects.map(([project, p]) => (
                      <tr key={project} className="border-b border-border last:border-0 hover:bg-muted/30">
                        <td className="px-4 py-2 font-medium">{project}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{p.total}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-blue-500">{p.completed}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-red-500">{p.interrupted}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                          {p.avgDurationMs ? formatDuration(p.avgDurationMs) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Interruption reasons */}
            {stats.totalSessions > 0 && (
              <div className="bg-card border border-border rounded-lg p-4">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                  Exit Reasons
                </div>
                <div className="flex flex-wrap gap-2">
                  {interruptReasons
                    .filter((r) => stats.interruptionReasons[r] > 0)
                    .map((reason) => {
                      const colors = getReasonColor(reason);
                      return (
                        <div
                          key={reason}
                          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs ${colors.text} ${colors.bg} ${colors.border}`}
                        >
                          <span>{getReasonLabel(reason)}</span>
                          <span className="font-semibold tabular-nums">{stats.interruptionReasons[reason]}</span>
                        </div>
                      );
                    })}
                  {interruptReasons.every((r) => stats.interruptionReasons[r] === 0) && (
                    <span className="text-xs text-muted-foreground">No exits recorded</span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
