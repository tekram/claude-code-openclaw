import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';

const TASK_RESULTS_DIR = path.join(os.homedir(), '.openclaw', 'workspace', 'task-results');

export const dynamic = 'force-dynamic';

interface TaskResultFile {
  status: 'running' | 'done' | 'error';
  output?: string;
  stderr?: string;
  exitCode?: number;
  startedAt: string;
  completedAt?: string;
  pid?: number;
  projectName?: string;
  task?: string;
}

export async function GET() {
  if (!fs.existsSync(TASK_RESULTS_DIR)) {
    return NextResponse.json([], { headers: { 'Cache-Control': 'no-store' } });
  }

  let files: string[];
  try {
    files = fs.readdirSync(TASK_RESULTS_DIR).filter((f) => f.endsWith('.json'));
  } catch {
    return NextResponse.json([], { headers: { 'Cache-Control': 'no-store' } });
  }

  const tasks = [];
  for (const file of files) {
    const taskId = file.replace('.json', '');
    try {
      const raw = fs.readFileSync(path.join(TASK_RESULTS_DIR, file), 'utf-8');
      const data: TaskResultFile = JSON.parse(raw);
      tasks.push({
        taskId,
        status: data.status,
        projectName: data.projectName ?? 'unknown',
        task: data.task,
        startedAt: data.startedAt,
        completedAt: data.completedAt,
        hasOutput: !!(data.output),
        hasStderr: !!(data.stderr),
        exitCode: data.exitCode,
      });
    } catch {
      // ignore malformed files
    }
  }

  // Sort by startedAt descending (newest first)
  tasks.sort((a, b) => {
    const ta = a.startedAt ? new Date(a.startedAt).getTime() : 0;
    const tb = b.startedAt ? new Date(b.startedAt).getTime() : 0;
    return tb - ta;
  });

  return NextResponse.json(tasks.slice(0, 20), { headers: { 'Cache-Control': 'no-store' } });
}
