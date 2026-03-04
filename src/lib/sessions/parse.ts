import { readFileSync, existsSync, readdirSync } from 'fs';
import path from 'path';
import type { Session, SessionsData, InterruptReason, PendingApproval } from '@/types/sessions';

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
const OWNER_FILE_PAUSED_STALE_MS = 10 * 60 * 1000; // 10 min — owner file stuck in paused = dead session
const PHANTOM_SESSION_THRESHOLD_MS = 5 * 60 * 1000; // 5 min — no post-start events = SessionEnd hook likely never fired
const HIDE_OLD_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours
const PERMISSION_PAUSE_GRACE_MS = 10_000; // 10s grace for auto-approved tool permissions
const ACTIVITY_STALE_MS = 5 * 60 * 1000; // 5 min — ignore activity files older than this
const WORKING_THRESHOLD_MS = 30_000; // 30s — Claude is "working" if tool activity within this window

/** Strip trailing @h=<sha> marker from a log details string, returning both parts. */
function extractHash(details: string): { cleaned: string; hash: string | null } {
  const match = details.match(/\s*@h=([a-f0-9]{40})\s*$/);
  if (!match) return { cleaned: details, hash: null };
  return { cleaned: details.substring(0, details.length - match[0].length).trim(), hash: match[1] };
}

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
 * Read all active (non-expired) pending approval requests from the session-owners dir.
 * Merges in the decision file if one exists.
 */
