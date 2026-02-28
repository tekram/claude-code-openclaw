import { exec } from 'child_process';
import { promisify } from 'util';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import os from 'os';
import { LOG_PATH, parseLogLines, parseTimestamp } from '@/lib/sessions/parse';

const execAsync = promisify(exec);

export interface BriefingCommit {
  hash: string;
  message: string;
}

export interface BriefingProject {
  project: string;
  sessions: number;
  completed: number;
  exited: number;
  totalDurationMs: number;
  commits: BriefingCommit[];
}

export interface BriefingData {
  windowHours: number;
  windowStartIso: string;
  totalSessions: number;
  totalDurationMs: number;
  projects: BriefingProject[];
  hasData: boolean;
}

function readProjectPaths(): Record<string, string> {
  try {
    const settingsPath =
      process.env.CLAUDE_DASH_SETTINGS ||
      path.join(os.homedir(), '.openclaw', 'workspace', 'claude-dash-settings.json');
    const raw = readFileSync(settingsPath, 'utf-8');
    return (JSON.parse(raw) as { projects?: Record<string, string> }).projects || {};
  } catch {
    return {};
  }
}

async function getRecentCommits(
  projectPath: string,
  sinceHours: number
): Promise<BriefingCommit[]> {
  try {
    if (!existsSync(projectPath)) return [];
    const { stdout } = await execAsync(
      `git log --oneline --no-merges --since="${sinceHours} hours ago"`,
      { cwd: projectPath, timeout: 5000 }
    );
    return stdout
      .trim()
      .split('\n')
      .filter((l) => l.trim())
      .map((line) => {
        const sp = line.indexOf(' ');
        return { hash: line.substring(0, sp), message: line.substring(sp + 1) };
      });
  } catch {
    return [];
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const windowHours = Math.max(1, Math.min(72, parseInt(searchParams.get('hours') || '16', 10)));

    const now = Date.now();
    const windowStartMs = now - windowHours * 60 * 60 * 1000;

    const projectMap: Record<string, BriefingProject> = {};

    if (existsSync(LOG_PATH)) {
      const content = readFileSync(LOG_PATH, 'utf-8').replace(/\r\n/g, '\n');
      const lines = content.trim().split('\n').filter((l) => l);
      const sessions = parseLogLines(lines);

      for (const session of sessions) {
        const startMs = parseTimestamp(session.startTime);
        if (startMs < windowStartMs) continue;
        // Only include finished sessions — skip anything still active/paused
        if (session.status === 'active' || session.status === 'paused') continue;

        if (!projectMap[session.project]) {
          projectMap[session.project] = {
            project: session.project,
            sessions: 0,
            completed: 0,
            exited: 0,
            totalDurationMs: 0,
            commits: [],
          };
        }
        const p = projectMap[session.project];
        p.sessions++;
        if (session.status === 'completed') p.completed++;
        if (session.status === 'exited') p.exited++;
        p.totalDurationMs += session.durationMs || 0;
      }
    }

    // Attach git commits for each project with a configured path
    const projectPaths = readProjectPaths();
    await Promise.allSettled(
      Object.entries(projectMap).map(async ([name, p]) => {
        const dir = projectPaths[name];
        if (dir) {
          p.commits = await getRecentCommits(dir, windowHours);
        }
      })
    );

    const projects = Object.values(projectMap).sort(
      (a, b) => b.totalDurationMs - a.totalDurationMs
    );

    const result: BriefingData = {
      windowHours,
      windowStartIso: new Date(windowStartMs).toISOString(),
      totalSessions: projects.reduce((s, p) => s + p.sessions, 0),
      totalDurationMs: projects.reduce((s, p) => s + p.totalDurationMs, 0),
      projects,
      hasData: projects.length > 0,
    };

    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('Error building briefing:', err);
    return Response.json({ error: 'Failed to build briefing' }, { status: 500 });
  }
}
