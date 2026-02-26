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
const { spawn } = require('child_process');

const LOG_PATH = path.join(__dirname, 'sessions.log');
const SESSION_OWNER_DIR = path.join(__dirname, '.session-owners');
const OPENCLAW_CONFIG_PATH = path.join(__dirname, '..', 'openclaw.json');
const NOTIF_PREFS_PATH = path.join(__dirname, 'claude-dash-notifications.json');

// Optional: map directory basenames to display names.
// Unknown directories automatically fall back to the basename, so this is only
// needed if you want a different display name (e.g. 'legacy-monorepo' → 'platform').
const DIR_TO_PROJECT = {
  // 'my-project': 'My Project',
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

// --- Notification helpers ---

function readNotificationPrefs() {
  try {
    return JSON.parse(fs.readFileSync(NOTIF_PREFS_PATH, 'utf-8'));
  } catch {
    return null; // not configured — skip all notifications
  }
}

function readGatewayConfig() {
  try {
    const cfg = JSON.parse(fs.readFileSync(OPENCLAW_CONFIG_PATH, 'utf-8'));
    const port = (cfg.gateway && cfg.gateway.port) || 18789;
    const token = (cfg.gateway && cfg.gateway.auth && cfg.gateway.auth.token) || '';
    return { url: `http://127.0.0.1:${port}`, token };
  } catch {
    return null;
  }
}

function getPendingNotifPath(project) {
  return path.join(SESSION_OWNER_DIR, `${project}.pending-notif.json`);
}

function writePendingNotif(project, type, message, minMinutes) {
  ensureOwnerDir();
  try {
    fs.writeFileSync(getPendingNotifPath(project), JSON.stringify({
      type, message, minMinutes, timestamp: Date.now(),
    }), 'utf-8');
  } catch {}
}

function clearPendingNotif(project) {
  try { fs.unlinkSync(getPendingNotifPath(project)); } catch {}
}

// Fire-and-forget: spawn detached child to POST to OpenClaw /hooks/agent
// OpenClaw handles all channel delivery — logged in gateway dashboard
function fireViaOpenClaw(message, prefs, ocConfig) {
  const gateway = readGatewayConfig();
  if (!gateway || !prefs.to || !prefs.channel) return;

  // Use hooks token if configured, fall back to gateway auth token
  const hooksToken = (ocConfig && ocConfig.hooks && ocConfig.hooks.token) || gateway.token;

  // Wrap message so the agent relays it verbatim rather than rephrasing
  const prompt = `Say exactly this to the user, nothing else: ${message}`;
  const payload = JSON.stringify({
    message: prompt,
    deliver: true,
    channel: prefs.channel,
    to: prefs.to,
    name: 'ClaudeDashNotif',
  });
  const port = (gateway.url.match(/:(\d+)$/) || [])[1] || '18789';
  const script = [
    "const http=require('http');",
    "const b=process.env._NB;",
    "const r=http.request({hostname:'127.0.0.1',port:+process.env._NP,path:'/hooks/agent',method:'POST',",
    "headers:{'Authorization':'Bearer '+process.env._NT,'Content-Type':'application/json','Content-Length':Buffer.byteLength(b)}});",
    "r.on('error',()=>{});r.write(b);r.end();",
  ].join('');
  try {
    const child = spawn(process.execPath, ['-e', script], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: { _NB: payload, _NT: hooksToken, _NP: port },
    });
    child.unref();
  } catch {}
}

