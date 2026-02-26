import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { readCaptures, writeCaptures } from '@/lib/captures';
import { LOG_PATH } from '@/lib/sessions/parse';

function readJson(filePath: string): Record<string, unknown> | null {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch { return null; }
}

async function dispatchOpenClaw(body: {
  index: number;
  agentId: string;
  message: string;
}): Promise<NextResponse> {
  const { index, agentId, message } = body;

  if (typeof index !== 'number' || typeof agentId !== 'string' || !agentId ||
      typeof message !== 'string' || !message.trim()) {
    return NextResponse.json(
      { error: 'index (number), agentId (string), and message (string) are required' },
      { status: 400 }
    );
  }

  const configPath = process.env.OPENCLAW_CONFIG_PATH ||
    path.join(os.homedir(), '.openclaw', 'openclaw.json');
  const config = readJson(configPath);

  if (!config) {
    return NextResponse.json({ error: 'OpenClaw config not found' }, { status: 404 });
  }

  const gateway = (config.gateway as Record<string, unknown>) || {};
  const port = (gateway.port as number) || 18789;
  const auth = (gateway.auth as Record<string, unknown>) || {};
  const gatewayToken = (auth.token as string) || '';
  const hooksConfig = (config.hooks as Record<string, unknown>) || {};
  const hooksToken = (hooksConfig.token as string) || gatewayToken;
  const gatewayUrl = `http://127.0.0.1:${port}`;

  const res = await fetch(`${gatewayUrl}/hooks/agent`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${hooksToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: message.trim(),
      agentId,
      deliver: true,
      channel: 'last',
      name: 'ClaudeDashTask',
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    return NextResponse.json(
      { error: `Gateway error ${res.status}: ${errBody}` },
      { status: 502 }
    );
  }

  const { items, headerLines } = readCaptures();

  if (index < 0 || index >= items.length) {
    return NextResponse.json({ error: 'Invalid index' }, { status: 400 });
  }

  items[index].assignedTo = agentId;
  writeCaptures(items, headerLines);

  return NextResponse.json({ ok: true, items }, { headers: { 'Cache-Control': 'no-store' } });
}

async function dispatchClaude(body: {
  index: number;
  projectPath: string;
  task: string;
}): Promise<NextResponse> {
  const { index, projectPath, task } = body;

  if (typeof index !== 'number' ||
      typeof projectPath !== 'string' || !projectPath.trim() ||
      typeof task !== 'string' || !task.trim()) {
    return NextResponse.json(
      { error: 'index (number), projectPath (string), and task (string) are required' },
      { status: 400 }
    );
  }

  if (!fs.existsSync(projectPath)) {
    return NextResponse.json({ error: `Project path not found: ${projectPath}` }, { status: 400 });
  }

  const { items, headerLines } = readCaptures();

  if (index < 0 || index >= items.length) {
    return NextResponse.json({ error: 'Invalid index' }, { status: 400 });
  }

  const taskId = crypto.randomUUID();
  const projectName = path.basename(projectPath.trim()); // item 4: derive project name
  const taskResultsDir = path.join(os.homedir(), '.openclaw', 'workspace', 'task-results');
  fs.mkdirSync(taskResultsDir, { recursive: true });
  const resultPath = path.join(taskResultsDir, `${taskId}.json`);
  const startedAt = new Date().toISOString();

  const proc = spawn('claude', ['-p', task.trim(), '--dangerously-skip-permissions'], {
    cwd: projectPath.trim(),
    detached: true,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Item 1: write PID + projectName immediately so the result file is useful from the start
  fs.writeFileSync(resultPath, JSON.stringify({
    status: 'running',
    startedAt,
    pid: proc.pid,
    projectName,
  }), 'utf-8');

  // Item 2: incremental stdout — flush current output to result file every 2 seconds
  const chunks: Buffer[] = [];
  const flushInterval = setInterval(() => {
    if (chunks.length === 0) return;
    const partial = Buffer.concat(chunks).toString('utf-8');
    try {
      fs.writeFileSync(resultPath, JSON.stringify({
        status: 'running',
        output: partial || undefined,
        startedAt,
        pid: proc.pid,
        projectName,
      }), 'utf-8');
    } catch { /* ignore mid-write errors */ }
  }, 2000);

  proc.stdout!.on('data', (c: Buffer) => chunks.push(c));

  // Item 3: capture stderr separately
  const stderrChunks: Buffer[] = [];
  proc.stderr!.on('data', (c: Buffer) => stderrChunks.push(c));

  // Item 5: write a NOTE to sessions.log 2s after spawn so the session (started by the hook)
  // gets a [web-dispatch] marker that the SessionsPanel renders as a "From captures" badge.
  // 2s gives the SessionStart hook plenty of time to fire and write the START entry first.
  setTimeout(() => {
    try {
      const timestamp = new Date().toLocaleString('sv-SE');
      const entry = `[${timestamp}] NOTE ${projectName} [web-dispatch] taskId=${taskId}\n`;
      fs.appendFileSync(LOG_PATH, entry, 'utf-8');
    } catch { /* sessions.log may not exist yet; badge is optional */ }
  }, 2000);

  proc.on('close', (exitCode) => {
    clearInterval(flushInterval);

    const raw = Buffer.concat(chunks).toString('utf-8').trim();
    const MAX_BYTES = 50 * 1024;
    const output = Buffer.byteLength(raw, 'utf-8') > MAX_BYTES
      ? Buffer.from(raw, 'utf-8').slice(0, MAX_BYTES).toString('utf-8') + '\n\n[Output truncated at 50KB]'
      : raw;

    const stderrRaw = Buffer.concat(stderrChunks).toString('utf-8').trim();

    fs.writeFileSync(resultPath, JSON.stringify({
      status: exitCode === 0 ? 'done' : 'error',
      output: output || undefined,
      stderr: stderrRaw || undefined,
      exitCode: exitCode ?? -1,
      startedAt,
      completedAt: new Date().toISOString(),
      pid: proc.pid,
      projectName,
    }), 'utf-8');

    proc.unref();
  });

  items[index].assignedTo = 'claude';
  items[index].taskId = taskId;
  writeCaptures(items, headerLines);

  return NextResponse.json({ ok: true, taskId, items }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      index?: unknown;
      mode?: unknown;
      // openclaw fields
      agentId?: unknown;
      message?: unknown;
      // claude fields
      projectPath?: unknown;
      task?: unknown;
    };

    const mode = (body.mode as string) || 'openclaw';
    const index = body.index as number;

    if (typeof index !== 'number') {
      return NextResponse.json({ error: 'index (number) is required' }, { status: 400 });
    }

    if (mode === 'claude') {
      return dispatchClaude({
        index,
        projectPath: (body.projectPath as string) || '',
        task: (body.task as string) || '',
      });
    }

    // Default: openclaw
    return dispatchOpenClaw({
      index,
      agentId: (body.agentId as string) || '',
      message: (body.message as string) || '',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
