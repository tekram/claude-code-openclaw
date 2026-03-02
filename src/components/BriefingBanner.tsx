'use client';

import { useEffect, useState } from 'react';
import { Sun, ChevronDown, ChevronUp, GitCommitHorizontal, X, Clock, CheckCircle2, XCircle } from 'lucide-react';
import { formatDuration } from '@/lib/sessions/formatting';
import type { BriefingData, BriefingProject } from '@/app/api/sessions/briefing/route';

// ─── Dismiss key ──────────────────────────────────────────────────────────────
// Dismissed once per calendar day (resets at midnight)
function dismissKey(): string {
  const today = new Date();
  const ymd = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0'),
  ].join('-');
  return `briefing-dismissed-${ymd}`;
}

// ─── Project row ──────────────────────────────────────────────────────────────
function ProjectRow({ proj }: { proj: BriefingProject }) {
  const [open, setOpen] = useState(false);
  const hasCommits = proj.commits.length > 0;
  const successRate = proj.sessions > 0
    ? Math.round((proj.completed / proj.sessions) * 100)
    : 0;

  return (
    <div className="border border-border/60 rounded-md overflow-hidden">
      {/* Project header — always visible */}
      <button
        type="button"
        className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-muted/30 transition-colors"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <span className="text-xs font-medium truncate">{proj.project}</span>
          <span className="text-[10px] text-muted-foreground shrink-0">
            {proj.sessions} session{proj.sessions !== 1 ? 's' : ''}
          </span>
          {proj.totalDurationMs > 0 && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground shrink-0">
              <Clock className="w-2.5 h-2.5" />
              {formatDuration(proj.totalDurationMs)}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Done / failed chips */}
          {proj.completed > 0 && (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-green-700 dark:text-green-400">
              <CheckCircle2 className="w-3 h-3" />
              {proj.completed}
            </span>
          )}
          {proj.exited > 0 && (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-red-600 dark:text-red-400">
              <XCircle className="w-3 h-3" />
              {proj.exited}
            </span>
          )}
          {/* Commit count */}
          {hasCommits && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-primary/70">
              <GitCommitHorizontal className="w-3 h-3" />
              {proj.commits.length}
            </span>
          )}
          {/* Expand chevron — only if there's something to show */}
          {(hasCommits || proj.sessions > 1) && (
            open
              ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
              : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
          )}
        </div>
      </button>

      {/* Expanded: commit list */}
      {open && (
        <div className="px-3 pb-2.5 pt-1 border-t border-border/40 bg-muted/20 space-y-1">
          {hasCommits ? (
            proj.commits.map((c) => (
              <div key={c.hash} className="flex items-start gap-1.5 text-[10px]">
                <GitCommitHorizontal className="w-3 h-3 mt-0.5 shrink-0 text-primary/50" />
                <code className="text-primary/60 shrink-0 font-mono">{c.hash.substring(0, 7)}</code>
                <span className="text-muted-foreground truncate">{c.message}</span>
              </div>
            ))
          ) : (
            <p className="text-[10px] text-muted-foreground italic">
              No commits in this window {successRate < 100 ? '· some sessions were interrupted' : ''}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main banner ──────────────────────────────────────────────────────────────
export function BriefingBanner() {
  const [data, setData] = useState<BriefingData | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    // Check if dismissed today
    try {
      if (typeof window !== 'undefined' && localStorage.getItem(dismissKey())) {
        setDismissed(true);
        return;
      }
    } catch { /* localStorage unavailable */ }

    fetch('/api/sessions/briefing')
      .then((r) => r.json())
      .then((d: BriefingData) => {
        if (d.hasData) setData(d);
      })
      .catch(() => {});
  }, []);

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    try { localStorage.setItem(dismissKey(), '1'); } catch { /* ignore */ }
    setDismissed(true);
  };

  if (dismissed || !data) return null;

  const totalTimeLabel = data.totalDurationMs > 0
    ? formatDuration(data.totalDurationMs)
    : null;

  const totalCommits = data.projects.reduce((s, p) => s + p.commits.length, 0);

  return (
    <div className="flex-shrink-0 border-b border-amber-500/20 bg-amber-500/5 dark:bg-amber-500/5">
      {/* Summary row — div instead of button so the dismiss button inside is valid HTML */}
      <div
        role="button"
        tabIndex={0}
        className="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-amber-500/5 transition-colors cursor-pointer"
        onClick={() => setExpanded((e) => !e)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setExpanded((v) => !v); }}
        aria-expanded={expanded}
        aria-label="Morning Briefing — toggle details"
      >
        <Sun className="w-3.5 h-3.5 text-amber-500 shrink-0 animate-none" />

        <div className="flex-1 flex items-center gap-1.5 min-w-0 text-xs overflow-hidden">
          <span className="font-medium text-amber-700 dark:text-amber-400 shrink-0">
            Morning Briefing
          </span>
          <span className="text-muted-foreground shrink-0">·</span>
          <span className="text-muted-foreground shrink-0">
            {data.totalSessions} session{data.totalSessions !== 1 ? 's' : ''}
          </span>
          {totalTimeLabel && (
            <>
              <span className="text-muted-foreground shrink-0">·</span>
              <span className="text-muted-foreground shrink-0">{totalTimeLabel}</span>
            </>
          )}
          {totalCommits > 0 && (
            <>
              <span className="text-muted-foreground shrink-0">·</span>
              <span className="inline-flex items-center gap-0.5 text-muted-foreground shrink-0">
                <GitCommitHorizontal className="w-3 h-3" />
                {totalCommits} commit{totalCommits !== 1 ? 's' : ''}
              </span>
            </>
          )}
          <span className="text-muted-foreground shrink-0 hidden sm:inline">·</span>
          <span className="text-muted-foreground shrink-0 hidden sm:inline">
            last {data.windowHours}h
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {expanded
            ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
            : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
          }
          <button
            type="button"
            className="p-1 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
            onClick={handleDismiss}
            title="Dismiss for today"
            aria-label="Dismiss briefing for today"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Expanded: per-project rows */}
      {expanded && (
        <div className="px-4 pb-3 space-y-1.5">
          {data.projects.map((proj) => (
            <ProjectRow key={proj.project} proj={proj} />
          ))}
        </div>
      )}
    </div>
  );
}
