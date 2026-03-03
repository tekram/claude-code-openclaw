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

function extractOutputSummary(output?: string): string | undefined {
  if (!output) return undefined;
  const lines = output.split('\n');
  // Prefer an explicit "Result: ..." line (from our prompt instruction)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.startsWith('Result: ')) {
      const summary = line.slice('Result: '.length).trim();
      return summary.length > 120 ? summary.slice(0, 117) + '…' : summary;
    }
  }
  // Fallback: last non-empty, non-separator line
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line && !/^[-=*─]+$/.test(line)) {
      return line.length > 120 ? line.slice(0, 117) + '…' : line;
    }
  }
  return undefined;
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
      const durationMs =
        data.startedAt && data.completedAt
          ? new Date(data.completedAt).getTime() - new Date(data.startedAt).getTime()
          : undefined;

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
        outputSummary: extractOutputSummary(data.output),
        durationMs,
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
