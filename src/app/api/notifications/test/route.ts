import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';

function readJson(filePath: string): Record<string, unknown> | null {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch { return null; }
}

function resolveRecipient(
  channelId: string,
  config: Record<string, unknown>,
  credDir: string,
  prefsTo: string,
): string {
  if (prefsTo) return prefsTo;
  const credFiles: Record<string, string[]> = {
    telegram: ['telegram-allowFrom.json'],
    whatsapp: ['whatsapp-allowFrom.json', 'whatsapp.json'],
    discord:  ['discord.json'],
    slack:    ['slack.json'],
  };
  for (const file of (credFiles[channelId] || [])) {
    const cred = readJson(path.join(credDir, file));
    if (!cred) continue;
    if (Array.isArray(cred.allowFrom) && (cred.allowFrom as unknown[]).length > 0) {
      return String((cred.allowFrom as unknown[])[0]);
    }
    const channels = (config.channels as Record<string, Record<string, unknown>>) || {};
    const allowFrom = channels[channelId]?.allowFrom;
    if (Array.isArray(allowFrom) && allowFrom.length > 0) return String(allowFrom[0]);
  }
  return '';
}

export async function POST() {
  const configPath = process.env.OPENCLAW_CONFIG_PATH ||
    path.join(os.homedir(), '.openclaw', 'openclaw.json');

  const config = readJson(configPath);
  if (!config) {
    return NextResponse.json({ sent: false, error: 'OpenClaw config not found' }, { status: 404 });
  }

  const gateway = (config.gateway as Record<string, unknown>) || {};
  const port = (gateway.port as number) || 18789;
  const auth = (gateway.auth as Record<string, unknown>) || {};
  const gatewayToken = (auth.token as string) || '';
  const hooksConfig = (config.hooks as Record<string, unknown>) || {};
  const hooksToken = (hooksConfig.token as string) || gatewayToken;
  const gatewayUrl = `http://127.0.0.1:${port}`;

  const credDir = path.join(os.homedir(), '.openclaw', 'credentials');
  const prefsPath = process.env.CLAUDE_DASH_NOTIF_PREFS ||
    path.join(os.homedir(), '.openclaw', 'workspace', 'claude-dash-notifications.json');
  const prefs = readJson(prefsPath);
  const channel = (prefs?.channel as string) || 'telegram';
  const to = resolveRecipient(channel, config, credDir, (prefs?.to as string) || '');

  if (!to) {
    return NextResponse.json(
      { sent: false, error: 'No recipient found. Make sure OpenClaw has a channel paired.' },
      { status: 400 }
    );
  }

  const text = '✅ Claude Dash notifications are working. You will be alerted here when Claude needs your attention.';
  const deliveryMode = (prefs?.deliveryMode as string) || 'openclaw';

  try {
    if (deliveryMode === 'direct' && channel === 'telegram') {
      // Direct: Telegram Bot API
      const channels = (config.channels as Record<string, Record<string, unknown>>) || {};
      const botToken = (channels.telegram?.botToken as string) || '';
      if (!botToken) {
        return NextResponse.json({ sent: false, error: 'No Telegram bot token found in OpenClaw config' }, { status: 400 });
      }
      const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: to, text }),
      });
      const data = await res.json() as { ok: boolean; description?: string };
      if (!data.ok) return NextResponse.json({ sent: false, error: `Telegram: ${data.description}` }, { status: 502 });
      return NextResponse.json({ sent: true });
    }

    // OpenClaw: route through /hooks/agent — logged in gateway dashboard
    const prompt = `Say exactly this to the user, nothing else: ${text}`;
    const res = await fetch(`${gatewayUrl}/hooks/agent`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${hooksToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: prompt, deliver: true, channel, to, name: 'ClaudeDashTest' }),
    });
    if (!res.ok) {
      const body = await res.text();
      return NextResponse.json({ sent: false, error: `Gateway error ${res.status}: ${body}` }, { status: 502 });
    }
    return NextResponse.json({ sent: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ sent: false, error: msg }, { status: 502 });
  }
}
