#!/usr/bin/env node

// Claude Dash notification watcher.
// Handles delayed notifications (minMinutes > 0) that were queued by session-hook.js.
//
// Run via cron every 5 minutes:
//   */5 * * * * node ~/.openclaw/workspace/notification-watcher.js
//
// Or copy to ~/.openclaw/workspace/ and add the cron entry.

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const os = require('os');

const SESSION_OWNER_DIR = path.join(os.homedir(), '.openclaw', 'workspace', '.session-owners');
const OPENCLAW_CONFIG_PATH = path.join(os.homedir(), '.openclaw', 'openclaw.json');
const NOTIF_PREFS_PATH = path.join(os.homedir(), '.openclaw', 'workspace', 'claude-dash-notifications.json');

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return null; }
}

function readGatewayConfig() {
  const cfg = readJson(OPENCLAW_CONFIG_PATH);
  if (!cfg) return null;
  const port = (cfg.gateway && cfg.gateway.port) || 18789;
  const token = (cfg.gateway && cfg.gateway.auth && cfg.gateway.auth.token) || '';
  return { url: `http://127.0.0.1:${port}`, token };
}

function readProjectStatus(project) {
  const ownerPath = path.join(SESSION_OWNER_DIR, `${project}.json`);
  const owner = readJson(ownerPath);
  return owner ? owner.status : null;
}

function readOpenClawConfig() {
  return readJson(OPENCLAW_CONFIG_PATH);
}

function fireNotification(message, prefs, ocConfig) {
  return new Promise((resolve) => {
    const port = (ocConfig?.gateway?.port) || 18789;
    const hooksToken = ocConfig?.hooks?.token || ocConfig?.gateway?.auth?.token || '';
    const prompt = `Say exactly this to the user, nothing else: ${message}`;
    const body = JSON.stringify({
      message: prompt,
      deliver: true,
      channel: prefs.channel,
      to: prefs.to,
      name: 'ClaudeDashNotif',
    });
    const req = http.request({
      hostname: '127.0.0.1', port,
      path: '/hooks/agent', method: 'POST',
      headers: {
        'Authorization': `Bearer ${hooksToken}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, () => resolve());
    req.on('error', () => resolve());
    req.write(body);
    req.end();
    setTimeout(resolve, 5000);
  });
}

async function run() {
  if (!fs.existsSync(SESSION_OWNER_DIR)) return;

  const prefs = readJson(NOTIF_PREFS_PATH);
  if (!prefs || !prefs.to || !prefs.channel || !prefs.rules) return;

  const ocConfig = readOpenClawConfig();
  if (!ocConfig) return;

  const files = fs.readdirSync(SESSION_OWNER_DIR)
    .filter(f => f.endsWith('.pending-notif.json'));

  for (const file of files) {
    const filePath = path.join(SESSION_OWNER_DIR, file);
    const pending = readJson(filePath);
    if (!pending) { try { fs.unlinkSync(filePath); } catch {} continue; }

    const project = file.replace('.pending-notif.json', '');
    const elapsed = (Date.now() - pending.timestamp) / 60000; // minutes

    // Check if session is still paused — if not, discard
    const status = readProjectStatus(project);
    if (status !== 'paused') {
      try { fs.unlinkSync(filePath); } catch {}
      continue;
    }

    // Check if enough time has passed
    if (elapsed < pending.minMinutes) continue;

    // Check if this rule is still enabled in prefs
    const rule = prefs.rules.find(r => r.type === pending.type);
    if (!rule || !rule.enabled) {
      try { fs.unlinkSync(filePath); } catch {}
      continue;
    }

    // Add elapsed time to message
    const elapsedStr = Math.round(elapsed);
    const msg = `${pending.message}\n(waiting ${elapsedStr} min)`;

    await fireNotification(msg, prefs, ocConfig);
    try { fs.unlinkSync(filePath); } catch {}
  }
}

run().then(() => process.exit(0)).catch(() => process.exit(0));
