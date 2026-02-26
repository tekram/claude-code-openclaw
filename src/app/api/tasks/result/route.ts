import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';

const MAX_OUTPUT_BYTES = 50 * 1024; // 50KB safeguard

export interface TaskResult {
  status: 'running' | 'done' | 'error';
  output?: string;
  stderr?: string;
  exitCode?: number;
  startedAt: string;
  completedAt?: string;
  pid?: number;
  projectName?: string;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id || !/^[0-9a-f-]+$/i.test(id)) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  const resultPath = path.join(
    os.homedir(), '.openclaw', 'workspace', 'task-results', `${id}.json`
  );

  if (!fs.existsSync(resultPath)) {
    return NextResponse.json({ error: 'Result not found' }, { status: 404 });
  }

  try {
    const raw = fs.readFileSync(resultPath, 'utf-8');
    const result = JSON.parse(raw) as TaskResult;

    // Truncate output if needed
    if (result.output && Buffer.byteLength(result.output, 'utf-8') > MAX_OUTPUT_BYTES) {
      const truncated = Buffer.from(result.output, 'utf-8').slice(0, MAX_OUTPUT_BYTES).toString('utf-8');
      result.output = truncated + '\n\n[Output truncated at 50KB]';
    }

    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: 'Failed to read result' }, { status: 500 });
  }
}
