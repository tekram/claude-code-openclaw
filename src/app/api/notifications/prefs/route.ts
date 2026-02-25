import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { NotificationPrefs } from '@/types/notifications';
import { DEFAULT_PREFS } from '@/types/notifications';

function getPrefsPath(): string {
  return process.env.CLAUDE_DASH_NOTIF_PREFS ||
    path.join(os.homedir(), '.openclaw', 'workspace', 'claude-dash-notifications.json');
}

export async function GET() {
  const prefsPath = getPrefsPath();
  try {
    const raw = fs.readFileSync(prefsPath, 'utf-8');
    const prefs = JSON.parse(raw) as NotificationPrefs;
    // Merge with defaults so new rule types added in future are always present
    const merged: NotificationPrefs = {
      ...DEFAULT_PREFS,
      ...prefs,
      rules: DEFAULT_PREFS.rules.map(defaultRule => {
        const saved = prefs.rules?.find(r => r.type === defaultRule.type);
        return saved ? { ...defaultRule, ...saved } : defaultRule;
      }),
    };
    return NextResponse.json(merged);
  } catch {
    return NextResponse.json(DEFAULT_PREFS);
  }
}

export async function PUT(req: Request) {
  const body = await req.json() as NotificationPrefs;

  // Basic validation
  if (!body.channel || !Array.isArray(body.rules)) {
    return NextResponse.json({ error: 'Invalid prefs shape' }, { status: 400 });
  }

  const prefsPath = getPrefsPath();
  const dir = path.dirname(prefsPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(prefsPath, JSON.stringify(body, null, 2), 'utf-8');
  return NextResponse.json({ saved: true });
}