export function readPendingApprovals(): PendingApproval[] {
  if (!existsSync(SESSION_OWNER_DIR)) return [];
  try {
    const files = readdirSync(SESSION_OWNER_DIR);
    const approvals: PendingApproval[] = [];
    const now = Date.now();
    for (const file of files) {
      if (!file.endsWith('.pending-approval.json')) continue;
      try {
        const fullPath = path.join(SESSION_OWNER_DIR, file);
        const data: PendingApproval = JSON.parse(readFileSync(fullPath, 'utf-8'));
        if (!data.gateType) data.gateType = 'approval'; // backfill for files written before this field
        if (data.timeoutAt <= now) continue; // expired
        // Merge decision if it exists
        const project = file.replace('.pending-approval.json', '');
        const decisionPath = path.join(SESSION_OWNER_DIR, `${project}.approval-decision.json`);
        if (existsSync(decisionPath)) {
          try {
            const d = JSON.parse(readFileSync(decisionPath, 'utf-8'));
            if (d.approvalId === data.approvalId) {
              data.decision = d.decision;
              data.decidedAt = d.decidedAt;
              data.decidedBy = d.decidedBy;
              if (d.selectedLabel) data.selectedLabel = d.selectedLabel;
            }
          } catch { /* ignore */ }
        }
        approvals.push(data);
      } catch { /* ignore */ }
    }
    return approvals;
  } catch {
    return [];
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
      const { cleaned: cleanedDetails, hash: startHash } = extractHash(details || '');
      const idx = allSessions.length;
      allSessions.push({
        project: projectName,
        status: 'active',
        startTime: timestamp,
        lastActivityTime: timestamp,
        details: cleanedDetails,
        sessionSuffix: hashIdx >= 0 ? projectKey.substring(hashIdx + 1) : undefined,
        startCommitHash: startHash ?? undefined,
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
    // Only re-attach to active/paused/dismissed sessions — never to completed or exited ones,
    // as those are definitively closed and re-attaching would resurrect them spuriously.
    if (openIdx === undefined && action === 'RESUMED') {
      for (let j = allSessions.length - 1; j >= 0; j--) {
        const s = allSessions[j];
        if (s.project === projectName && (s.status === 'active' || s.status === 'paused' || s.status === 'dismissed')) {
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
    // Only fall back to active/paused/dismissed sessions — not completed or exited ones.
    if (openIdx === undefined && hashIdx >= 0) {
      // First try the still-open unsuffixed session.
      let fallbackIdx = openByProject[projectName];
      // If not open, find the most recent non-terminal session by bare name.
      if (fallbackIdx === undefined) {
        for (let j = allSessions.length - 1; j >= 0; j--) {
          const s = allSessions[j];
          if (s.project === projectName && (s.status === 'active' || s.status === 'paused' || s.status === 'dismissed')) {
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
      case 'DONE': {
        const { cleaned: doneDetails, hash: doneHash } = extractHash(details || '');
        session.status = 'completed';
        session.endTime = timestamp;
        session.details = doneDetails;
        session.durationMs = calculateDuration(session.startTime, session.endTime);
        if (doneHash) session.endCommitHash = doneHash;
        delete openByProject[projectKey];
        break;
      }
      case 'EXIT': {
        const { cleaned: exitDetails, hash: exitHash } = extractHash(details || 'interrupted');
        session.status = 'exited';
        session.endTime = timestamp;
        session.interruptReason = inferInterruptReason(exitDetails || 'interrupted');
        if (!session.details || session.details.startsWith('Permission needed:') || session.details === 'waiting for input') {
          session.details = exitDetails || 'interrupted';
        }
        session.durationMs = calculateDuration(session.startTime, session.endTime);
        if (exitHash) session.endCommitHash = exitHash;
        delete openByProject[projectKey];
        break;
      }
      case 'DISMISSED':
        session.status = 'dismissed';
        session.dismissedAt = timestamp;
        session.details = details || session.details;
        session.interruptReason = 'dismissed';
        // Clear ALL openByProject entries for this session (bare + any suffixed variants),
        // so a still-running process's subsequent PAUSED events can't re-open it.
        for (const k of Object.keys(openByProject)) {
          if (openByProject[k] === openIdx) delete openByProject[k];
        }
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
  // Also detect sessions where the owner file itself is stuck in "paused" for too long —
  // this means the process was force-killed while paused and SessionEnd never fired.
  for (const session of allSessions) {
    if (session.status === 'paused') {
      try {
        const ownerPath = path.join(SESSION_OWNER_DIR, `${session.project}.json`);
        if (existsSync(ownerPath)) {
          const owner = JSON.parse(readFileSync(ownerPath, 'utf-8'));
          const pausedAt = parseTimestamp(session.lastActivityTime || session.startTime);
          if (owner.status === 'active' && owner.ts > pausedAt) {
            // Owner file updated to active after the pause — hook missed RESUMED log
            session.status = 'active';
            if (session.details?.startsWith('Permission needed:') || session.details === 'waiting for input') {
              session.details = '';
            }
          } else if (owner.status === 'paused' && owner.ts && (now - owner.ts) > OWNER_FILE_PAUSED_STALE_MS
              && !session.details?.startsWith('Permission needed:')) {
            // Owner file has been stuck in paused for 10+ min — process was likely killed.
            // Skip for "Permission needed:" pauses — those legitimately wait hours for user approval.
            session.status = 'exited';
            session.endTime = session.lastActivityTime || session.startTime;
            session.interruptReason = 'timeout';
            session.durationMs = calculateDuration(session.startTime, session.endTime);
            const prevDetails = session.details ? `${session.details} - ` : '';
            session.details = `${prevDetails}No response (process likely killed)`;
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
      // "Permission needed:" pauses can wait hours for user approval — use the 4h active threshold.
      const isPermissionPause = session.status === 'paused' && session.details?.startsWith('Permission needed:');
      const threshold = isPermissionPause ? STALE_THRESHOLD_MS
        : session.status === 'paused' ? PAUSED_STALE_THRESHOLD_MS
        : STALE_THRESHOLD_MS;

      // Phantom sessions: started but never had any post-start events (lastActivityTime === startTime).
      // The SessionEnd hook likely never fired (process crashed or exited immediately).
      // Use a short 5-minute threshold instead of the normal 4-hour one.
      const noPostStartActivity = session.lastActivityTime === session.startTime;
      if (lastMs > 0 && noPostStartActivity && inactiveMs > PHANTOM_SESSION_THRESHOLD_MS) {
        session.status = 'exited';
        session.endTime = session.startTime;
        session.interruptReason = 'unknown';
        session.durationMs = 0;
        session.details = 'Session ended without exit log — may have been cleared or exited briefly';
      } else if (lastMs > 0 && inactiveMs > threshold) {
        session.status = 'exited';
        session.endTime = session.lastActivityTime || session.startTime;
        session.interruptReason = 'timeout';
        session.durationMs = calculateDuration(session.startTime, session.endTime);
        const prevDetails = session.details ? `${session.details} - ` : '';
        session.details = `${prevDetails}No activity for ${formatDuration(inactiveMs)}`;
      }
    }
  }

  // Orphan activity detection: recover sessions where the SessionStart hook failed to
  // write a log entry but PostToolUse is still firing (activity file is fresh).
  {
    const activeProjects = new Set(
      allSessions.filter(s => s.status === 'active' || s.status === 'paused').map(s => s.project)
    );
    try {
      const files = readdirSync(SESSION_OWNER_DIR).filter(f => f.endsWith('.activity'));
      for (const file of files) {
        const project = file.replace('.activity', '');
        if (activeProjects.has(project)) continue;
        try {
          const data = JSON.parse(readFileSync(path.join(SESSION_OWNER_DIR, file), 'utf-8'));
          const activityTs: number = data.ts || 0;
          // Orphans are only valid when PostToolUse is actively firing — use the activity
          // stale threshold (5 min). A 4-hour window would surface stale cwd-drift artifacts
          // from sessions that changed directories mid-session (now tracked via session-id map).
          if (!activityTs || now - activityTs > ACTIVITY_STALE_MS) continue;
          // Skip if a logged session exited MORE RECENTLY than this activity —
          // means the process cleanly closed after the last tool call.
          const newerExit = allSessions.find(s =>
            s.project === project &&
            s.status === 'exited' &&
            s.endTime &&
            parseTimestamp(s.endTime) > activityTs
          );
          if (newerExit) continue;
          const actTimeStr = new Date(activityTs).toISOString();
          allSessions.push({
            project,
            status: 'active',
            startTime: actTimeStr,
            lastActivityTime: actTimeStr,
            details: data.activity || 'Active',
            isWorking: now - activityTs < WORKING_THRESHOLD_MS,
          });
        } catch { /* skip corrupt activity file */ }
      }
    } catch { /* skip if dir unreadable */ }
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

  const pendingApprovals = readPendingApprovals();

  return { active, paused, completed, exited, dismissed, pendingApprovals, lastUpdated: new Date().toISOString() };
}
