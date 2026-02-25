import { readFileSync, appendFileSync } from 'fs';
import { existsSync } from 'fs';
import path from 'path';
import type { Session, SessionsData, InterruptReason } from '@/types/sessions';

const LOG_PATH = process.env.CLAUDE_DASH_LOG_PATH || path.join(
  process.env.HOME || process.env.USERPROFILE || '',
  ".openclaw",
  "workspace",
  "sessions.log"
);

const STALE_THRESHOLD_MS = 4 * 60 * 60 * 1000; // 4 hours — active sessions
const PAUSED_STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 min — paused sessions (hook missed exit)
const HIDE_OLD_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours
const PERMISSION_PAUSE_GRACE_MS = 10_000; // 10s grace for auto-approved tool permissions
const ACTIVITY_STALE_MS = 5 * 60 * 1000; // 5 min — ignore activity files older than this
const WORKING_THRESHOLD_MS = 30_000; // 30s — Claude is "working" if tool activity within this window

const SESSION_OWNER_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || '',
  '.openclaw', 'workspace', '.session-owners'
);

function readLatestActivity(project: string): { activity: string; isWorking: boolean } | null {
  try {
    const activityPath = path.join(SESSION_OWNER_DIR, `${project}.activity`);
    if (!existsSync(activityPath)) return null;
    const data = JSON.parse(readFileSync(activityPath, 'utf-8'));
    const age = Date.now() - (data.ts || 0);
    if (!data.ts || age > ACTIVITY_STALE_MS) return null;
    return {
      activity: data.activity || '',
      isWorking: age < WORKING_THRESHOLD_MS,
    };
  } catch {
    return null;
  }
}

