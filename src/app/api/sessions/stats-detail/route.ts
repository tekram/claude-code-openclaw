import { readFileSync, existsSync } from 'fs';
import { LOG_PATH, parseLogLines, parseTimestamp } from '@/lib/sessions/parse';

// ─── Exported types ────────────────────────────────────────────────────────────

/** One cell in the punch card: hour 0-23 × weekday 0-6 (Sun=0) */
export interface PunchCardCell {
  hour: number;
  dow: number;
  count: number;
}

/** One bucket in the duration histogram */
export interface DurationBucket {
  label: string;     // e.g. "0–5m", "5–15m"
  minMs: number;
  maxMs: number;
  count: number;
}

/** One data point in the weekly productivity trend */
export interface WeekPoint {
  weekStart: string; // YYYY-MM-DD (Monday)
  sessions: number;
  totalMinutes: number;
  completed: number;
  exited: number;
}

/** Per-project summary row */
export interface ProjectDetail {
  project: string;
  totalSessions: number;
  completed: number;
  exited: number;
  dismissed: number;
  totalDurationMs: number;
  avgDurationMs: number;
  medianDurationMs: number;
  successRate: number;          // 0–100
  mostActiveHour: number;       // 0–23
  mostActiveDow: number;        // 0–6
  hourly: number[];             // 24 values
  dow: number[];                // 7 values
  longestSessionMs: number;
  lastSessionDate: string;      // YYYY-MM-DD
}

export interface StatsDetailData {
  // Summary
  totalSessions: number;
  totalDurationMs: number;
  avgDurationMs: number;
  medianDurationMs: number;
  completionRate: number;        // 0–100 percent
  longestSessionMs: number;
  longestSessionProject: string;

  // Punch card: hour (0-23) × weekday (0-6), all sessions
  punchCard: PunchCardCell[];    // 24 × 7 = 168 cells

  // Duration histogram
  durationHistogram: DurationBucket[];

  // Weekly trend: last 12 weeks
  weeklyTrend: WeekPoint[];

  // Per-project
  projects: ProjectDetail[];

  // All unique project names (sorted by total sessions desc)
  projectNames: string[];

