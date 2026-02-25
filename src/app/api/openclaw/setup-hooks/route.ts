import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

function readJson(filePath: string): Record<string, unknown> | null {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch { return null; }
}

export async function POST() {
  const configPath = process.env.OPENCLAW_CONFIG_PATH ||
    path.join(os.homedir(), '.openclaw', 'openclaw.json');

  const config = readJson(configPath);
  if (!config) {
    return NextResponse.json({ ok: false, error: 'OpenClaw config not found' }, { status: 404 });
  }

  const gateway = (config.gateway as Record<string, unknown>) || {};
  const auth = (gateway.auth as Record<string, unknown>) || {};
  const gatewayToken = (auth.token as string) || '';

  const existing = (config.hooks as Record<string, unknown>) || {};
  const existingToken = (existing.token as string) || '';

  // Already correctly configured
  if (existing.enabled === true && existingToken && existingToken !== gatewayToken) {
    return NextResponse.json({ ok: true, alreadyConfigured: true });
  }

  // Generate a distinct hooks token
  const hooksToken = crypto.randomBytes(24).toString('hex');

  config.hooks = {
    ...existing,
    enabled: true,
    token: hooksToken,
  };

  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    return NextResponse.json({ ok: true, alreadyConfigured: false, needsRestart: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: `Could not write config: ${msg}` }, { status: 500 });
  }
}
