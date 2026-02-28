'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { formatDuration } from '@/lib/sessions/formatting';
import type { HeatmapData, HeatmapDay } from '@/app/api/sessions/heatmap/route';

// ─── Layout constants ──────────────────────────────────────────────────────────
const CELL_PX = 11;
const GAP_PX = 2;
const STRIDE = CELL_PX + GAP_PX; // px per row/column step

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ─── Helpers ───────────────────────────────────────────────────────────────────
function getCellClass(count: number, max: number): string {
  if (count === 0) return 'bg-muted/50';
  const level = Math.min(4, Math.ceil((count / max) * 4));
  if (level === 1) return 'bg-primary/25';
  if (level === 2) return 'bg-primary/50';
  if (level === 3) return 'bg-primary/75';
  return 'bg-primary';
}

function formatHour(hour: number): string {
  if (hour === 0) return '12am';
  if (hour === 12) return '12pm';
  return hour < 12 ? `${hour}am` : `${hour - 12}pm`;
}

// ─── Sub-components ────────────────────────────────────────────────────────────
function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-card border border-border rounded-lg p-4 flex-1 min-w-0">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">{label}</div>
      <div className="text-2xl font-semibold tabular-nums truncate">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5 truncate">{sub}</div>}
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────
export default function InsightsPage() {
  const [data, setData] = useState<HeatmapData | null>(null);
  const [error, setError] = useState(false);
  const [tooltip, setTooltip] = useState<{ day: HeatmapDay; x: number; y: number } | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/sessions/heatmap')
      .then((r) => r.json())
      .then(setData)
      .catch(() => setError(true));
  }, []);

  // ── Loading / error states ──
  const header = (
    <div className="flex-shrink-0 px-5 py-3 border-b border-border bg-card/50 flex items-center gap-4">
      <Link href="/" className="text-muted-foreground hover:text-foreground transition-colors text-sm">
        ← Back
      </Link>
      <h1 className="text-sm font-semibold tracking-tight">Activity Insights</h1>
    </div>
  );

  if (error) {
    return (
      <main className="h-screen flex flex-col">
        {header}
        <div className="p-6 text-sm text-red-500">Failed to load insights.</div>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="h-screen flex flex-col">
        {header}
        <div className="flex items-center justify-center h-40">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
        </div>
      </main>
    );
  }

  // ── Heatmap grid construction ──
  // Pad the start so row 0 = Sunday
  const firstDow = data.days.length > 0
    ? new Date(data.days[0].date + 'T12:00:00').getDay()
    : 0;

  const paddedDays: (HeatmapDay | null)[] = [
    ...Array<null>(firstDow).fill(null),
    ...data.days,
  ];

  // Pad the end to fill the last column
  const remainder = paddedDays.length % 7;
  if (remainder !== 0) {
    for (let i = 0; i < 7 - remainder; i++) paddedDays.push(null);
  }

  const numWeeks = paddedDays.length / 7;
  const gridWidth = numWeeks * STRIDE - GAP_PX;

  // Month label positions
  const monthPositions: Array<{ label: string; col: number }> = [];
  let lastMonth = -1;
  for (let i = 0; i < paddedDays.length; i++) {
    const day = paddedDays[i];
    if (!day) continue;
    const month = parseInt(day.date.substring(5, 7), 10) - 1;
    if (month !== lastMonth) {
      const col = Math.floor(i / 7);
      // Skip the very first column if it's partial (less than 4 days visible)
      // to avoid overlapping month label with the heatmap edge
      const daysInFirstCol = 7 - firstDow;
      if (col === 0 && daysInFirstCol < 4) {
        lastMonth = month;
        continue;
      }
      monthPositions.push({ label: MONTH_NAMES[month], col });
      lastMonth = month;
    }
  }

  // ── Derived display values ──
  const maxHourly = Math.max(1, ...data.hourlyDistribution);
  const maxDow = Math.max(1, ...data.dayOfWeekCounts);

  const totalHours = data.totalDurationMs > 0
    ? formatDuration(data.totalDurationMs)
    : '—';

  const streakLabel = data.streakCurrent > 0
    ? `${data.streakCurrent} day${data.streakCurrent !== 1 ? 's' : ''}`
    : '—';

  const streakSub = data.streakLongest > 0
    ? `best ${data.streakLongest}d`
    : 'no streak yet';

  const peakDayName = DAY_LABELS[data.mostActiveDayOfWeek];
  const peakDayCount = data.dayOfWeekCounts[data.mostActiveDayOfWeek];

  return (
    <main className="h-screen flex flex-col overflow-hidden">
      {header}

      <div className="flex-1 overflow-y-auto">
        <div className="p-5 space-y-5 max-w-5xl">

          {/* ── Stats row ── */}
          <div className="flex gap-3">
            <StatCard
              label="Total Sessions"
              value={data.totalSessions}
              sub="all time"
            />
            <StatCard
              label="Coding Time"
              value={totalHours}
              sub="total logged"
            />
            <StatCard
              label="Current Streak"
              value={streakLabel}
              sub={streakSub}
            />
            <StatCard
              label="Peak Hour"
              value={formatHour(data.mostActiveHour)}
              sub={`${peakDayCount} sessions on ${peakDayName}s`}
            />
          </div>

          {/* ── Activity Calendar ── */}
          <div className="bg-card border border-border rounded-lg p-5">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-4">
              Activity — Past Year
            </div>

            <div className="flex gap-3">
              {/* Day-of-week labels — only show Mon, Wed, Fri to avoid crowding */}
              <div
                className="flex flex-col shrink-0 pt-5"
                style={{ gap: GAP_PX }}
                aria-hidden="true"
              >
                {DAY_LABELS.map((label, i) => (
                  <div
                    key={label}
                    className="text-[9px] text-muted-foreground flex items-center"
                    style={{ height: CELL_PX }}
                  >
                    {i % 2 === 1 ? label : ''}
                  </div>
                ))}
              </div>

              {/* Calendar grid + month labels */}
              <div className="overflow-x-auto flex-1">
                {/* Month labels row */}
                <div
                  className="relative h-5 mb-0.5"
                  style={{ width: gridWidth, minWidth: gridWidth }}
                >
                  {monthPositions.map(({ label, col }) => (
                    <span
                      key={`${label}-${col}`}
                      className="absolute text-[9px] text-muted-foreground select-none"
                      style={{ left: col * STRIDE }}
                    >
                      {label}
                    </span>
                  ))}
                </div>

                {/* Heatmap cells */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateRows: `repeat(7, ${CELL_PX}px)`,
                    gridAutoFlow: 'column',
                    gridAutoColumns: CELL_PX,
                    gap: GAP_PX,
                    width: gridWidth,
                    minWidth: gridWidth,
                  }}
                >
                  {paddedDays.map((day, idx) => {
                    if (!day) {
                      return (
                        <div
                          key={`pad-${idx}`}
                          className="rounded-[2px]"
                          style={{ width: CELL_PX, height: CELL_PX }}
                        />
                      );
                    }
                    const projectList = day.projects.length > 0
                      ? ` · ${day.projects.slice(0, 3).join(', ')}${day.projects.length > 3 ? '…' : ''}`
                      : '';
                    return (
                      <div
                        key={day.date}
                        className={`rounded-[2px] cursor-default transition-opacity hover:opacity-75 ${getCellClass(day.count, data.maxCount)}`}
                        style={{ width: CELL_PX, height: CELL_PX }}
                        onMouseEnter={(e) =>
                          setTooltip({ day, x: e.clientX, y: e.clientY })
                        }
                        onMouseMove={(e) =>
                          setTooltip((t) => t ? { ...t, x: e.clientX, y: e.clientY } : t)
                        }
                        onMouseLeave={() => setTooltip(null)}
                        aria-label={`${day.date}: ${day.count} session${day.count !== 1 ? 's' : ''}${projectList}`}
                      />
                    );
                  })}
                </div>

                {/* Legend */}
                <div className="flex items-center gap-1.5 mt-3">
                  <span className="text-[9px] text-muted-foreground select-none">Less</span>
                  {(['bg-muted/50', 'bg-primary/25', 'bg-primary/50', 'bg-primary/75', 'bg-primary'] as const).map((cls, i) => (
                    <div
                      key={i}
                      className={`rounded-[2px] ${cls}`}
                      style={{ width: CELL_PX, height: CELL_PX }}
                    />
                  ))}
                  <span className="text-[9px] text-muted-foreground select-none">More</span>
                </div>
              </div>
            </div>
          </div>

          {/* ── Bottom row: Hourly + Day-of-week ── */}
          <div className="grid grid-cols-2 gap-4">

            {/* Hourly distribution */}
            <div className="bg-card border border-border rounded-lg p-4">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                Sessions by Hour
              </div>
              <div className="flex items-end gap-px h-16">
                {data.hourlyDistribution.map((count, hour) => {
                  const heightPct = maxHourly > 0 ? (count / maxHourly) * 100 : 0;
                  const isPeak = hour === data.mostActiveHour;
                  return (
                    <div
                      key={hour}
                      className="flex-1 flex flex-col justify-end"
                      title={`${formatHour(hour)}: ${count} session${count !== 1 ? 's' : ''}`}
                    >
                      <div
                        className={`w-full rounded-t-[1px] ${isPeak ? 'bg-primary' : 'bg-primary/35'}`}
                        style={{ height: `${Math.max(count > 0 ? 4 : 2, heightPct)}%` }}
                      />
                    </div>
                  );
                })}
              </div>
              {/* Hour axis labels */}
              <div className="flex mt-1.5 text-[8px] text-muted-foreground">
                {Array.from({ length: 24 }, (_, h) => (
                  <div key={h} className="flex-1 text-center">
                    {h % 6 === 0 ? formatHour(h) : ''}
                  </div>
                ))}
              </div>
              <div className="mt-2 text-[10px] text-muted-foreground">
                Peak: <span className="text-foreground font-medium">{formatHour(data.mostActiveHour)}</span>
                {data.hourlyDistribution[data.mostActiveHour] > 0 && (
                  <span> ({data.hourlyDistribution[data.mostActiveHour]} sessions)</span>
                )}
              </div>
            </div>

            {/* Day-of-week distribution */}
            <div className="bg-card border border-border rounded-lg p-4">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                Sessions by Day of Week
              </div>
              <div className="space-y-2">
                {DAY_LABELS.map((label, i) => {
                  const count = data.dayOfWeekCounts[i];
                  const pct = maxDow > 0 ? (count / maxDow) * 100 : 0;
                  const isPeak = i === data.mostActiveDayOfWeek;
                  return (
                    <div key={label} className="flex items-center gap-2">
                      <div className="w-7 text-[10px] text-muted-foreground shrink-0">{label}</div>
                      <div className="flex-1 bg-muted/50 rounded-full h-1.5 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${isPeak ? 'bg-primary' : 'bg-primary/45'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="w-6 text-[10px] tabular-nums text-right text-muted-foreground shrink-0">
                        {count}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 text-[10px] text-muted-foreground">
                Most active: <span className="text-foreground font-medium">{DAY_LABELS[data.mostActiveDayOfWeek]}</span>
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* Floating tooltip */}
      {tooltip && (
        <div
          ref={tooltipRef}
          className="fixed z-50 px-3 py-2 bg-popover border border-border rounded-lg text-xs shadow-lg pointer-events-none"
          style={{
            left: tooltip.x + 14,
            top: tooltip.y - 44,
          }}
        >
          <div className="font-medium text-foreground">{tooltip.day.date}</div>
          <div className="text-muted-foreground mt-0.5">
            {tooltip.day.count === 0
              ? 'No sessions'
              : `${tooltip.day.count} session${tooltip.day.count !== 1 ? 's' : ''}`}
            {tooltip.day.totalMinutes > 0 && (
              <span> · {formatDuration(tooltip.day.totalMinutes * 60000)}</span>
            )}
          </div>
          {tooltip.day.projects.length > 0 && (
            <div className="text-muted-foreground mt-0.5 text-[10px]">
              {tooltip.day.projects.slice(0, 4).join(', ')}
              {tooltip.day.projects.length > 4 && ` +${tooltip.day.projects.length - 4} more`}
            </div>
          )}
        </div>
      )}
    </main>
  );
}
