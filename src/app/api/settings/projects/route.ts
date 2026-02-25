import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';

function getSettingsPath(): string {
  return process.env.CLAUDE_DASH_SETTINGS ||
    path.join(os.homedir(), '.openclaw', 'workspace', 'claude-dash-settings.json');
}

function readSettings(): { projects: Record<string, string> } {
  try {
    const raw = fs.readFileSync(getSettingsPath(), 'utf-8');
    return JSON.parse(raw) as { projects: Record<string, string> };
  } catch {
    return { projects: {} };
  }
}

export async function GET() {
  return NextResponse.json(readSettings());
}

export async function PUT(req: Request) {
  const body = await req.json() as { projects?: unknown };

  if (!body.projects || typeof body.projects !== 'object' || Array.isArray(body.projects)) {
    return NextResponse.json({ error: 'projects must be an object' }, { status: 400 });
  }

  const settingsPath = getSettingsPath();
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });

  const current = readSettings();
  const updated = { ...current, projects: body.projects as Record<string, string> };
  fs.writeFileSync(settingsPath, JSON.stringify(updated, null, 2), 'utf-8');

  return NextResponse.json(updated);
}