function parseTimestamp(ts: string): number {
  // Timestamps like "2026-02-22 16:47:01" — parse as local time
  const d = new Date(ts.replace(' ', 'T'));
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

function calculateDuration(startTime: string, endTime?: string): number | undefined {
  if (!endTime) return undefined;
  const start = parseTimestamp(startTime);
  const end = parseTimestamp(endTime);
  return start && end ? end - start : undefined;
}

function inferInterruptReason(details?: string): InterruptReason {
  if (!details) return 'unknown';
  const lowerDetails = details.toLowerCase();
  if (lowerDetails.includes('superseded')) return 'superseded';
  if (lowerDetails.includes('timeout') || lowerDetails.includes('no activity')) return 'timeout';
  if (lowerDetails.includes('crash')) return 'crash';
  if (lowerDetails.includes('dismissed')) return 'dismissed';
  if (details !== 'interrupted') return 'manual';
  return 'unknown';
}

function formatDuration(durationMs: number): string {
  const hours = Math.floor(durationMs / (60 * 60 * 1000));
  const minutes = Math.floor((durationMs % (60 * 60 * 1000)) / (60 * 1000));
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export async function GET() {
  try {
    const logPath = LOG_PATH;

    if (!existsSync(logPath)) {
      return Response.json(
        { active: [], paused: [], completed: [], exited: [], lastUpdated: new Date().toISOString() } as SessionsData,
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const logContent = readFileSync(logPath, 'utf-8').replace(/\r\n/g, '\n');
    const lines = logContent.trim().split('\n').filter((l) => l);

    // Track each START as a separate session instance.
    // PAUSED/RESUMED/DONE/EXIT apply to the most recent open session for that project.
    const allSessions: Session[] = [];
    // Map project -> index into allSessions for the latest open (active/paused) session
    const openByProject: Record<string, number> = {};

    for (const line of lines) {
      const match = line.match(/\[([^\]]+)\]\s+(START|PAUSED|RESUMED|DONE|EXIT|DISMISSED|HEARTBEAT|NOTE)\s+(\S+)\s*(.*)/);
      if (!match) continue;

      const [, timestamp, action, projectName, details] = match;

      if (action === 'START') {
        // Close any previous open session for this project (it was orphaned)
        if (openByProject[projectName] !== undefined) {
          const prev = allSessions[openByProject[projectName]];
          if (prev.status === 'active' || prev.status === 'paused') {
            prev.status = 'exited';
            prev.endTime = timestamp;
            prev.details = 'superseded by new session';
            prev.interruptReason = 'superseded';
            prev.durationMs = calculateDuration(prev.startTime, prev.endTime);
          }
        }
        const idx = allSessions.length;
        allSessions.push({
          project: projectName,
          status: 'active',
          startTime: timestamp,
          lastActivityTime: timestamp,
          details: details || '',
        });
        openByProject[projectName] = idx;
        continue;
      }

      // PAUSED, RESUMED, DONE, EXIT, DISMISSED — apply to the open session for this project
      let openIdx = openByProject[projectName];

      // For DISMISSED/DONE/NOTE: if no open session, find the most recent closed one
      // (these actions come from the UI after a session has already exited)
      if (openIdx === undefined && (action === 'DISMISSED' || action === 'DONE' || action === 'NOTE')) {
        for (let j = allSessions.length - 1; j >= 0; j--) {
          if (allSessions[j].project === projectName) {
            openIdx = j;
            break;
          }
        }
      }

      if (openIdx === undefined) continue; // no session to apply to
      const session = allSessions[openIdx];
      session.lastActivityTime = timestamp;

      switch (action) {
        case 'PAUSED':
          session.status = 'paused';
          session.details = details || 'waiting for input';
          break;
        case 'RESUMED':
          session.status = 'active';
          if (details) {
            session.details = details;
          } else if (session.details?.startsWith('Permission needed:') || session.details === 'waiting for input') {
            session.details = '';
          }
          break;
        case 'DONE':
          session.status = 'completed';
          session.endTime = timestamp;
          session.details = details || '';
          session.durationMs = calculateDuration(session.startTime, session.endTime);
          delete openByProject[projectName];
          break;
        case 'EXIT':
          session.status = 'exited';
          session.endTime = timestamp;
          // Keep previous session context as details — the exit reason is shown via the badge
          session.interruptReason = inferInterruptReason(details || 'interrupted');
          if (!session.details || session.details.startsWith('Permission needed:') || session.details === 'waiting for input') {
            session.details = details || 'interrupted';
          }
          session.durationMs = calculateDuration(session.startTime, session.endTime);
          delete openByProject[projectName];
          break;
        case 'DISMISSED':
          session.status = 'dismissed';
          session.dismissedAt = timestamp;
          session.details = details || session.details;
          session.interruptReason = 'dismissed';
          delete openByProject[projectName];
          break;
        case 'HEARTBEAT':
          // Update lastActivityTime (already set above) and details if provided
          if (details) {
            session.details = details;
          } else if (session.details?.startsWith('Permission needed:') || session.details === 'waiting for input') {
            session.details = '';
          }
          break;
        case 'NOTE':
          // Append note to session's notes array (doesn't change status)
          if (details) {
            if (!session.notes) session.notes = [];
            session.notes.push(details);
          }
          break;
      }
    }

    // Grace period: if a session was PAUSED very recently with a "Permission needed:" reason,
    // treat it as still active. Auto-approved tools fire PreToolUse→PostToolUse in <1s,
    // but real permission prompts take 10+ seconds. This prevents false "Needs Input" in the UI.
    const now = Date.now();
    for (const session of allSessions) {
      if (session.status === 'paused' && session.details?.startsWith('Permission needed:')) {
        const pausedAt = parseTimestamp(session.lastActivityTime || session.startTime);
        if (pausedAt > 0 && (now - pausedAt) < PERMISSION_PAUSE_GRACE_MS) {
          session.status = 'active';
        }
      }
    }

    // Owner-file override: if the log says "paused" but the hook's owner file says "active",
    // the PostToolUse ran and updated the owner file but failed to log RESUMED (race/crash).
    // Trust the owner file in this case.
    for (const session of allSessions) {
      if (session.status === 'paused') {
        try {
          const ownerPath = path.join(SESSION_OWNER_DIR, `${session.project}.json`);
          if (existsSync(ownerPath)) {
            const owner = JSON.parse(readFileSync(ownerPath, 'utf-8'));
            const pausedAt = parseTimestamp(session.lastActivityTime || session.startTime);
            if (owner.status === 'active' && owner.ts > pausedAt) {
              session.status = 'active';
              if (session.details?.startsWith('Permission needed:') || session.details === 'waiting for input') {
                session.details = '';
              }
            }
          }
        } catch { /* ignore */ }
      }
    }

    // Auto-convert stale sessions → exited with timeout
    // Paused sessions use a shorter threshold (30 min) since a hook-missed-exit leaves them stuck
    for (const session of allSessions) {
      if (session.status === 'active' || session.status === 'paused') {
        const lastMs = parseTimestamp(session.lastActivityTime || session.startTime);
        const inactiveMs = now - lastMs;
        const threshold = session.status === 'paused' ? PAUSED_STALE_THRESHOLD_MS : STALE_THRESHOLD_MS;

        if (lastMs > 0 && inactiveMs > threshold) {
          session.status = 'exited';
          session.endTime = session.lastActivityTime || session.startTime;
          session.interruptReason = 'timeout';
          session.durationMs = calculateDuration(session.startTime, session.endTime);
          const prevDetails = session.details ? `${session.details} - ` : '';
          session.details = `${prevDetails}No activity for ${formatDuration(inactiveMs)}`;
        }
      }
    }

    // Hide interrupted/completed sessions older than 24 hours
    const cutoff = now - HIDE_OLD_THRESHOLD_MS;

    // Overlay latest tool activity for active sessions (from lightweight state files)
    for (const session of allSessions) {
      if (session.status === 'active') {
        const activity = readLatestActivity(session.project);
        if (activity) {
          session.details = activity.activity;
          session.isWorking = activity.isWorking;
        }
      }
    }

    const active = allSessions.filter((s) => s.status === 'active');
    const paused = allSessions.filter((s) => s.status === 'paused');

    // Treat manual exits and superseded sessions as completed (intentional progression), not interruptions
    const completed = allSessions.filter((s) =>
      (s.status === 'completed' ||
       (s.status === 'exited' && s.interruptReason === 'manual') ||
       (s.status === 'exited' && s.interruptReason === 'superseded'))
      && parseTimestamp(s.endTime || s.startTime) > cutoff
    );

    // Only show true interruptions (crash, timeout, unknown)
    const exited = allSessions.filter((s) =>
      s.status === 'exited'
      && s.interruptReason !== 'manual'
      && s.interruptReason !== 'superseded'
      && parseTimestamp(s.endTime || s.startTime) > cutoff
    );

    const dismissed = allSessions.filter((s) => s.status === 'dismissed' && parseTimestamp(s.dismissedAt || s.startTime) > cutoff);

    const sortByTime = (a: Session, b: Session) => {
      const timeA = parseTimestamp(a.endTime || a.dismissedAt || a.startTime);
      const timeB = parseTimestamp(b.endTime || b.dismissedAt || b.startTime);
      return timeB - timeA;
    };

    active.sort(sortByTime);
    paused.sort(sortByTime);
    completed.sort(sortByTime);
    exited.sort(sortByTime);
    dismissed.sort(sortByTime);

    return Response.json(
      { active, paused, completed, exited, dismissed, lastUpdated: new Date().toISOString() } as SessionsData,
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('Error reading sessions:', error);
    return Response.json({ error: 'Failed to read sessions' }, { status: 500 });
  }
}

function logSessionAction(action: string, project: string, details?: string) {
  const logPath = LOG_PATH;

  const now = new Date();
  const timestamp = now.toLocaleString('sv-SE');
  const detailsStr = details ? ` ${details}` : '';
  const entry = `[${timestamp}] ${action} ${project}${detailsStr}\n`;

  appendFileSync(logPath, entry, 'utf-8');
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, project, details } = body;

    if (!action || !project) {
      return Response.json(
        { error: 'Missing required fields: action, project' },
        { status: 400 }
      );
    }

    switch (action) {
      case 'dismiss':
        logSessionAction('DISMISSED', project, details || 'User dismissed');
        break;

      case 'resume':
        logSessionAction('RESUMED', project, details || 'Resumed from UI');
        break;

      case 'markDone':
        logSessionAction('DONE', project, details || 'Marked complete from UI');
        break;

      case 'addNote':
        if (!details) {
          return Response.json({ error: 'Note details required' }, { status: 400 });
        }
        logSessionAction('NOTE', project, details);
        break;

      default:
        return Response.json({ error: 'Invalid action' }, { status: 400 });
    }

    return Response.json({ success: true });
  } catch (error) {
    console.error('Error handling session action:', error);
    return Response.json({ error: 'Failed to process action' }, { status: 500 });
  }
}
