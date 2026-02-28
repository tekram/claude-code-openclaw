import { readFileSync, existsSync } from 'fs';
import { LOG_PATH, parseLogLines } from '@/lib/sessions/parse';

export interface HeatmapDay {
  date: string;         // YYYY-MM-DD
  count: number;
  totalMinutes: number;
  projects: string[];
}

export interface HeatmapData {
  days: HeatmapDay[];            // 365 days, oldest → newest
  maxCount: number;
  hourlyDistribution: number[];  // 24 values, index = hour of day (0–23)
  dayOfWeekCounts: number[];     // 7 values, index = day of week (0=Sun)
  streakCurrent: number;         // consecutive days with ≥1 session ending at today
  streakLongest: number;
  mostActiveHour: number;        // 0–23
  mostActiveDayOfWeek: number;   // 0=Sun
  totalSessions: number;
  totalDurationMs: number;
}

function dateKey(timestamp: string): string {
  // timestamp: "2026-02-27 16:30:00" — take the date portion directly (local time)
  return timestamp.substring(0, 10);
}

function hourOf(timestamp: string): number {
  const timePart = (timestamp.split(' ')[1] || '00:00:00');
  return parseInt(timePart.split(':')[0] || '0', 10);
}

export async function GET() {
  try {
    // Build a map of the last 365 days (today inclusive)
    const today = new Date();
    const dateMap = new Map<string, { count: number; totalMs: number; projects: Set<string> }>();

    for (let i = 0; i < 365; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      // Use local YYYY-MM-DD
      const key = [
        d.getFullYear(),
        String(d.getMonth() + 1).padStart(2, '0'),
        String(d.getDate()).padStart(2, '0'),
      ].join('-');
      dateMap.set(key, { count: 0, totalMs: 0, projects: new Set() });
    }

    const hourly = new Array(24).fill(0) as number[];
    const dow = new Array(7).fill(0) as number[];
    let totalDurationMs = 0;

    if (existsSync(LOG_PATH)) {
      const content = readFileSync(LOG_PATH, 'utf-8').replace(/\r\n/g, '\n');
      const lines = content.trim().split('\n').filter((l) => l);
      const sessions = parseLogLines(lines);

      for (const session of sessions) {
        const dk = dateKey(session.startTime);
        const entry = dateMap.get(dk);

        if (entry) {
          entry.count++;
          entry.projects.add(session.project);
          if (session.durationMs) {
            entry.totalMs += session.durationMs;
          }
        }

        const hour = hourOf(session.startTime);
        if (hour >= 0 && hour < 24) hourly[hour]++;

        // Parse day-of-week from the date string (local time)
        const parsedDate = new Date(dk + 'T12:00:00'); // noon to avoid DST edge
        dow[parsedDate.getDay()]++;

        totalDurationMs += session.durationMs || 0;
      }
    }

    // Build sorted days array (oldest → newest)
    const days: HeatmapDay[] = Array.from(dateMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, d]) => ({
        date,
        count: d.count,
        totalMinutes: Math.round(d.totalMs / 60000),
        projects: Array.from(d.projects),
      }));

    // Streak: go backwards from today (last element), count consecutive days with count > 0
    const reversed = [...days].reverse();
    let streakCurrent = 0;
    let streakLongest = 0;
    let streakRun = 0;
    let inCurrent = true;

    for (const day of reversed) {
      if (day.count > 0) {
        streakRun++;
        if (inCurrent) streakCurrent++;
      } else {
        if (inCurrent) inCurrent = false;
        streakLongest = Math.max(streakLongest, streakRun);
        streakRun = 0;
      }
    }
    streakLongest = Math.max(streakLongest, streakRun);

    const maxCount = Math.max(1, ...days.map((d) => d.count));
    const mostActiveHour = hourly.indexOf(Math.max(...hourly));
    const mostActiveDayOfWeek = dow.indexOf(Math.max(...dow));
    const totalSessions = days.reduce((s, d) => s + d.count, 0);

    const result: HeatmapData = {
      days,
      maxCount,
      hourlyDistribution: hourly,
      dayOfWeekCounts: dow,
      streakCurrent,
      streakLongest,
      mostActiveHour,
      mostActiveDayOfWeek,
      totalSessions,
      totalDurationMs,
    };

    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Error building heatmap data:', error);
    return Response.json({ error: 'Failed to build heatmap data' }, { status: 500 });
  }
}
