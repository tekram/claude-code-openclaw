import { readFileSync, existsSync } from 'fs';
import path from 'path';
import type { Session, SessionsData, InterruptReason } from '@/types/sessions';

export const LOG_PATH = process.env.CLAUDE_DASH_LOG_PATH || path.join(
  process.env.HOME || process.env.USERPROFILE || '',
  '.openclaw',
  'workspace',
  'sessions.log'
);

export const SESSION_OWNER_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || '',
  '.openclaw', 'workspace', '.session-owners'
);

const STALE_THRESHOLD_MS = 4 * 60 * 60 * 1000; // 4 hours — active sessions
const PAUSED_STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 min — paused sessions (hook missed exit)
const HIDE_OLD_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours
const PERMISSION_PAUSE_GRACE_MS = 10_000; // 10s grace for auto-approved tool permissions
const ACTIVITY_STALE_MS = 5 * 60 * 1000; // 5 min — ignore activity files older than this
const WORKING_THRESHOLD_MS = 30_000; // 30s — Claude is "working" if tool activity within this window

export function parseTimestamp(ts: string): number {
  // Timestamps like "2026-02-22 16:47:01" — parse as local time
  const d = new Date(ts.replace(' ', 'T'));
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

export function calculateDuration(startTime: string, endTime?: string): number | undefined {
  if (!endTime) return undefined;
  const start = parseTimestamp(startTime);
  const end = parseTimestamp(endTime);
  return start && end ? end - start : undefined;
}

export function inferInterruptReason(details?: string): InterruptReason {
  if (!details) return 'unknown';
  const lowerDetails = details.toLowerCase();
  if (lowerDetails.includes('superseded')) return 'superseded';
  if (lowerDetails.includes('timeout') || lowerDetails.includes('no activity')) return 'timeout';
  if (lowerDetails.includes('crash')) return 'crash';
  if (lowerDetails.includes('dismissed')) return 'dismissed';
  if (details !== 'interrupted') return 'manual';
  return 'unknown';
}

export function formatDuration(durationMs: number): string {
  const hours = Math.floor(durationMs / (60 * 60 * 1000));
  const minutes = Math.floor((durationMs % (60 * 60 * 1000)) / (60 * 1000));
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function readLatestActivity(project: string): { activity: string; isWorking: boolean } | null {
  try {
    const activityPath = path.join(SESSION_OWNER_DIR, `${project}.activity`);
    if (!existsSync(activityPath)) return null;
    const data = JSON.parse(readFileSync(activityPath, 'utf-8'));
    const age = Date.now() - (data.ts || 0);
    if (!data.ts || age > ACTIVITY_STALE_MS) return null;
    return {
      activity: data.activity || '',
      // isRunning=true means a long-running command is in flight (set by PreToolUse hook,
      // cleared when PostToolUse fires). Override the 30s threshold so Working badge stays up.
      isWorking: !!data.isRunning || age < WORKING_THRESHOLD_MS,
    };
  } catch {
    return null;
  }
}

/**
 * Parse log lines into a flat array of sessions (raw, no enrichment).
 * Used by stats and export routes which need all historical sessions.
 */
export function parseLogLines(lines: string[]): Session[] {
  const allSessions: Session[] = [];
  // Keyed by the full projectKey from the log (e.g. "agentic-trading#abc123" or bare "agentic-trading").
  // This allows concurrent sessions for the same project to be tracked independently when
  // the hook embeds a session ID suffix. Old logs without a suffix work as before.
  const openByProject: Record<string, number> = {};

  for (const line of lines) {
    const match = line.match(/\[([^\]]+)\]\s+(START|PAUSED|RESUMED|DONE|EXIT|DISMISSED|HEARTBEAT|NOTE)\s+(\S+)\s*(.*)/);
    if (!match) continue;

    const [, timestamp, action, projectKey, details] = match;
    // Strip optional "#suffix" to get the display name
    const hashIdx = projectKey.indexOf('#');
    const projectName = hashIdx >= 0 ? projectKey.substring(0, hashIdx) : projectKey;

    if (action === 'START') {
      // Close any previous open session for the exact same key (same session restarted, or
      // old-format unsuffixed log where we can't tell sessions apart).
      if (openByProject[projectKey] !== undefined) {
        const prev = allSessions[openByProject[projectKey]];
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
        sessionSuffix: hashIdx >= 0 ? projectKey.substring(hashIdx + 1) : undefined,
      });
      openByProject[projectKey] = idx;
      continue;
    }

    // PAUSED, RESUMED, DONE, EXIT, DISMISSED, HEARTBEAT, NOTE — apply to the open session
    let openIdx = openByProject[projectKey];

    // For DISMISSED/DONE/NOTE: if no open session, find the most recent closed one by bare name
    if (openIdx === undefined && (action === 'DISMISSED' || action === 'DONE' || action === 'NOTE')) {
      for (let j = allSessions.length - 1; j >= 0; j--) {
        if (allSessions[j].project === projectName) {
          openIdx = j;
          break;
        }
      }
    }

    // For RESUMED after a DISMISSED (or other close): the session may have been removed from
    // openByProject but the process is still running. Re-attach to the most recent session.
    if (openIdx === undefined && action === 'RESUMED') {
      for (let j = allSessions.length - 1; j >= 0; j--) {
        if (allSessions[j].project === projectName) {
          openIdx = j;
          openByProject[projectKey] = j;
          if (projectKey !== projectName) openByProject[projectName] = j;
          break;
        }
      }
    }

    // For live events (PAUSED/RESUMED/HEARTBEAT/EXIT) with a suffix: if no suffixed session
    // exists, fall back to an open unsuffixed session for the same project. This handles the
    // case where a session started before the hook began embedding session-ID suffixes, or
    // where the SessionStart hook failed to fire.
    if (openIdx === undefined && hashIdx >= 0) {
      // First try the still-open unsuffixed session.
      let fallbackIdx = openByProject[projectName];
      // If not open, find the most recent session by bare name (handles post-dismiss continue).
      if (fallbackIdx === undefined) {
        for (let j = allSessions.length - 1; j >= 0; j--) {
          if (allSessions[j].project === projectName) {
            fallbackIdx = j;
            break;
          }
        }
      }
      if (fallbackIdx !== undefined) {
        openIdx = fallbackIdx;
        openByProject[projectKey] = fallbackIdx;
        openByProject[projectName] = fallbackIdx;
        if (!allSessions[fallbackIdx].sessionSuffix) {
          allSessions[fallbackIdx].sessionSuffix = projectKey.substring(hashIdx + 1);
        }
      }
    }

    if (openIdx === undefined) continue;
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
        delete openByProject[projectKey];
        break;
      case 'EXIT':
        session.status = 'exited';
        session.endTime = timestamp;
        session.interruptReason = inferInterruptReason(details || 'interrupted');
        if (!session.details || session.details.startsWith('Permission needed:') || session.details === 'waiting for input') {
          session.details = details || 'interrupted';
        }
        session.durationMs = calculateDuration(session.startTime, session.endTime);
        delete openByProject[projectKey];
        break;
      case 'DISMISSED':
        session.status = 'dismissed';
        session.dismissedAt = timestamp;
        session.details = details || session.details;
        session.interruptReason = 'dismissed';
        delete openByProject[projectKey];
        break;
      case 'HEARTBEAT':
        if (details) {
          session.details = details;
        } else if (session.details?.startsWith('Permission needed:') || session.details === 'waiting for input') {
          session.details = '';
        }
        break;
      case 'NOTE':
        if (details) {
          if (!session.notes) session.notes = [];
          session.notes.push(details);
        }
        break;
    }
  }

  return allSessions;
}

