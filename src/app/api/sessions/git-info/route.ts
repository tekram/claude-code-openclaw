import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import os from 'os';
import type { GitInfo, GitInfoMap } from '@/types/sessions';

const execAsync = promisify(exec);
const EXEC_TIMEOUT = 5000;

function readProjects(): Record<string, string> {
  try {
    const settingsPath = process.env.CLAUDE_DASH_SETTINGS ||
      path.join(os.homedir(), '.openclaw', 'workspace', 'claude-dash-settings.json');
    const raw = readFileSync(settingsPath, 'utf-8');
    return (JSON.parse(raw) as { projects?: Record<string, string> }).projects || {};
  } catch {
    return {};
  }
}

function aggregateCIStatus(
  rollup: Array<{ state: string }>
): GitInfo['pr'] extends null ? never : NonNullable<GitInfo['pr']>['ciStatus'] {
  if (!rollup || rollup.length === 0) return null;
  const failing = ['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT'];
  const pending = ['PENDING', 'IN_PROGRESS', 'QUEUED', 'WAITING', 'REQUESTED'];
  if (rollup.some((c) => failing.includes(c.state))) return 'failing';
  if (rollup.some((c) => pending.includes(c.state))) return 'pending';
  if (rollup.every((c) => c.state === 'SUCCESS')) return 'passing';
  return null;
}

async function getGitInfo(projectPath: string): Promise<GitInfo> {
  const info: GitInfo = { branch: null, isDirty: false, pr: null };

  if (!existsSync(projectPath)) return info;

  // Run git branch + status in parallel, using cwd to avoid path quoting issues
  const opts = { cwd: projectPath, timeout: EXEC_TIMEOUT };
  const [branchResult, statusResult] = await Promise.allSettled([
    execAsync('git rev-parse --abbrev-ref HEAD', opts),
    execAsync('git status --porcelain', opts),
  ]);

  if (branchResult.status === 'fulfilled') {
    const branch = branchResult.value.stdout.trim();
    // "HEAD" means detached HEAD — not useful to display
    info.branch = branch && branch !== 'HEAD' ? branch : null;
  }

  if (statusResult.status === 'fulfilled') {
    info.isDirty = statusResult.value.stdout.trim().length > 0;
  }

  // Try gh pr view for the current branch
  try {
    const { stdout } = await execAsync(
      'gh pr view --json number,title,state,url,statusCheckRollup',
      opts
    );
    const pr = JSON.parse(stdout) as {
      number: number;
      title: string;
      state: string;
      url: string;
      statusCheckRollup: Array<{ state: string }>;
    };
    info.pr = {
      number: pr.number,
      title: pr.title,
      state: pr.state as 'OPEN' | 'CLOSED' | 'MERGED',
      url: pr.url,
      ciStatus: aggregateCIStatus(pr.statusCheckRollup ?? []),
    };
  } catch {
    // No PR for this branch, or gh not available — pr stays null
  }

  return info;
}

export async function GET() {
  const projects = readProjects();
  const entries = Object.entries(projects);

  if (entries.length === 0) {
    return Response.json({} as GitInfoMap, { headers: { 'Cache-Control': 'no-store' } });
  }

  // Fetch all projects in parallel
  const results = await Promise.allSettled(
    entries.map(async ([name, projectPath]) => {
      const info = await getGitInfo(projectPath);
      return [name, info] as const;
    })
  );

  const gitInfoMap: GitInfoMap = {};
  for (const result of results) {
    if (result.status === 'fulfilled') {
      const [name, info] = result.value;
      gitInfoMap[name] = info;
    }
  }

  return Response.json(gitInfoMap, { headers: { 'Cache-Control': 'no-store' } });
}
