import { watch, existsSync, readFileSync } from 'fs';
import path from 'path';
import os from 'os';
import type { TaskResult } from '../result/route';

export const dynamic = 'force-dynamic';

const MAX_OUTPUT_BYTES = 50 * 1024; // 50KB safeguard

function readResult(resultPath: string): TaskResult | null {
  try {
    const raw = readFileSync(resultPath, 'utf-8');
    const result = JSON.parse(raw) as TaskResult;
    if (result.output && Buffer.byteLength(result.output, 'utf-8') > MAX_OUTPUT_BYTES) {
      const truncated = Buffer.from(result.output, 'utf-8').slice(0, MAX_OUTPUT_BYTES).toString('utf-8');
      result.output = truncated + '\n\n[Output truncated at 50KB]';
    }
    return result;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id || !/^[0-9a-f-]+$/i.test(id)) {
    return new Response('id is required', { status: 400 });
  }

  const taskResultsDir = path.join(os.homedir(), '.openclaw', 'workspace', 'task-results');
  const resultPath = path.join(taskResultsDir, `${id}.json`);

  if (!existsSync(resultPath)) {
    return new Response('Result not found', { status: 404 });
  }

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const encode = (text: string) => new TextEncoder().encode(text);

      const sendResult = () => {
        if (closed) return;
        const result = readResult(resultPath);
        if (!result) return;
        try {
          controller.enqueue(encode(`data: ${JSON.stringify(result)}\n\n`));
          // Auto-close once the task reaches a terminal state
          if (result.status !== 'running') {
            closed = true;
            watcher?.close();
            clearInterval(heartbeat);
            try { controller.close(); } catch { /* already closed */ }
          }
        } catch { /* stream already closed by client */ }
      };

      // Send initial state immediately
      sendResult();
      if (closed) return; // already done — stream is closed

      // Watch the parent directory (safer on Windows: writeFileSync triggers 'rename')
      let watcher: ReturnType<typeof watch> | null = null;
      let debounceTimer: ReturnType<typeof setTimeout> | null = null;

      const scheduleUpdate = (filename: string | null) => {
        if (closed) return;
        if (filename && filename !== `${id}.json`) return; // ignore unrelated files
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(sendResult, 100);
      };

      try {
        watcher = watch(taskResultsDir, (_, filename) => scheduleUpdate(filename));
      } catch { /* fs.watch unavailable — client falls back to polling */ }

      // Heartbeat every 15s to keep the connection alive through proxies
      const heartbeat = setInterval(() => {
        if (!closed) {
          try {
            controller.enqueue(encode(': heartbeat\n\n'));
          } catch { /* stream closed */ }
        }
      }, 15_000);

      // Cleanup when client disconnects
      return () => {
        closed = true;
        if (debounceTimer) clearTimeout(debounceTimer);
        watcher?.close();
        clearInterval(heartbeat);
      };
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    },
  });
}
