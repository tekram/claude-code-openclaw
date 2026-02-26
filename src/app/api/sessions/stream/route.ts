import { watch, existsSync } from 'fs';
import { parseSessions, LOG_PATH, SESSION_OWNER_DIR } from '@/lib/sessions/parse';

export const dynamic = 'force-dynamic';

export async function GET() {
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;

      const encode = (text: string) => new TextEncoder().encode(text);

      const sendData = () => {
        if (closed) return;
        try {
          const data = parseSessions();
          controller.enqueue(encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Ignore parse errors — next change will retry
        }
      };

      // Send initial data immediately
      sendData();

      // Debounced update: coalesce rapid file changes into one parse
      let debounceTimer: ReturnType<typeof setTimeout> | null = null;
      const scheduleUpdate = () => {
        if (closed) return;
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(sendData, 200);
      };

      // Watch log file for new session events
      let logWatcher: ReturnType<typeof watch> | null = null;
      if (existsSync(LOG_PATH)) {
        try {
          logWatcher = watch(LOG_PATH, scheduleUpdate);
        } catch { /* fs.watch unavailable — fall back to client-side polling */ }
      }

      // Watch session owner dir for activity file changes (.activity, .json)
      let dirWatcher: ReturnType<typeof watch> | null = null;
      if (existsSync(SESSION_OWNER_DIR)) {
        try {
          dirWatcher = watch(SESSION_OWNER_DIR, scheduleUpdate);
        } catch { /* ignore */ }
      }

      // Heartbeat every 30s to keep the connection alive through proxies
      const heartbeatInterval = setInterval(() => {
        if (!closed) {
          try {
            controller.enqueue(encode(': heartbeat\n\n'));
          } catch { /* stream closed */ }
        }
      }, 30_000);

      // Cleanup when client disconnects
      return () => {
        closed = true;
        if (debounceTimer) clearTimeout(debounceTimer);
        logWatcher?.close();
        dirWatcher?.close();
        clearInterval(heartbeatInterval);
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
