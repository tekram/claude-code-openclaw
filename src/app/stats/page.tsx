'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, TrendingUp, Clock, Target, Zap } from 'lucide-react';
import { formatDuration } from '@/lib/sessions/formatting';
import type {
  StatsDetailData,
  PunchCardCell,
  DurationBucket,
  WeekPoint,
  ProjectDetail,
} from '@/app/api/sessions/stats-detail/route';

// ─── Constants ─────────────────────────────────────────────────────────────────

const HOUR_LABELS = Array.from({ length: 24 }, (_, h) => {
  if (h === 0) return '12am';
  if (h === 12) return '12pm';
  return h < 12 ? `${h}am` : `${h - 12}pm`;
});

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const PROJECT_COLORS = [
  'bg-primary',
  'bg-blue-500',
  'bg-emerald-500',
  'bg-violet-500',
  'bg-rose-500',
  'bg-amber-500',
  'bg-cyan-500',
  'bg-pink-500',
] as const;

const PROJECT_TEXT_COLORS = [
  'text-primary',
  'text-blue-500',
  'text-emerald-500',
  'text-violet-500',
  'text-rose-500',
  'text-amber-500',
  'text-cyan-500',
  'text-pink-500',
] as const;

// ─── Small helpers ─────────────────────────────────────────────────────────────

function pct(value: number, total: number): number {
  return total > 0 ? (value / total) * 100 : 0;
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso;
  }
}

function fmtShortDate(ymd: string): string {
  try {
    return new Date(ymd + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return ymd;
  }
}

// ─── Stat card ──────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  highlight,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon?: React.ElementType;
  highlight?: boolean;
}) {
  return (
    <div className={`bg-card border rounded-lg p-4 flex gap-3 items-start ${highlight ? 'border-primary/40' : 'border-border'}`}>
      {Icon && (
        <div className={`mt-0.5 shrink-0 ${highlight ? 'text-primary' : 'text-muted-foreground'}`}>
          <Icon className="w-4 h-4" />
        </div>
      )}
      <div className="min-w-0">
        <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">{label}</div>
        <div className="text-2xl font-semibold tabular-nums leading-none truncate">{value}</div>
        {sub && <div className="text-[10px] text-muted-foreground mt-1 truncate">{sub}</div>}
      </div>
    </div>
  );
}

// ─── Section header ────────────────────────────────────────────────────────────

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-3">
      {children}
    </div>
  );
}

// ─── Punch card chart ──────────────────────────────────────────────────────────

