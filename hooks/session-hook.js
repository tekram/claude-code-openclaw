#!/usr/bin/env node

// Unified Claude Code hook for automatic session tracking.
// Handles: SessionStart, PreToolUse, PostToolUse, UserPromptSubmit, SessionEnd.
// Dispatches based on hook_event_name from stdin JSON.
//
// Key design: uses session_id from Claude Code hook data to correlate START and END events.
// This prevents stale/orphaned processes from corrupting active session state.
//
// Performance: session status is cached in the owner file to avoid reading the full log
// on every hook invocation. The log is only read for getLastContext (on session start).

const fs = require('fs');
const path = require('path');

const LOG_PATH = path.join(__dirname, 'sessions.log');
const SESSION_OWNER_DIR = path.join(__dirname, '.session-owners');

const DIR_TO_PROJECT = {
  'agentic-trading': 'agentic-trading',
  'backtesting-engine': 'backtesting-engine',
  'flair': 'flair',
  'openscheduling': 'openscheduling',
  'openclaw-studio': 'openclaw-studio',
  'huberman-protocol-pal': 'huberman-protocol-pal',
  'openclaw-ollama-telegram': 'openclaw',
  'claude-dash': 'claude-dash',
};

function getProjectFromCwd(cwd) {
  const basename = path.basename(cwd || process.cwd()).toLowerCase();
  return DIR_TO_PROJECT[basename] || basename;
}

function logSession(action, project, details) {
  const ts = new Date().toLocaleString('sv-SE');
  const line = `[${ts}] ${action} ${project}${details ? ' ' + details : ''}\n`;
  fs.appendFileSync(LOG_PATH, line, 'utf-8');
}

// --- Session ownership & cached status ---
// The owner file stores both the session_id (for ownership) and the current status
// (to avoid reading the full log on every hook call).

function ensureOwnerDir() {
  if (!fs.existsSync(SESSION_OWNER_DIR)) {
    fs.mkdirSync(SESSION_OWNER_DIR, { recursive: true });
  }
}

function getSessionId(hookData) {
  return hookData.session_id || hookData.sessionId || `ppid-${process.ppid}`;
}

function readOwnerFile(project) {
  const ownerPath = path.join(SESSION_OWNER_DIR, `${project}.json`);
  if (!fs.existsSync(ownerPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(ownerPath, 'utf-8'));
  } catch {
    return null;
  }
}

function writeOwnerFile(project, data) {
  ensureOwnerDir();
  const ownerPath = path.join(SESSION_OWNER_DIR, `${project}.json`);
  fs.writeFileSync(ownerPath, JSON.stringify(data), 'utf-8');
}

function claimSession(project, sessionId, status) {
  writeOwnerFile(project, { sessionId, status: status || 'active', ts: Date.now() });
}

function updateCachedStatus(project, status) {
  const owner = readOwnerFile(project);
  if (owner) {
    owner.status = status;
    owner.ts = Date.now();
    writeOwnerFile(project, owner);
  }
}

function getSessionOwner(project) {
  return readOwnerFile(project);
}

function clearSessionOwner(project) {
  const ownerPath = path.join(SESSION_OWNER_DIR, `${project}.json`);
  try { fs.unlinkSync(ownerPath); } catch {}
}

// Fast path: read cached status from owner file, no log parsing needed.
// Falls back to full log scan only if owner file is missing.
function getCurrentStatus(project) {
  const owner = readOwnerFile(project);
  if (owner && owner.status) {
    return owner.status;
  }
  // Fallback: scan log (only happens on first run or after owner file deleted)
  return getCurrentStatusFromLog(project);
}

// Full log scan — only used as fallback when owner file is unavailable.
function getCurrentStatusFromLog(project) {
  if (!fs.existsSync(LOG_PATH)) return null;

  const lines = fs.readFileSync(LOG_PATH, 'utf-8').trim().split('\n').filter(Boolean);

  // Walk backwards to find the last relevant action for this project
  for (let i = lines.length - 1; i >= 0; i--) {
    const match = lines[i].match(/\[([^\]]+)\]\s+(START|PAUSED|RESUMED|DONE|EXIT|DISMISSED|HEARTBEAT|NOTE)\s+(\S+)/);
    if (!match) continue;
    const [, , action, proj] = match;
    if (proj !== project) continue;

    switch (action) {
      case 'START':
      case 'RESUMED':
      case 'HEARTBEAT':
        return 'active';
      case 'PAUSED':
        return 'paused';
      case 'DONE':
        return 'completed';
      case 'EXIT':
      case 'DISMISSED':
        return 'exited';
      case 'NOTE':
        continue; // NOTE doesn't change status, keep looking
    }
  }

  return null;
}

// --- Hook handlers ---