// Read raw openclaw config for channel credentials (bot tokens etc.)
function readOpenClawConfig() {
  try {
    return JSON.parse(fs.readFileSync(OPENCLAW_CONFIG_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

// Fire-and-forget direct Telegram Bot API (used when deliveryMode === 'direct')
function fireDirectTelegramAsync(message, prefs, ocConfig) {
  const botToken = ocConfig && ocConfig.channels && ocConfig.channels.telegram && ocConfig.channels.telegram.botToken;
  if (!botToken || !prefs.to) return;
  const payload = JSON.stringify({ chat_id: prefs.to, text: message });
  const script = [
    "const https=require('https');",
    "const b=process.env._NB;",
    "const tok=process.env._NT;",
    "const r=https.request({hostname:'api.telegram.org',path:'/bot'+tok+'/sendMessage',method:'POST',",
    "headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(b)}});",
    "r.on('error',()=>{});r.write(b);r.end();",
  ].join('');
  try {
    const child = spawn(process.execPath, ['-e', script], {
      detached: true, stdio: 'ignore', windowsHide: true,
      env: { _NB: payload, _NT: botToken },
    });
    child.unref();
  } catch {}
}

// Check prefs and either fire immediately or write a pending file for the watcher
function maybeNotify(project, notifType, message) {
  const prefs = readNotificationPrefs();
  if (!prefs || !prefs.rules || !prefs.to || !prefs.channel) return;

  const rule = prefs.rules.find(r => r.type === notifType);
  if (!rule || !rule.enabled) return;

  const ocConfig = readOpenClawConfig();

  if (rule.minMinutes === 0) {
    fireNotificationAsync(message, prefs, ocConfig);
  } else {
    writePendingNotif(project, notifType, message, rule.minMinutes);
  }
}

// Dispatch to the right delivery function based on deliveryMode pref
function fireNotificationAsync(message, prefs, ocConfig) {
  if (prefs.deliveryMode === 'direct' && prefs.channel === 'telegram') {
    fireDirectTelegramAsync(message, prefs, ocConfig);
    return;
  }
  fireViaOpenClaw(message, prefs, ocConfig);
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

// Map tool name to notification rule type
function getNotifType(toolName) {
  if (toolName === 'AskUserQuestion') return 'question';
  if (toolName === 'Bash') return 'bash';
  if (toolName === 'Write' || toolName === 'Edit' || toolName === 'NotebookEdit') return 'file';
  return null;
}

function handlePreToolUse(hookData) {
  if (!PERMISSION_TOOLS.has(hookData.tool_name)) return;

  const project = getProjectFromCwd(hookData.cwd);
  const status = getCurrentStatus(project);

  // Only pause if currently active (idempotent)
  if (status !== 'active') return;

  const reason = getToolPauseReason(hookData);
  logSession('PAUSED', project, reason);
  updateCachedStatus(project, 'paused');

  // Notify user if configured
  const notifType = getNotifType(hookData.tool_name);
  if (notifType) {
    const msg = buildNotifMessage(project, notifType, hookData);
    maybeNotify(project, notifType, msg);
  }
}

function buildNotifMessage(project, notifType, hookData) {
  const tool = hookData.tool_name;
  const input = hookData.tool_input || {};

  if (notifType === 'question') {
    const q = input.questions && input.questions[0] && input.questions[0].question;
    if (q) return `❓ ${project}: Claude is asking —\n"${q.length > 200 ? q.substring(0, 197) + '...' : q}"`;
    return `❓ ${project}: Claude is waiting for your input`;
  }

  if (notifType === 'bash') {
    const cmd = input.command || '';
    const short = cmd.length > 120 ? cmd.substring(0, 117) + '...' : cmd;
    return `⏸ ${project}: Permission needed —\nbash \`${short}\``;
  }

  if (notifType === 'file') {
    const file = input.file_path ? path.basename(input.file_path) : 'a file';
    return `📄 ${project}: Permission needed — ${tool.toLowerCase()} ${file}`;
  }

  return `⏸ ${project}: Claude needs your attention`;
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

  // Only permission tools affect PAUSED/RESUMED state
  if (!PERMISSION_TOOLS.has(hookData.tool_name)) return;

  const status = getCurrentStatus(project);
  if (status === 'paused') {
    logSession('RESUMED', project);
    clearPendingNotif(project);
  }

  // Always update owner file to active for permission tools — even if getCurrentStatus
  // returned unexpected value (e.g. race condition or owner file read error). This ensures
  // the dashboard's owner-file override check can detect false-paused states.
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
    // Cancel any pending delayed notification — user is back
    clearPendingNotif(project);
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

  // Crash notification: fire if session died while active/paused and user didn't cleanly exit
  const cleanExitReasons = new Set(['prompt_input_exit', 'clear']);
  if (!cleanExitReasons.has(reason) && (status === 'active' || status === 'paused')) {
    maybeNotify(project, 'crash', `💀 ${project}: Session crashed or interrupted`);
  }
  clearPendingNotif(project);
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