  // Time range
  oldestSession: string;   // ISO
  newestSession: string;   // ISO
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mondayOf(date: Date): string {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

function median(sortedArr: number[]): number {
  if (sortedArr.length === 0) return 0;
  const mid = Math.floor(sortedArr.length / 2);
  return sortedArr.length % 2 !== 0
    ? sortedArr[mid]
    : (sortedArr[mid - 1] + sortedArr[mid]) / 2;
}

const DURATION_BUCKETS: Array<{ label: string; minMs: number; maxMs: number }> = [
  { label: '< 1m',   minMs: 0,        maxMs: 60_000 },
  { label: '1–5m',   minMs: 60_000,   maxMs: 300_000 },
  { label: '5–15m',  minMs: 300_000,  maxMs: 900_000 },
  { label: '15–30m', minMs: 900_000,  maxMs: 1_800_000 },
  { label: '30–60m', minMs: 1_800_000,maxMs: 3_600_000 },
  { label: '1–2h',   minMs: 3_600_000,maxMs: 7_200_000 },
  { label: '2–4h',   minMs: 7_200_000,maxMs: 14_400_000 },
  { label: '4h+',    minMs: 14_400_000,maxMs: Infinity },
];

// ─── Route handler ─────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const projectFilter = searchParams.get('project') || ''; // '' = all

    if (!existsSync(LOG_PATH)) {
      return Response.json(emptyResponse(), { headers: { 'Cache-Control': 'no-store' } });
    }

    const content = readFileSync(LOG_PATH, 'utf-8').replace(/\r\n/g, '\n');
    const lines = content.trim().split('\n').filter((l) => l);
    const allSessions = parseLogLines(lines);

    // Apply optional project filter
    const sessions = projectFilter
      ? allSessions.filter((s) => s.project === projectFilter)
      : allSessions;

    if (sessions.length === 0) {
      const result = emptyResponse();
      result.projectNames = [...new Set(allSessions.map((s) => s.project))]
        .sort((a, b) => {
          const ca = allSessions.filter((s) => s.project === a).length;
          const cb = allSessions.filter((s) => s.project === b).length;
          return cb - ca;
        });
      return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
    }

    // ── Global aggregates ──────────────────────────────────────────────────────

    const durations = sessions
      .filter((s) => s.durationMs !== undefined && s.durationMs > 0)
      .map((s) => s.durationMs as number)
      .sort((a, b) => a - b);

    const totalDurationMs = durations.reduce((s, d) => s + d, 0);
    const avgDurationMs = durations.length > 0 ? totalDurationMs / durations.length : 0;
    const medianDurationMs = median(durations);

    const completed = sessions.filter((s) => s.status === 'completed').length;
    const completionRate = sessions.length > 0 ? Math.round((completed / sessions.length) * 100) : 0;

    const longestSession = sessions.reduce<{ ms: number; project: string }>(
      (best, s) => (s.durationMs ?? 0) > best.ms
        ? { ms: s.durationMs!, project: s.project }
        : best,
      { ms: 0, project: '' }
    );

    // ── Punch card ─────────────────────────────────────────────────────────────

    const punchGrid: Record<string, number> = {};
    for (let h = 0; h < 24; h++) {
      for (let d = 0; d < 7; d++) {
        punchGrid[`${h}_${d}`] = 0;
      }
    }
    for (const s of sessions) {
      const ts = s.startTime;
      const hour = parseInt((ts.split(' ')[1] || '0:').split(':')[0], 10);
      const dow = new Date(ts.substring(0, 10) + 'T12:00:00').getDay();
      if (hour >= 0 && hour < 24 && dow >= 0 && dow < 7) {
        punchGrid[`${hour}_${dow}`]++;
      }
    }
    const punchCard: PunchCardCell[] = [];
    for (let h = 0; h < 24; h++) {
      for (let d = 0; d < 7; d++) {
        punchCard.push({ hour: h, dow: d, count: punchGrid[`${h}_${d}`] });
      }
    }

    // ── Duration histogram ─────────────────────────────────────────────────────

    const durationHistogram: DurationBucket[] = DURATION_BUCKETS.map((b) => ({
      ...b,
      count: sessions.filter(
        (s) => s.durationMs !== undefined
          && s.durationMs >= b.minMs
          && s.durationMs < b.maxMs
      ).length,
    }));

    // ── Weekly trend (last 16 weeks) ───────────────────────────────────────────

    const now = new Date();
    const weeksBack = 16;
    const weekMap = new Map<string, { sessions: number; totalMinutes: number; completed: number; exited: number }>();

    for (let i = weeksBack - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i * 7);
      weekMap.set(mondayOf(d), { sessions: 0, totalMinutes: 0, completed: 0, exited: 0 });
    }

    for (const s of sessions) {
      const startDate = new Date(s.startTime.substring(0, 10) + 'T12:00:00');
      const wk = mondayOf(startDate);
      const entry = weekMap.get(wk);
      if (!entry) continue;
      entry.sessions++;
      entry.totalMinutes += Math.round((s.durationMs ?? 0) / 60000);
      if (s.status === 'completed') entry.completed++;
      if (s.status === 'exited') entry.exited++;
    }

    const weeklyTrend: WeekPoint[] = Array.from(weekMap.entries()).map(([weekStart, v]) => ({
      weekStart,
      ...v,
    }));

    // ── Per-project breakdown ──────────────────────────────────────────────────

    const projectMap = new Map<string, typeof sessions>();
    for (const s of allSessions) {
      if (!projectMap.has(s.project)) projectMap.set(s.project, []);
      projectMap.get(s.project)!.push(s);
    }

