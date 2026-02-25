import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { OpenClawConfig, OpenClawChannel, OpenClawAgent } from '@/types/notifications';

function getOpenClawConfigPath(): string {
  return process.env.OPENCLAW_CONFIG_PATH ||
    path.join(os.homedir(), '.openclaw', 'openclaw.json');
}

function getCredentialsDir(): string {
  return path.join(os.homedir(), '.openclaw', 'credentials');
}

function readJson(filePath: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function getAgentsDir(): string {
  return path.join(os.homedir(), '.openclaw', 'agents');
}

function getAgents(): OpenClawAgent[] {
  const agentsDir = getAgentsDir();
  if (!fs.existsSync(agentsDir)) return [];
  try {
    return fs.readdirSync(agentsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => ({
        id: d.name,
        label: d.name.charAt(0).toUpperCase() + d.name.slice(1),
      }));
  } catch {
    return [];
  }
}

function resolveChannelRecipient(channelId: string, credentialsDir: string): string {
  // Try known credential file patterns per channel
  const patterns: Record<string, string[]> = {
    telegram: ['telegram-allowFrom.json'],
    whatsapp: ['whatsapp-allowFrom.json', 'whatsapp.json'],
    discord:  ['discord.json', 'discord-webhook.json'],
    slack:    ['slack.json', 'slack-webhook.json'],
  };

  const files = patterns[channelId] || [];
  for (const file of files) {
    const data = readJson(path.join(credentialsDir, file));
    if (!data) continue;

    // telegram-allowFrom.json: { allowFrom: ["1706765619"] }
    if (Array.isArray(data.allowFrom) && (data.allowFrom as unknown[]).length > 0) {
      return String((data.allowFrom as unknown[])[0]);
    }
    // Generic: { to: "..." } or { chatId: "..." } or { userId: "..." }
    for (const key of ['to', 'chatId', 'userId', 'number', 'webhook']) {
      if (typeof data[key] === 'string') return data[key] as string;
    }
  }
  return '';
}

export async function GET() {
  const configPath = getOpenClawConfigPath();

  if (!fs.existsSync(configPath)) {
    return NextResponse.json<OpenClawConfig>({
      detected: false,
      gatewayUrl: '',
      gatewayToken: '',
      channels: [],
      hooksReady: false,
      agents: getAgents(),
    });
  }

  const config = readJson(configPath);
  if (!config) {
    return NextResponse.json<OpenClawConfig>({
      detected: false,
      gatewayUrl: '',
      gatewayToken: '',
      channels: [],
      hooksReady: false,
      agents: getAgents(),
    });
  }

  const gateway = (config.gateway as Record<string, unknown>) || {};
  const port = (gateway.port as number) || 18789;
  const auth = (gateway.auth as Record<string, unknown>) || {};
  const gatewayToken = (auth.token as string) || '';
  const gatewayUrl = `http://127.0.0.1:${port}`;

  const channelsConfig = (config.channels as Record<string, Record<string, unknown>>) || {};
  const credentialsDir = getCredentialsDir();

  const CHANNEL_LABELS: Record<string, string> = {
    telegram: 'Telegram',
    whatsapp: 'WhatsApp',
    discord:  'Discord',
    slack:    'Slack',
  };

  const channels: OpenClawChannel[] = Object.entries(channelsConfig)
    .filter(([, cfg]) => cfg && cfg.enabled === true)
    .map(([id, cfg]) => ({
      id,
      label: CHANNEL_LABELS[id] || id,
      to: resolveChannelRecipient(id, credentialsDir),
      enabled: cfg.enabled === true,
    }));

  // Hooks are ready if enabled=true and token is distinct from gateway auth token
  const hooksConfig = (config.hooks as Record<string, unknown>) || {};
  const hooksToken = (hooksConfig.token as string) || '';
  const hooksReady = hooksConfig.enabled === true &&
    !!hooksToken &&
    hooksToken !== gatewayToken;

  return NextResponse.json<OpenClawConfig>({
    detected: true,
    gatewayUrl,
    gatewayToken,
    channels,
    hooksReady,
    agents: getAgents(),
  });
}