// Get the last meaningful detail for a project from the log (for context on start/resume).
// Prefers DONE summaries and descriptive START entries over short user prompts.
function getLastContext(project) {
  if (!fs.existsSync(LOG_PATH)) return null;
  const lines = fs.readFileSync(LOG_PATH, 'utf-8').trim().split('\n').filter(Boolean);

  const SKIP_DETAILS = new Set([
    'Auto-started via hook', 'Session resumed', 'New session',
    'waiting for input',
  ]);
  const MIN_USEFUL_LENGTH = 15; // skip very short prompts like "yes", "quite", "ok sure"

  let bestDone = null;   // DONE entries — best summaries
  let bestStart = null;  // START entries with real descriptions
  let bestOther = null;  // HEARTBEAT/PAUSED with substantial text
  let scanned = 0;

  for (let i = lines.length - 1; i >= 0; i--) {
    const match = lines[i].match(/\[([^\]]+)\]\s+(DONE|HEARTBEAT|START|PAUSED|RESUMED)\s+(\S+)\s+(.*)/);
    if (!match) continue;
    const [, , action, proj, details] = match;
    if (proj !== project || !details) continue;

    // Skip generic details
    if (SKIP_DETAILS.has(details)) continue;
    if (details.startsWith('Permission needed:')) continue;
    if (details.startsWith('Continuing:') || details.startsWith('Resumed:')) continue;

    if (action === 'DONE' && !bestDone) {
      bestDone = details;
      break; // DONE is always the best context, stop searching
    }
    if (action === 'START' && !bestStart && details.length >= MIN_USEFUL_LENGTH) {
      bestStart = details;
    }
    if (!bestOther && details.length >= MIN_USEFUL_LENGTH) {
      bestOther = details;
    }

    scanned++;
    if (scanned > 50) break; // don't scan too far back
  }

  const best = bestDone || bestStart || bestOther;
  if (!best) return null;
  return best.length > 120 ? best.substring(0, 117) + '...' : best;
}

function handleSessionStart(hookData) {
  const project = getProjectFromCwd(hookData.cwd);
  const sessionId = getSessionId(hookData);

  const lastContext = getLastContext(project);

  if (hookData.source === 'startup' || hookData.source === 'clear') {
    // Fresh session or context cleared — log a new START
    const prefix = hookData.source === 'clear' ? 'Context cleared' : 'Continuing';
    const detail = lastContext ? `${prefix}: ${lastContext}` : 'New session';
    logSession('START', project, detail);
    claimSession(project, sessionId, 'active');
  } else if (hookData.source === 'resume' || hookData.source === 'compact') {
    // Resuming or compacted — ensure it shows as active
    const status = getCurrentStatus(project);
    if (status === 'completed') {
      // Resuming after DONE — start a fresh session
      const detail = lastContext ? `Continuing: ${lastContext}` : 'New session';
      logSession('START', project, detail);
      claimSession(project, sessionId, 'active');
    } else if (status !== 'active') {
      // Recovering from paused/exited/unknown state
      const detail = lastContext ? `Resumed: ${lastContext}` : 'Session resumed';
      logSession('RESUMED', project, detail);
      claimSession(project, sessionId, 'active');
    } else {
      // Already active — just claim ownership (session may have switched processes)
      claimSession(project, sessionId, 'active');
    }
  }
}

// Tools that trigger permission prompts
const PERMISSION_TOOLS = new Set(['AskUserQuestion', 'Bash', 'Write', 'Edit', 'NotebookEdit']);

function getToolPauseReason(hookData) {
  const tool = hookData.tool_name;

  if (tool === 'AskUserQuestion') {
    try {
      const questions = hookData.tool_input && hookData.tool_input.questions;
      if (questions && questions.length > 0 && questions[0].question) {
        let q = questions[0].question;
        if (q.length > 200) q = q.substring(0, 197) + '...';
        return q;
      }
    } catch {}
    return 'waiting for input';
  }

  if (tool === 'Bash') {
    const cmd = hookData.tool_input && hookData.tool_input.command;
    if (cmd) {
      const short = cmd.length > 80 ? cmd.substring(0, 77) + '...' : cmd;
      return `Permission needed: bash \`${short}\``;
    }
    return 'Permission needed: bash command';
  }

  if (tool === 'Write' || tool === 'Edit') {
    const file = hookData.tool_input && hookData.tool_input.file_path;
    if (file) {
      const basename = path.basename(file);
      return `Permission needed: ${tool.toLowerCase()} ${basename}`;
    }
    return `Permission needed: ${tool.toLowerCase()} file`;
  }

  return `Permission needed: ${tool}`;
}

function handlePreToolUse(hookData) {
  if (!PERMISSION_TOOLS.has(hookData.tool_name)) return;

  const project = getProjectFromCwd(hookData.cwd);
  const status = getCurrentStatus(project);

  // Only pause if currently active (idempotent)
  if (status !== 'active') return;

  logSession('PAUSED', project, getToolPauseReason(hookData));
  updateCachedStatus(project, 'paused');
}