    const projectDetails: ProjectDetail[] = [];
    for (const [project, pSessions] of projectMap.entries()) {
      const pDurations = pSessions
        .filter((s) => s.durationMs !== undefined && s.durationMs > 0)
        .map((s) => s.durationMs as number)
        .sort((a, b) => a - b);

      const pTotalMs = pDurations.reduce((acc, d) => acc + d, 0);
      const pCompleted = pSessions.filter((s) => s.status === 'completed').length;
      const pExited = pSessions.filter((s) => s.status === 'exited').length;
      const pDismissed = pSessions.filter((s) => s.status === 'dismissed').length;

      const pHourly = new Array<number>(24).fill(0);
      const pDow = new Array<number>(7).fill(0);
      let pLastSession = '';

      for (const s of pSessions) {
        const ts = s.startTime;
        const h = parseInt((ts.split(' ')[1] || '0:').split(':')[0], 10);
        const d = new Date(ts.substring(0, 10) + 'T12:00:00').getDay();
        if (h >= 0 && h < 24) pHourly[h]++;
        if (d >= 0 && d < 7) pDow[d]++;
        if (ts > pLastSession) pLastSession = ts;
      }

      const mostActiveHour = pHourly.indexOf(Math.max(...pHourly));
      const mostActiveDow = pDow.indexOf(Math.max(...pDow));

      const longestMs = pDurations.length > 0 ? pDurations[pDurations.length - 1] : 0;

      projectDetails.push({
        project,
        totalSessions: pSessions.length,
        completed: pCompleted,
        exited: pExited,
        dismissed: pDismissed,
        totalDurationMs: pTotalMs,
        avgDurationMs: pDurations.length > 0 ? pTotalMs / pDurations.length : 0,
        medianDurationMs: median(pDurations),
        successRate: pSessions.length > 0 ? Math.round((pCompleted / pSessions.length) * 100) : 0,
        mostActiveHour,
        mostActiveDow,
        hourly: pHourly,
        dow: pDow,
        longestSessionMs: longestMs,
        lastSessionDate: pLastSession.substring(0, 10),
      });
    }

    projectDetails.sort((a, b) => b.totalSessions - a.totalSessions);

    // ── Time range ─────────────────────────────────────────────────────────────

    const startTimes = sessions.map((s) => parseTimestamp(s.startTime)).filter((t) => t > 0);
    const oldestMs = Math.min(...startTimes);
    const newestMs = Math.max(...startTimes);

    const result: StatsDetailData = {
      totalSessions: sessions.length,
      totalDurationMs,
      avgDurationMs,
      medianDurationMs,
      completionRate,
      longestSessionMs: longestSession.ms,
      longestSessionProject: longestSession.project,
      punchCard,
      durationHistogram,
      weeklyTrend,
      projects: projectDetails,
      projectNames: projectDetails.map((p) => p.project),
      oldestSession: oldestMs > 0 ? new Date(oldestMs).toISOString() : '',
      newestSession: newestMs > 0 ? new Date(newestMs).toISOString() : '',
    };

    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('Error computing stats detail:', err);
    return Response.json({ error: 'Failed to compute stats' }, { status: 500 });
  }
}

function emptyResponse(): StatsDetailData {
  const punchCard: PunchCardCell[] = [];
  for (let h = 0; h < 24; h++) {
    for (let d = 0; d < 7; d++) {
      punchCard.push({ hour: h, dow: d, count: 0 });
    }
  }
  return {
    totalSessions: 0,
    totalDurationMs: 0,
    avgDurationMs: 0,
    medianDurationMs: 0,
    completionRate: 0,
    longestSessionMs: 0,
    longestSessionProject: '',
    punchCard,
    durationHistogram: DURATION_BUCKETS.map((b) => ({ ...b, count: 0 })),
    weeklyTrend: [],
    projects: [],
    projectNames: [],
    oldestSession: '',
    newestSession: '',
  };
}