/**
 * Full pipeline: read log, parse, apply enrichments (grace period, owner-file override,
 * stale detection, activity overlay), bin into categories, sort, and return SessionsData.
 * Used by the main sessions route and the SSE stream.
 */
export function parseSessions(): SessionsData {
  if (!existsSync(LOG_PATH)) {
    return { active: [], paused: [], completed: [], exited: [], dismissed: [], lastUpdated: new Date().toISOString() };
  }

  const logContent = readFileSync(LOG_PATH, 'utf-8').replace(/\r\n/g, '\n');
  const lines = logContent.trim().split('\n').filter((l) => l);
  const allSessions = parseLogLines(lines);

  const now = Date.now();

  // Owner-file deduplication: if an active/paused session's session suffix doesn't match
  // the current owner file, a newer session has claimed the project and this one is stale.
  // This catches crashes/kills where SessionEnd never fired (no EXIT in the log).
  for (const session of allSessions) {
    if ((session.status === 'active' || session.status === 'paused') && session.sessionSuffix) {
      try {
        const ownerPath = path.join(SESSION_OWNER_DIR, `${session.project}.json`);
        if (existsSync(ownerPath)) {
          const owner = JSON.parse(readFileSync(ownerPath, 'utf-8'));
          if (owner.sessionId) {
            const ownerSuffix = (owner.sessionId as string).replace(/[^a-zA-Z0-9]/g, '').substring(0, 6);
            if (ownerSuffix !== session.sessionSuffix) {
              session.status = 'exited';
              session.endTime = session.lastActivityTime || session.startTime;
              session.interruptReason = 'superseded';
              session.durationMs = calculateDuration(session.startTime, session.endTime);
              session.details = 'superseded by new session';
            }
          }
        }
      } catch { /* ignore */ }
    }
  }

  // Grace period: if a session was PAUSED very recently with a "Permission needed:" reason,
  // treat it as still active. Auto-approved tools fire PreToolUse→PostToolUse in <1s,
  // but real permission prompts take 10+ seconds.
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

  // 24-hour cutoff for old sessions
  const cutoff = now - HIDE_OLD_THRESHOLD_MS;

  // Overlay latest tool activity for active sessions.
  // When multiple active sessions share a project, only apply the activity to the
  // most recently active one — the .activity file is project-wide, not per-session.
  const mostRecentActiveByProject: Record<string, Session> = {};
  for (const session of allSessions) {
    if (session.status === 'active') {
      const prev = mostRecentActiveByProject[session.project];
      const sessionTs = parseTimestamp(session.lastActivityTime || session.startTime);
      const prevTs = prev ? parseTimestamp(prev.lastActivityTime || prev.startTime) : 0;
      if (!prev || sessionTs > prevTs) {
        mostRecentActiveByProject[session.project] = session;
      }
    }
  }
  for (const session of Object.values(mostRecentActiveByProject)) {
    const activity = readLatestActivity(session.project);
    if (activity) {
      session.details = activity.activity;
      session.isWorking = activity.isWorking;
    }
  }

  const active = allSessions.filter((s) => s.status === 'active');
  const paused = allSessions.filter((s) => s.status === 'paused');

  // Assign a 1-based instanceIndex to sessions that share a project name with other
  // live sessions (active or paused). Only set when there are actually duplicates —
  // so single sessions never show any badge.
  const liveSessions = [...active, ...paused];
  const projectCounts: Record<string, number> = {};
  for (const s of liveSessions) projectCounts[s.project] = (projectCounts[s.project] || 0) + 1;
  const projectCounters: Record<string, number> = {};
  for (const s of liveSessions) {
    if (projectCounts[s.project] > 1) {
      projectCounters[s.project] = (projectCounters[s.project] || 0) + 1;
      s.instanceIndex = projectCounters[s.project];
    }
  }

  const completed = allSessions.filter((s) =>
    (s.status === 'completed' ||
     (s.status === 'exited' && s.interruptReason === 'manual') ||
     (s.status === 'exited' && s.interruptReason === 'superseded'))
    && parseTimestamp(s.endTime || s.startTime) > cutoff
  );

  const exited = allSessions.filter((s) =>
    s.status === 'exited'
    && s.interruptReason !== 'manual'
    && s.interruptReason !== 'superseded'
    && parseTimestamp(s.endTime || s.startTime) > cutoff
  );

  const dismissed = allSessions.filter((s) =>
    s.status === 'dismissed' && parseTimestamp(s.dismissedAt || s.startTime) > cutoff
  );

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

  return { active, paused, completed, exited, dismissed, lastUpdated: new Date().toISOString() };
}
