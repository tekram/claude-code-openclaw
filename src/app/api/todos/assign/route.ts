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

  // Strip ALL Claude Code session env vars so the spawned process isn't rejected as a nested session.
  // env | grep -i claude shows: CLAUDECODE=1, CLAUDE_CODE_ENTRYPOINT=cli, CLAUDE_CODE_SESSION_ID
  const spawnEnv = { ...process.env };
  delete spawnEnv.CLAUDECODE;
  delete spawnEnv.CLAUDE_CODE_ENTRYPOINT;
  delete spawnEnv.CLAUDE_CODE_SESSION_ID;

  // Claude Code requires stdin:'inherit' — piping/ignoring stdin causes it to hang or exit 1.
  // windowsHide prevents a console window popping up on Windows.
  // No detached:true so we don't get a new console window; unref() keeps it independent.
  const proc = spawn('claude', [
    '--print', task.trim(),
    '--dangerously-skip-permissions',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
  ], {
    cwd: projectPath.trim(),
    shell: true,
    windowsHide: true,
    stdio: ['inherit', 'pipe', 'pipe'],
    env: spawnEnv,
  });

  // Write PID + projectName immediately so the result file is useful from the start
  fs.writeFileSync(resultPath, JSON.stringify({
    status: 'running',
    startedAt,
    pid: proc.pid,
    projectName,
  }), 'utf-8');

  const MAX_BYTES = 50 * 1024;

  // Parse NDJSON events from stdout; write to result file on each text chunk (debounced).
  // rawStdout is kept as a fallback so that plain-text error messages (e.g. nested session
  // guard) are visible in the result even when no valid JSON events are parsed.
  let lineBuffer = '';
  let latestText = '';
  let rawStdout = '';
  let writeDebounce: ReturnType<typeof setTimeout> | null = null;

  const flushWrite = () => {
    const raw = latestText;
    const output = Buffer.byteLength(raw, 'utf-8') > MAX_BYTES
      ? Buffer.from(raw, 'utf-8').slice(0, MAX_BYTES).toString('utf-8') + '\n\n[Output truncated at 50KB]'
      : raw;
    try {
      fs.writeFileSync(resultPath, JSON.stringify({
        status: 'running',
        output: output || undefined,
        startedAt,
        pid: proc.pid,
        projectName,
      }), 'utf-8');
    } catch { /* ignore mid-write errors */ }
  };

  const scheduleWrite = () => {
    if (writeDebounce) clearTimeout(writeDebounce);
    writeDebounce = setTimeout(flushWrite, 150);
  };

  proc.stdout!.on('data', (chunk: Buffer) => {
    rawStdout += chunk.toString('utf-8');
    lineBuffer += chunk.toString('utf-8');
    const lines = lineBuffer.split('\n');
    lineBuffer = lines.pop() ?? ''; // keep any incomplete trailing line

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as Record<string, unknown>;
        if (event.type === 'assistant') {
          // Each assistant event contains the full text accumulated so far
          const msg = event.message as { content?: Array<{ type: string; text?: string }> } | undefined;
          const text = msg?.content
            ?.filter((c) => c.type === 'text')
            .map((c) => c.text ?? '')
            .join('') ?? '';
          if (text) {
            latestText = text;
            scheduleWrite();
          }
        } else if (event.type === 'result') {
          // Final result event — use its result field as the authoritative output
          if (writeDebounce) clearTimeout(writeDebounce);
          const resultText = (event.result as string) || latestText;
          if (resultText) latestText = resultText;
        }
      } catch { /* ignore non-JSON lines */ }
    }
  });

  // Capture stderr separately (tool errors, API errors, etc.)
  const stderrChunks: Buffer[] = [];
  proc.stderr!.on('data', (c: Buffer) => stderrChunks.push(c));

  // Write a NOTE to sessions.log 2s after spawn so the session gets a [web-dispatch] badge.
  setTimeout(() => {
    try {
      const timestamp = new Date().toLocaleString('sv-SE');
      const entry = `[${timestamp}] NOTE ${projectName} [web-dispatch] taskId=${taskId}\n`;
      fs.appendFileSync(LOG_PATH, entry, 'utf-8');
    } catch { /* sessions.log may not exist yet; badge is optional */ }
  }, 2000);

  proc.on('close', (exitCode) => {
    if (writeDebounce) clearTimeout(writeDebounce);

    // Prefer parsed assistant text; fall back to raw stdout so error messages are visible
    const raw = (latestText || rawStdout).trim();
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
