import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { TaskResult } from '@/app/api/tasks/result/route';

export async function POST(request: Request) {
  try {
    const body = await request.json() as { id?: string };
    const { id } = body;

    if (!id || !/^[0-9a-f-]+$/i.test(id)) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const resultPath = path.join(
      os.homedir(), '.openclaw', 'workspace', 'task-results', `${id}.json`
    );

    if (!fs.existsSync(resultPath)) {
      return NextResponse.json({ error: 'Result not found' }, { status: 404 });
    }

    const raw = fs.readFileSync(resultPath, 'utf-8');
    const result = JSON.parse(raw) as TaskResult;

    if (result.status !== 'running') {
      return NextResponse.json({ error: 'Task is not running' }, { status: 409 });
    }

    if (result.pid) {
      try {
        process.kill(result.pid, 'SIGTERM');
      } catch {
        // ESRCH means process already gone — that's fine
      }
    }

    const updated: TaskResult = {
      ...result,
      status: 'error',
      exitCode: -1,
      completedAt: new Date().toISOString(),
    };

    fs.writeFileSync(resultPath, JSON.stringify(updated, null, 2), 'utf-8');

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Error cancelling task:', error);
    return NextResponse.json({ error: 'Failed to cancel task' }, { status: 500 });
  }
}
