import { readFileSync, existsSync } from 'fs';
import { LOG_PATH, parseLogLines } from '@/lib/sessions/parse';
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

export async function GET() {
  try {
    if (!existsSync(LOG_PATH)) {
      return Response.json({
        totalSessions: 0,
        byStatus: { active: 0, paused: 0, completed: 0, exited: 0, dismissed: 0 },
        byProject: {},
        interruptionReasons: {
          manual: 0,
          crash: 0,
          superseded: 0,
          timeout: 0,
          dismissed: 0,
          unknown: 0,
        },
        totalDurationMs: 0,
      } as SessionStats);
    }

    const logContent = readFileSync(LOG_PATH, 'utf-8').replace(/\r\n/g, '\n');
    const lines = logContent.trim().split('\n').filter((l) => l);
    const allSessions = parseLogLines(lines);

    // Calculate statistics
    const stats: SessionStats = {
      totalSessions: allSessions.length,
      byStatus: {
        active: 0,
        paused: 0,
        completed: 0,
        exited: 0,
        dismissed: 0,
      },
      byProject: {},
      interruptionReasons: {
        manual: 0,
        crash: 0,
        superseded: 0,
        timeout: 0,
        dismissed: 0,
        unknown: 0,
      },
      totalDurationMs: 0,
    };

    const durations: number[] = [];

    for (const session of allSessions) {
      // Count by status
      stats.byStatus[session.status]++;

      // Count by project
      if (!stats.byProject[session.project]) {
        stats.byProject[session.project] = {
          total: 0,
          completed: 0,
          interrupted: 0,
        };
      }
      stats.byProject[session.project].total++;

      if (session.status === 'completed') {
        stats.byProject[session.project].completed++;
      } else if (session.status === 'exited') {
        stats.byProject[session.project].interrupted++;
      }

      // Track durations
      if (session.durationMs) {
        durations.push(session.durationMs);
        stats.totalDurationMs += session.durationMs;

        if (!stats.byProject[session.project].avgDurationMs) {
          stats.byProject[session.project].avgDurationMs = 0;
        }
      }

      // Count interruption reasons
      if (session.interruptReason) {
        stats.interruptionReasons[session.interruptReason]++;
      }
    }

    // Calculate average duration
    if (durations.length > 0) {
      stats.avgDurationMs = stats.totalDurationMs / durations.length;
    }

    // Calculate per-project average durations
    for (const project in stats.byProject) {
      const projectSessions = allSessions.filter((s) => s.project === project && s.durationMs);
      if (projectSessions.length > 0) {
        const totalMs = projectSessions.reduce((sum, s) => sum + (s.durationMs || 0), 0);
        stats.byProject[project].avgDurationMs = totalMs / projectSessions.length;
      }
    }

    return Response.json(stats, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Error calculating session stats:', error);
    return Response.json({ error: 'Failed to calculate stats' }, { status: 500 });
  }
}