// Write latest activity to a state file (overwritten each time, no log bloat)
function writeLatestActivity(project, activity) {
  ensureOwnerDir();
  const activityPath = path.join(SESSION_OWNER_DIR, `${project}.activity`);
  fs.writeFileSync(activityPath, JSON.stringify({ activity, ts: Date.now() }), 'utf-8');
}

function describeToolActivity(hookData) {
  const tool = hookData.tool_name;
  const input = hookData.tool_input || {};

  switch (tool) {
    case 'Read':
      return input.file_path ? `Reading ${path.basename(input.file_path)}` : 'Reading file';
    case 'Write':
      return input.file_path ? `Writing ${path.basename(input.file_path)}` : 'Writing file';
    case 'Edit':
      return input.file_path ? `Editing ${path.basename(input.file_path)}` : 'Editing file';
    case 'Bash': {
      const cmd = input.command || '';
      const short = cmd.length > 80 ? cmd.substring(0, 77) + '...' : cmd;
      return `Running: ${short}`;
    }
    case 'Grep':
      return input.pattern ? `Searching for "${input.pattern}"` : 'Searching code';
    case 'Glob':
      return input.pattern ? `Finding files: ${input.pattern}` : 'Finding files';
    case 'Task':
      return input.description || 'Running sub-agent';
    case 'WebSearch':
      return input.query ? `Searching: ${input.query}` : 'Web search';
    case 'WebFetch':
      return 'Fetching web content';
    case 'AskUserQuestion':
      return 'Asking question';
    default:
      return `Using ${tool}`;
  }
}

function handlePostToolUse(hookData) {
  const project = getProjectFromCwd(hookData.cwd);

  // Always update latest activity (lightweight state file, not the log)
  writeLatestActivity(project, describeToolActivity(hookData));

  // Only log RESUMED for permission tools when paused
  if (!PERMISSION_TOOLS.has(hookData.tool_name)) return;

  const status = getCurrentStatus(project);
  if (status !== 'paused') return;

  logSession('RESUMED', project);
  updateCachedStatus(project, 'active');
}

function handleUserPromptSubmit(hookData) {
  const project = getProjectFromCwd(hookData.cwd);
  const status = getCurrentStatus(project);

  // Capture truncated prompt as activity context
  let promptSummary = '';
  try {
    const prompt = hookData.prompt || '';
    if (prompt) {
      // Take first line, truncate to 120 chars
      const firstLine = prompt.split('\n')[0].trim();
      promptSummary = firstLine.length > 120 ? firstLine.substring(0, 117) + '...' : firstLine;
    }
  } catch {}

  if (status === 'paused') {
    // User answered a question or typed while paused
    logSession('RESUMED', project, promptSummary);
    updateCachedStatus(project, 'active');
  } else if (status === 'active') {
    // Heartbeat to keep session alive (prevents stale timeout conversion)
    logSession('HEARTBEAT', project, promptSummary);
  }
}

function handleSessionEnd(hookData) {
  const project = getProjectFromCwd(hookData.cwd);
  const sessionId = getSessionId(hookData);

  // Only let the session owner log EXIT — prevents stale/orphaned processes
  // from corrupting the active session's state
  const owner = getSessionOwner(project);
  if (owner && owner.sessionId !== sessionId) {
    // This EXIT is from a different session (stale process) — skip
    return;
  }

  const status = getCurrentStatus(project);

  // Nothing to close if no active/paused session
  if (!status || status === 'completed' || status === 'exited') {
    clearSessionOwner(project);
    return;
  }

  const reason = hookData.reason || 'exit';
  const EXIT_LABELS = {
    'prompt_input_exit': 'User exited session',
    'clear': 'Session cleared by user',
    'exit': 'Session ended',
    'other': 'Session ended',
  };
  const label = EXIT_LABELS[reason] || `Session ended (${reason})`;
  logSession('EXIT', project, label);
  clearSessionOwner(project);
}

// Read stdin and dispatch
let input = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  let hookData = {};
  try {
    hookData = JSON.parse(input);
  } catch {
    process.exit(0);
  }

  const event = hookData.hook_event_name;
  switch (event) {
    case 'SessionStart':
      handleSessionStart(hookData);
      break;
    case 'PreToolUse':
      handlePreToolUse(hookData);
      break;
    case 'PostToolUse':
      handlePostToolUse(hookData);
      break;
    case 'UserPromptSubmit':
      handleUserPromptSubmit(hookData);
      break;
    case 'SessionEnd':
      handleSessionEnd(hookData);
      break;
  }

  process.exit(0);
});

// Timeout fallback if stdin never closes
setTimeout(() => {
  if (!input) process.exit(0);
}, 3000);
