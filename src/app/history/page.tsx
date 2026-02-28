'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Search, ChevronDown, ChevronUp, Activity, CheckCircle2, XCircle,
  AlertCircle, Ban, Clock, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { formatDuration, getReasonLabel } from '@/lib/sessions/formatting';
import type { Session } from '@/types/sessions';
import type { HistoryResponse } from '@/app/api/sessions/history/route';
import { SessionCommits } from '@/components/SessionCommits';

// ─── Constants ────────────────────────────────────────────────────────────────
const PER_PAGE = 50;

const STATUS_FILTERS = [
  { value: 'all',       label: 'All' },
  { value: 'completed', label: 'Completed' },
  { value: 'exited',    label: 'Exited' },
  { value: 'active',    label: 'Active' },
  { value: 'paused',    label: 'Paused' },
  { value: 'dismissed', label: 'Dismissed' },
] as const;

type StatusFilter = typeof STATUS_FILTERS[number]['value'];

const DATE_RANGES = [
  { label: 'Today',   days: 0 },
  { label: '7d',      days: 7 },
  { label: '30d',     days: 30 },
  { label: '90d',     days: 90 },
  { label: 'All time', days: -1 },
] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function localDateString(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

function formatDateTime(ts: string): string {
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return ts; }
}

function StatusDot({ status, reason }: { status: Session['status']; reason?: Session['interruptReason'] }) {
  if (status === 'active')    return <Activity className="w-3 h-3 text-green-500 animate-pulse shrink-0" />;
  if (status === 'paused')    return <AlertCircle className="w-3 h-3 text-amber-500 shrink-0" />;
  if (status === 'completed') return <CheckCircle2 className="w-3 h-3 text-blue-500 shrink-0" />;
  if (status === 'dismissed') return <Ban className="w-3 h-3 text-muted-foreground shrink-0" />;
  // exited
  if (reason === 'timeout')   return <Clock className="w-3 h-3 text-orange-500 shrink-0" />;
  return <XCircle className="w-3 h-3 text-red-500 shrink-0" />;
}

function StatusLabel({ status, reason }: { status: Session['status']; reason?: Session['interruptReason'] }) {
  if (status === 'active')    return <span className="text-green-600 dark:text-green-400">Active</span>;
  if (status === 'paused')    return <span className="text-amber-600 dark:text-amber-400">Paused</span>;
  if (status === 'completed') return <span className="text-blue-600 dark:text-blue-400">Done</span>;
  if (status === 'dismissed') return <span className="text-muted-foreground">Dismissed</span>;
  // exited
  if (reason) return <span className="text-red-600 dark:text-red-400">{getReasonLabel(reason).split(' ')[0]}</span>;
  return <span className="text-red-600 dark:text-red-400">Exited</span>;
}