function PunchCard({ cells }: { cells: PunchCardCell[] }) {
  const [tooltip, setTooltip] = useState<{ cell: PunchCardCell; x: number; y: number } | null>(null);
  const maxCount = Math.max(1, ...cells.map((c) => c.count));

  // Group by hour (rows) × dow (cols)
  // Render 24 rows (hours) × 7 columns (days)
  const CELL = 20;
  const GAP = 3;
  const STRIDE = CELL + GAP;

  function cellOpacity(count: number): string {
    if (count === 0) return 'bg-muted/40';
    const level = Math.ceil((count / maxCount) * 5);
    if (level === 1) return 'bg-primary/15';
    if (level === 2) return 'bg-primary/30';
    if (level === 3) return 'bg-primary/55';
    if (level === 4) return 'bg-primary/75';
    return 'bg-primary';
  }

  return (
    <div className="relative">
      {/* Column headers — day of week */}
      <div className="flex mb-1" style={{ paddingLeft: 44 }}>
        {DOW_LABELS.map((label) => (
          <div
            key={label}
            className="text-[9px] text-muted-foreground text-center"
            style={{ width: CELL, marginRight: GAP, flexShrink: 0 }}
          >
            {label}
          </div>
        ))}
      </div>

      {/* Grid */}
      <div className="flex flex-col" style={{ gap: GAP }}>
        {Array.from({ length: 24 }, (_, hour) => {
          const showLabel = hour % 3 === 0;
          return (
            <div key={hour} className="flex items-center" style={{ gap: GAP }}>
              {/* Hour label */}
              <div
                className="text-[9px] text-muted-foreground text-right shrink-0"
                style={{ width: 40 }}
              >
                {showLabel ? HOUR_LABELS[hour] : ''}
              </div>
              {/* 7 cells for each day */}
              {DOW_LABELS.map((_, dow) => {
                const cell = cells.find((c) => c.hour === hour && c.dow === dow);
                const count = cell?.count ?? 0;
                return (
                  <div
                    key={dow}
                    className={`rounded-sm cursor-default transition-opacity hover:opacity-70 shrink-0 ${cellOpacity(count)}`}
                    style={{ width: CELL, height: CELL }}
                    onMouseEnter={(e) =>
                      setTooltip({ cell: { hour, dow, count }, x: e.clientX, y: e.clientY })
                    }
                    onMouseMove={(e) =>
                      setTooltip((t) => (t ? { ...t, x: e.clientX, y: e.clientY } : t))
                    }
                    onMouseLeave={() => setTooltip(null)}
                    aria-label={`${HOUR_LABELS[hour]} ${DOW_LABELS[dow]}: ${count} session${count !== 1 ? 's' : ''}`}
                  />
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 px-2.5 py-1.5 bg-popover border border-border rounded-lg text-xs shadow-lg pointer-events-none"
          style={{ left: tooltip.x + 12, top: tooltip.y - 40 }}
        >
          <div className="font-medium">
            {DOW_LABELS[tooltip.cell.dow]} {HOUR_LABELS[tooltip.cell.hour]}
          </div>
          <div className="text-muted-foreground">
            {tooltip.cell.count === 0
              ? 'No sessions'
              : `${tooltip.cell.count} session${tooltip.cell.count !== 1 ? 's' : ''}`}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Duration histogram ────────────────────────────────────────────────────────

function DurationHistogram({ buckets }: { buckets: DurationBucket[] }) {
  const maxCount = Math.max(1, ...buckets.map((b) => b.count));
  const total = buckets.reduce((s, b) => s + b.count, 0);

  return (
    <div>
      {/* Bar chart */}
      <div className="flex items-end gap-1.5 h-20 mb-2">
        {buckets.map((b) => {
          const heightPct = (b.count / maxCount) * 100;
          const isZero = b.count === 0;
          return (
            <div
              key={b.label}
              className="flex-1 flex flex-col justify-end"
              title={`${b.label}: ${b.count} session${b.count !== 1 ? 's' : ''} (${total > 0 ? Math.round(pct(b.count, total)) : 0}%)`}
            >
              <div
                className={`w-full rounded-t-[2px] transition-all ${isZero ? 'bg-muted/30' : 'bg-primary/60 hover:bg-primary'}`}
                style={{ height: `${Math.max(isZero ? 4 : 6, heightPct)}%` }}
              />
            </div>
          );
        })}
      </div>
      {/* X axis labels */}
      <div className="flex gap-1.5 text-[8px] text-muted-foreground">
        {buckets.map((b) => (
          <div key={b.label} className="flex-1 text-center truncate px-px">
            {b.label}
          </div>
        ))}
      </div>
      {/* Counts below */}
      <div className="flex gap-1.5 text-[9px] tabular-nums text-muted-foreground mt-0.5">
        {buckets.map((b) => (
          <div key={b.label} className="flex-1 text-center">
            {b.count > 0 ? b.count : ''}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Weekly trend chart ────────────────────────────────────────────────────────

function WeeklyTrendChart({ weeks }: { weeks: WeekPoint[] }) {
  const maxSessions = Math.max(1, ...weeks.map((w) => w.sessions));
  const maxMinutes = Math.max(1, ...weeks.map((w) => w.totalMinutes));
  const [tooltip, setTooltip] = useState<{ week: WeekPoint; x: number; y: number } | null>(null);

  if (weeks.length === 0) {
    return <div className="h-24 flex items-center justify-center text-xs text-muted-foreground">No data</div>;
  }

  // Show only last 12 in the chart area
  const display = weeks.slice(-12);

  return (
    <div className="relative">
      {/* Dual chart: sessions (bars) + time (line overlay) */}
      <div className="flex items-end gap-1 h-24 mb-1.5">
        {display.map((w) => {
          const sessionH = pct(w.sessions, maxSessions);
          const minuteH = pct(w.totalMinutes, maxMinutes);
          const isCurrentWeek = w === display[display.length - 1];

          return (
            <div
              key={w.weekStart}
              className="flex-1 flex flex-col justify-end relative group cursor-default"
              style={{ minWidth: 0 }}
              onMouseEnter={(e) => setTooltip({ week: w, x: e.clientX, y: e.clientY })}
              onMouseMove={(e) => setTooltip((t) => (t ? { ...t, x: e.clientX, y: e.clientY } : t))}
              onMouseLeave={() => setTooltip(null)}
            >
              {/* Session count bar */}
              <div
                className={`w-full rounded-t-[2px] ${
                  isCurrentWeek
                    ? 'bg-primary'
                    : w.sessions > 0
                    ? 'bg-primary/40 group-hover:bg-primary/65'
                    : 'bg-muted/20'
                } transition-colors`}
                style={{ height: `${Math.max(w.sessions > 0 ? 4 : 2, sessionH)}%` }}
              />
              {/* Time bar overlay (slightly thinner, overlaid) */}
              {w.totalMinutes > 0 && (
                <div
                  className="absolute bottom-0 left-[25%] right-[25%] rounded-t-[1px] bg-emerald-500/50 group-hover:bg-emerald-500/75 transition-colors pointer-events-none"
                  style={{ height: `${Math.max(4, minuteH)}%` }}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* X axis: week labels (only show some) */}
      <div className="flex gap-1 text-[8px] text-muted-foreground">
        {display.map((w, i) => (
          <div key={w.weekStart} className="flex-1 text-center truncate">
            {i % 3 === 0 ? fmtShortDate(w.weekStart) : ''}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 mt-2 text-[9px] text-muted-foreground">
        <div className="flex items-center gap-1">
          <div className="w-2.5 h-2.5 rounded-[1px] bg-primary/40" />
          Sessions (bars)
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2.5 h-2.5 rounded-[1px] bg-emerald-500/50" />
          Coding time (overlay)
        </div>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 px-2.5 py-2 bg-popover border border-border rounded-lg text-xs shadow-lg pointer-events-none min-w-[140px]"
          style={{ left: tooltip.x + 12, top: tooltip.y - 60 }}
        >
          <div className="font-medium mb-1">{fmtShortDate(tooltip.week.weekStart)}</div>
          <div className="text-muted-foreground space-y-0.5">
            <div>{tooltip.week.sessions} session{tooltip.week.sessions !== 1 ? 's' : ''}</div>
            {tooltip.week.totalMinutes > 0 && (
              <div>{formatDuration(tooltip.week.totalMinutes * 60000)} coded</div>
            )}
            {tooltip.week.sessions > 0 && (
              <div>
                {Math.round(pct(tooltip.week.completed, tooltip.week.sessions))}% completed
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Completion sparkline ───────────────────────────────────────────────────────

function CompletionLine({ weeks }: { weeks: WeekPoint[] }) {
  const display = weeks.filter((w) => w.sessions > 0).slice(-12);
  if (display.length < 2) return <div className="text-xs text-muted-foreground">Not enough data</div>;

  const W = 280;
  const H = 50;
  const stepX = W / (display.length - 1);

  const rates = display.map((w) => Math.round(pct(w.completed, w.sessions)));
  const points = rates.map((r, i) => `${i * stepX},${H - (r / 100) * H}`).join(' ');

  const [tooltip, setTooltip] = useState<{ week: WeekPoint; rate: number; x: number; y: number } | null>(null);

  return (
    <div className="relative select-none">
      <svg
        width="100%"
        height={H + 4}
        viewBox={`0 0 ${W} ${H + 4}`}
        preserveAspectRatio="none"
        className="overflow-visible"
      >
        {/* 50% reference line */}
        <line
          x1={0} y1={H / 2} x2={W} y2={H / 2}
          className="stroke-muted-foreground/20"
          strokeWidth={1}
          strokeDasharray="3 3"
        />
        {/* Filled area */}
        <polygon
          points={`0,${H + 4} ${points} ${W},${H + 4}`}
          className="fill-primary/10"
        />
        {/* Line */}
        <polyline
          points={points}
          fill="none"
          className="stroke-primary"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* Dots */}
        {rates.map((r, i) => (
          <circle
            key={i}
            cx={i * stepX}
            cy={H - (r / 100) * H}
            r={3}
            className="fill-primary cursor-pointer"
            onMouseEnter={(e) =>
              setTooltip({ week: display[i], rate: r, x: e.clientX, y: e.clientY })
            }
            onMouseMove={(e) =>
              setTooltip((t) => (t ? { ...t, x: e.clientX, y: e.clientY } : t))
            }
            onMouseLeave={() => setTooltip(null)}
          />
        ))}
      </svg>

      {/* Y axis labels */}
      <div className="absolute top-0 right-0 flex flex-col justify-between text-[8px] text-muted-foreground" style={{ height: H }}>
        <span>100%</span>
        <span>50%</span>
        <span>0%</span>
      </div>

      {tooltip && (
        <div
          className="fixed z-50 px-2.5 py-1.5 bg-popover border border-border rounded-lg text-xs shadow-lg pointer-events-none"
          style={{ left: tooltip.x + 12, top: tooltip.y - 40 }}
        >
          <div className="font-medium">{fmtShortDate(tooltip.week.weekStart)}</div>
          <div className="text-muted-foreground">{tooltip.rate}% completion</div>
        </div>
      )}
    </div>
  );
}

// ─── Project mini-bar chart (hourly) ──────────────────────────────────────────

function MiniHourBar({ hourly, peakHour }: { hourly: number[]; peakHour: number }) {
  const max = Math.max(1, ...hourly);
  return (
    <div className="flex items-end gap-px h-8">
      {hourly.map((count, h) => {
        const isPeak = h === peakHour;
        return (
          <div
            key={h}
            className="flex-1"
            title={`${HOUR_LABELS[h]}: ${count}`}
          >
            <div
              className={`w-full rounded-t-[1px] ${isPeak ? 'bg-primary' : 'bg-primary/30'}`}
              style={{ height: `${Math.max(count > 0 ? 10 : 2, (count / max) * 100)}%` }}
            />
          </div>
        );
      })}
    </div>
  );
}

// ─── Project row ───────────────────────────────────────────────────────────────

function ProjectRow({
  proj,
  colorClass,
  textColorClass,
  maxSessions,
}: {
  proj: ProjectDetail;
  colorClass: string;
  textColorClass: string;
  maxSessions: number;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* Header row */}
      <button
        type="button"
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/20 transition-colors"
        onClick={() => setExpanded((e) => !e)}
      >
        {/* Color dot */}
        <div className={`w-2 h-2 rounded-full shrink-0 ${colorClass}`} />

        {/* Project name */}
        <div className="font-medium text-sm truncate flex-1 min-w-0">{proj.project}</div>

        {/* Sessions bar */}
        <div className="w-24 shrink-0">
          <div className="bg-muted/40 rounded-full h-1.5 overflow-hidden">
            <div
              className={`h-full rounded-full ${colorClass}`}
              style={{ width: `${pct(proj.totalSessions, maxSessions)}%` }}
            />
          </div>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-4 text-xs tabular-nums shrink-0">
          <span className="text-muted-foreground">{proj.totalSessions}</span>
          <span className={`font-medium ${textColorClass}`}>
            {proj.successRate}%
          </span>
          <span className="text-muted-foreground">
            {proj.avgDurationMs > 0 ? formatDuration(proj.avgDurationMs) : '—'}
          </span>
        </div>

        <ChevronDown
          className={`w-3.5 h-3.5 text-muted-foreground shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-border/50 px-4 py-3 bg-muted/5">
          <div className="grid grid-cols-2 gap-4">
            {/* Left: stats */}
            <div className="space-y-2 text-xs">
              <div className="flex justify-between text-muted-foreground">
                <span>Completed</span>
                <span className="text-foreground tabular-nums">{proj.completed} / {proj.totalSessions}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Exited</span>
                <span className="text-foreground tabular-nums">{proj.exited}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Avg session</span>
                <span className="text-foreground tabular-nums">
                  {proj.avgDurationMs > 0 ? formatDuration(proj.avgDurationMs) : '—'}
                </span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Median</span>
                <span className="text-foreground tabular-nums">
                  {proj.medianDurationMs > 0 ? formatDuration(proj.medianDurationMs) : '—'}
                </span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Longest</span>
                <span className="text-foreground tabular-nums">
                  {proj.longestSessionMs > 0 ? formatDuration(proj.longestSessionMs) : '—'}
                </span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Peak hour</span>
                <span className="text-foreground">{HOUR_LABELS[proj.mostActiveHour]}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Peak day</span>
                <span className="text-foreground">{DOW_LABELS[proj.mostActiveDow]}</span>
              </div>
              {proj.lastSessionDate && (
                <div className="flex justify-between text-muted-foreground">
                  <span>Last session</span>
                  <span className="text-foreground">{fmtShortDate(proj.lastSessionDate)}</span>
                </div>
              )}
            </div>

            {/* Right: hourly mini-chart */}
            <div>
              <div className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1.5">
                Hourly pattern
              </div>
              <MiniHourBar hourly={proj.hourly} peakHour={proj.mostActiveHour} />
              <div className="flex justify-between text-[8px] text-muted-foreground mt-1">
                <span>12am</span>
                <span>12pm</span>
                <span>11pm</span>
              </div>

              {/* DOW mini-bars */}
              <div className="mt-3 text-[9px] text-muted-foreground uppercase tracking-wider mb-1.5">
                Day pattern
              </div>
              <div className="flex items-end gap-1 h-6">
                {proj.dow.map((count, d) => {
                  const maxDow = Math.max(1, ...proj.dow);
                  const isPeak = d === proj.mostActiveDow;
                  return (
                    <div key={d} className="flex-1 flex flex-col items-center gap-0.5" title={`${DOW_LABELS[d]}: ${count}`}>
                      <div
                        className={`w-full rounded-t-[1px] ${isPeak ? 'bg-primary' : 'bg-primary/30'}`}
                        style={{ height: `${Math.max(count > 0 ? 10 : 2, (count / maxDow) * 100)}%` }}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="flex text-[7px] text-muted-foreground mt-0.5">
                {DOW_LABELS.map((d) => (
                  <div key={d} className="flex-1 text-center">{d[0]}</div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Project filter pill ────────────────────────────────────────────────────────

function ProjectPill({
  name,
  active,
  colorClass,
  onClick,
}: {
  name: string;
  active: boolean;
  colorClass: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border transition-colors whitespace-nowrap ${
        active
          ? 'border-primary bg-primary/10 text-foreground font-medium'
          : 'border-border text-muted-foreground hover:text-foreground hover:border-border/80 hover:bg-muted/20'
      }`}
    >
      <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${colorClass}`} />
      {name}
    </button>
  );
}

// ─── Empty state ────────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center px-8">
      <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mb-4">
        <TrendingUp className="w-6 h-6 text-muted-foreground" />
      </div>
      <div className="text-sm font-medium mb-1">No session data yet</div>
      <div className="text-xs text-muted-foreground max-w-xs">
        Start coding with Claude Code to see your activity patterns here.
      </div>
    </div>
  );
}

// ─── Loading spinner ────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-primary" />
    </div>
  );
}

// ─── Main page ──────────────────────────────────────────────────────────────────

export default function StatsPage() {
  const [data, setData] = useState<StatsDetailData | null>(null);
  const [error, setError] = useState(false);
  const [selectedProject, setSelectedProject] = useState<string>(''); // '' = all
  const [filteredData, setFilteredData] = useState<StatsDetailData | null>(null);
  const [filterLoading, setFilterLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Initial load (all projects)
  useEffect(() => {
    fetch('/api/sessions/stats-detail')
      .then((r) => r.json())
      .then((d: StatsDetailData) => {
        setData(d);
        setFilteredData(d);
      })
      .catch(() => setError(true));
  }, []);

  // Re-fetch when project filter changes
  const applyFilter = useCallback((project: string) => {
    setSelectedProject(project);
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setFilterLoading(true);
    const url = project
      ? `/api/sessions/stats-detail?project=${encodeURIComponent(project)}`
      : '/api/sessions/stats-detail';

    fetch(url, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((d: StatsDetailData) => {
        setFilteredData(d);
        setFilterLoading(false);
      })
      .catch((e) => {
        if (e.name !== 'AbortError') setFilterLoading(false);
      });
  }, []);

  // Derived
  const display = filteredData ?? data;
  const projectNames = data?.projectNames ?? [];
  const projects = data?.projects ?? [];

  function colorForProject(name: string): string {
    const idx = projectNames.indexOf(name) % PROJECT_COLORS.length;
    return PROJECT_COLORS[Math.max(0, idx)];
  }

  function textColorForProject(name: string): string {
    const idx = projectNames.indexOf(name) % PROJECT_TEXT_COLORS.length;
    return PROJECT_TEXT_COLORS[Math.max(0, idx)];
  }

  const maxProjectSessions = Math.max(1, ...projects.map((p) => p.totalSessions));

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <main className="h-screen flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-5 py-3 border-b border-border bg-card/50 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-muted-foreground hover:text-foreground transition-colors text-sm">
            ← Back
          </Link>
          <h1 className="text-sm font-semibold tracking-tight">Session Stats</h1>
          {display && display.totalSessions > 0 && (
            <span className="text-xs text-muted-foreground">
              {display.totalSessions} session{display.totalSessions !== 1 ? 's' : ''}
              {display.oldestSession && (
                <> · since {fmtDate(display.oldestSession)}</>
              )}
            </span>
          )}
        </div>

        {/* Project pills */}
        {projectNames.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto max-w-xl">
            <ProjectPill
              name="All"
              active={selectedProject === ''}
              colorClass="bg-muted-foreground"
              onClick={() => applyFilter('')}
            />
            {projectNames.slice(0, 8).map((name) => (
              <ProjectPill
                key={name}
                name={name}
                active={selectedProject === name}
                colorClass={colorForProject(name)}
                onClick={() => applyFilter(name)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {error && (
          <div className="p-6 text-sm text-red-500">Failed to load stats. Is the sessions log accessible?</div>
        )}

        {!data && !error && <Spinner />}

        {data && data.totalSessions === 0 && <EmptyState />}

        {data && data.totalSessions > 0 && display && (
          <div className={`p-5 space-y-6 max-w-5xl transition-opacity ${filterLoading ? 'opacity-50' : 'opacity-100'}`}>

            {/* ── Summary cards ── */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard
                label="Total Sessions"
                value={display.totalSessions}
                sub={`${display.completionRate}% completion rate`}
                icon={Zap}
                highlight
              />
              <StatCard
                label="Total Time"
                value={display.totalDurationMs > 0 ? formatDuration(display.totalDurationMs) : '—'}
                sub={
                  display.avgDurationMs > 0
                    ? `avg ${formatDuration(display.avgDurationMs)} · median ${formatDuration(display.medianDurationMs)}`
                    : undefined
                }
                icon={Clock}
              />
              <StatCard
                label="Completion Rate"
                value={`${display.completionRate}%`}
                sub={
                  display.totalSessions > 0
                    ? `${Math.round((display.completionRate / 100) * display.totalSessions)} of ${display.totalSessions} completed`
                    : undefined
                }
                icon={Target}
              />
              <StatCard
                label="Longest Session"
                value={display.longestSessionMs > 0 ? formatDuration(display.longestSessionMs) : '—'}
                sub={display.longestSessionProject || undefined}
                icon={TrendingUp}
              />
            </div>

            {/* ── Two-column row: Punch card + Weekly trend ── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

              {/* Punch card */}
              <div className="bg-card border border-border rounded-lg p-5">
                <SectionHeader>Activity Punch Card — Hour × Day</SectionHeader>
                <p className="text-[10px] text-muted-foreground mb-4">
                  When during the week you start sessions. Darker = more activity.
                </p>
                <PunchCard cells={display.punchCard} />
              </div>

              {/* Weekly trend */}
              <div className="bg-card border border-border rounded-lg p-5">
                <SectionHeader>Weekly Trend — Last 16 Weeks</SectionHeader>
                <p className="text-[10px] text-muted-foreground mb-4">
                  Session count (bars) overlaid with coding time (green).
                </p>
                <WeeklyTrendChart weeks={display.weeklyTrend} />
              </div>
            </div>

            {/* ── Two-column row: Duration histogram + Completion rate ── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

              {/* Duration histogram */}
              <div className="bg-card border border-border rounded-lg p-5">
                <SectionHeader>Session Length Distribution</SectionHeader>
                <p className="text-[10px] text-muted-foreground mb-4">
                  How long your sessions typically last.
                </p>
                <DurationHistogram buckets={display.durationHistogram} />
              </div>

              {/* Completion rate over time */}
              <div className="bg-card border border-border rounded-lg p-5">
                <SectionHeader>Completion Rate Trend</SectionHeader>
                <p className="text-[10px] text-muted-foreground mb-4">
                  % of sessions marked done each week. Higher is better.
                </p>
                <CompletionLine weeks={display.weeklyTrend} />
              </div>
            </div>

            {/* ── Per-project breakdown ── */}
            {projects.length > 0 && (
              <div className="bg-card border border-border rounded-lg p-5">
                <SectionHeader>Per-Project Breakdown</SectionHeader>

                {/* Table header */}
                <div className="flex items-center gap-3 px-4 mb-2 text-[10px] text-muted-foreground uppercase tracking-wider">
                  <div className="w-2 shrink-0" />
                  <div className="flex-1">Project</div>
                  <div className="w-24 shrink-0" />
                  <div className="w-10 text-right shrink-0">Total</div>
                  <div className="w-10 text-right shrink-0">Done%</div>
                  <div className="w-12 text-right shrink-0">Avg</div>
                  <div className="w-4 shrink-0" />
                </div>

                <div className="space-y-2">
                  {projects.map((proj, i) => (
                    <ProjectRow
                      key={proj.project}
                      proj={proj}
                      colorClass={PROJECT_COLORS[i % PROJECT_COLORS.length]}
                      textColorClass={PROJECT_TEXT_COLORS[i % PROJECT_TEXT_COLORS.length]}
                      maxSessions={maxProjectSessions}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* ── Bottom: raw stats table ── */}
            {display.weeklyTrend.filter((w) => w.sessions > 0).length > 0 && (
              <div className="bg-card border border-border rounded-lg overflow-hidden">
                <div className="px-5 py-3 border-b border-border">
                  <SectionHeader>Weekly Breakdown</SectionHeader>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border text-[10px] text-muted-foreground uppercase tracking-wider">
                        <th className="text-left px-4 py-2">Week</th>
                        <th className="text-right px-4 py-2">Sessions</th>
                        <th className="text-right px-4 py-2">Completed</th>
                        <th className="text-right px-4 py-2">Exited</th>
                        <th className="text-right px-4 py-2">Time</th>
                        <th className="text-right px-4 py-2">Done %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...display.weeklyTrend]
                        .reverse()
                        .filter((w) => w.sessions > 0)
                        .slice(0, 12)
                        .map((w) => {
                          const rate = pct(w.completed, w.sessions);
                          return (
                            <tr key={w.weekStart} className="border-b border-border/50 last:border-0 hover:bg-muted/20">
                              <td className="px-4 py-2 font-medium">{fmtShortDate(w.weekStart)}</td>
                              <td className="px-4 py-2 text-right tabular-nums">{w.sessions}</td>
                              <td className="px-4 py-2 text-right tabular-nums text-blue-500">{w.completed}</td>
                              <td className="px-4 py-2 text-right tabular-nums text-red-500/70">{w.exited}</td>
                              <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                                {w.totalMinutes > 0 ? formatDuration(w.totalMinutes * 60000) : '—'}
                              </td>
                              <td className="px-4 py-2 text-right tabular-nums">
                                <span className={rate >= 70 ? 'text-emerald-500' : rate >= 40 ? 'text-amber-500' : 'text-red-500/70'}>
                                  {Math.round(rate)}%
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