// ─── Session row ──────────────────────────────────────────────────────────────
function SessionRow({ session }: { session: Session }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = !!(session.details || (session.notes && session.notes.length > 0))
    || session.status === 'completed'
    || session.status === 'exited';

  return (
    <>
      <tr
        className={`border-b border-border/50 text-xs hover:bg-muted/20 transition-colors ${hasDetails ? 'cursor-pointer' : ''}`}
        onClick={() => hasDetails && setExpanded((e) => !e)}
      >
        <td className="px-3 py-2 w-4">
          <StatusDot status={session.status} reason={session.interruptReason} />
        </td>
        <td className="px-3 py-2 font-medium">
          <div className="flex items-center gap-1">
            <span>{session.project}</span>
            {session.instanceIndex && (
              <span className="text-[9px] text-muted-foreground">·{session.instanceIndex}</span>
            )}
          </div>
        </td>
        <td className="px-3 py-2">
          <StatusLabel status={session.status} reason={session.interruptReason} />
        </td>
        <td className="px-3 py-2 text-muted-foreground tabular-nums whitespace-nowrap">
          {formatDateTime(session.startTime)}
        </td>
        <td className="px-3 py-2 text-muted-foreground tabular-nums">
          {session.durationMs ? formatDuration(session.durationMs) : '—'}
        </td>
        <td className="px-3 py-2 text-muted-foreground max-w-[280px]">
          <span className="truncate block">{session.details || ''}</span>
        </td>
        <td className="px-3 py-2 w-5">
          {hasDetails && (
            expanded
              ? <ChevronUp className="w-3 h-3 text-muted-foreground" />
              : <ChevronDown className="w-3 h-3 text-muted-foreground" />
          )}
        </td>
      </tr>

      {expanded && hasDetails && (
        <tr className="border-b border-border/30 bg-muted/10">
          <td colSpan={7} className="px-6 py-2.5">
            {session.details && (
              <p className="text-xs text-foreground mb-1.5">{session.details}</p>
            )}
            {session.notes && session.notes.length > 0 && (
              <div className="space-y-0.5 mt-1">
                {session.notes.map((note, i) => (
                  <p key={i} className="text-[10px] text-muted-foreground">
                    Note: {note}
                  </p>
                ))}
              </div>
            )}
            <div className="text-[10px] text-muted-foreground mt-1.5 flex gap-4">
              <span>Started: {new Date(session.startTime).toLocaleString()}</span>
              {session.endTime && (
                <span>Ended: {new Date(session.endTime).toLocaleString()}</span>
              )}
            </div>
            {(session.status === 'completed' || session.status === 'exited') && (
              <SessionCommits project={session.project} startTime={session.startTime} endTime={session.endTime} startHash={session.startCommitHash} endHash={session.endCommitHash} />
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function HistoryPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [dateRange, setDateRange] = useState<number>(30); // days; -1 = all time
  const [offset, setOffset] = useState(0);

  const searchRef = useRef<HTMLInputElement>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const fetchHistory = useCallback(
    (searchVal: string, status: string, days: number, off: number) => {
      setLoading(true);
      setError(false);

      const params = new URLSearchParams({
        limit: String(PER_PAGE),
        offset: String(off),
        status,
      });
      if (searchVal) params.set('search', searchVal);
      if (days >= 0) {
        params.set('from', localDateString(days));
      }

      fetch(`/api/sessions/history?${params}`)
        .then((r) => r.json())
        .then((data: HistoryResponse) => {
          setSessions(data.sessions);
          setTotal(data.total);
          setLoading(false);
        })
        .catch(() => {
          setError(true);
          setLoading(false);
        });
    },
    []
  );

  // Initial load + when filters change (debounce search)
  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      fetchHistory(search, statusFilter, dateRange, offset);
    }, 250);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [search, statusFilter, dateRange, offset, fetchHistory]);

  // Reset offset when filters change
  const setFilter = (status: StatusFilter) => { setStatusFilter(status); setOffset(0); };
  const setRange = (days: number) => { setDateRange(days); setOffset(0); };
  const handleSearch = (v: string) => { setSearch(v); setOffset(0); };

  const totalPages = Math.ceil(total / PER_PAGE);
  const currentPage = Math.floor(offset / PER_PAGE) + 1;

  return (
    <main className="h-screen flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-5 py-3 border-b border-border bg-card/50 flex items-center gap-4">
        <Link href="/" className="text-muted-foreground hover:text-foreground transition-colors text-sm">
          ← Back
        </Link>
        <h1 className="text-sm font-semibold tracking-tight">Session History</h1>
        {total > 0 && !loading && (
          <span className="text-xs text-muted-foreground">{total} session{total !== 1 ? 's' : ''}</span>
        )}
      </div>

      {/* Toolbar */}
      <div className="flex-shrink-0 px-5 py-2.5 border-b border-border bg-card/30 flex items-center gap-3 flex-wrap">
        {/* Search */}
        <div className="relative flex-1 min-w-[180px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search project, details…"
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-input border border-border rounded-md outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        {/* Date range */}
        <div className="flex items-center gap-0.5 border border-border rounded-md overflow-hidden">
          {DATE_RANGES.map(({ label, days }) => (
            <button
              key={label}
              type="button"
              className={`px-2.5 py-1.5 text-xs transition-colors ${dateRange === days ? 'bg-primary text-primary-foreground' : 'hover:bg-muted/50 text-muted-foreground'}`}
              onClick={() => setRange(days)}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Status filter */}
        <div className="flex items-center gap-0.5 border border-border rounded-md overflow-hidden">
          {STATUS_FILTERS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              className={`px-2.5 py-1.5 text-xs transition-colors ${statusFilter === value ? 'bg-primary text-primary-foreground' : 'hover:bg-muted/50 text-muted-foreground'}`}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {error && (
          <div className="p-6 text-sm text-red-500">Failed to load session history.</div>
        )}

        {!error && sessions.length === 0 && !loading && (
          <div className="flex items-center justify-center h-40">
            <p className="text-sm text-muted-foreground">No sessions match your filters.</p>
          </div>
        )}

        {loading && sessions.length === 0 && (
          <div className="flex items-center justify-center h-40">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
          </div>
        )}

        {sessions.length > 0 && (
          <table className="w-full">
            <thead className="sticky top-0 bg-card/95 backdrop-blur-sm border-b border-border z-10">
              <tr className="text-[10px] text-muted-foreground uppercase tracking-wider">
                <th className="px-3 py-2 text-left w-4" />
                <th className="px-3 py-2 text-left">Project</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left whitespace-nowrap">Started</th>
                <th className="px-3 py-2 text-left">Duration</th>
                <th className="px-3 py-2 text-left">Details</th>
                <th className="px-3 py-2 w-5" />
              </tr>
            </thead>
            <tbody>
              {sessions.map((s, i) => (
                <SessionRow
                  key={`${s.project}-${s.startTime}-${i}`}
                  session={s}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {total > PER_PAGE && (
        <div className="flex-shrink-0 border-t border-border px-5 py-2.5 flex items-center justify-between bg-card/50">
          <span className="text-xs text-muted-foreground">
            Page {currentPage} of {totalPages} · {total} total
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="p-1.5 rounded hover:bg-muted/50 text-muted-foreground disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={() => setOffset(Math.max(0, offset - PER_PAGE))}
              disabled={offset === 0}
              aria-label="Previous page"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              className="p-1.5 rounded hover:bg-muted/50 text-muted-foreground disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={() => setOffset(offset + PER_PAGE)}
              disabled={offset + PER_PAGE >= total}
              aria-label="Next page"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
