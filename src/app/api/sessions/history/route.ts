import { readFileSync, existsSync } from 'fs';
import { LOG_PATH, parseLogLines, parseTimestamp } from '@/lib/sessions/parse';
import type { Session } from '@/types/sessions';

export interface HistoryResponse {
  sessions: Session[];
  total: number;
  limit: number;
  offset: number;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const search = (searchParams.get('search') || '').toLowerCase().trim();
    const projectFilter = searchParams.get('project') || '';
    const statusFilter = searchParams.get('status') || 'all';
    const fromDate = searchParams.get('from') || '';   // YYYY-MM-DD
    const toDate = searchParams.get('to') || '';       // YYYY-MM-DD
    const limit = Math.max(1, Math.min(200, parseInt(searchParams.get('limit') || '50', 10)));
    const offset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10));

    if (!existsSync(LOG_PATH)) {
      return Response.json({ sessions: [], total: 0, limit, offset } satisfies HistoryResponse, {
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    const content = readFileSync(LOG_PATH, 'utf-8').replace(/\r\n/g, '\n');
    const lines = content.trim().split('\n').filter((l) => l);
    const allSessions = parseLogLines(lines);

    // Build date boundaries (compare against startTime substring)
    const fromMs = fromDate ? new Date(fromDate + 'T00:00:00').getTime() : 0;
    const toMs = toDate ? new Date(toDate + 'T23:59:59').getTime() : Infinity;

    // Filter
    const filtered = allSessions.filter((s) => {
      // Project filter
      if (projectFilter && s.project !== projectFilter) return false;

      // Status filter
      if (statusFilter !== 'all' && s.status !== statusFilter) return false;

      // Date range
      const startMs = parseTimestamp(s.startTime);
      if (startMs < fromMs || startMs > toMs) return false;

      // Text search (project name + details)
      if (search) {
        const haystack = `${s.project} ${s.details || ''} ${(s.notes || []).join(' ')}`.toLowerCase();
        if (!haystack.includes(search)) return false;
      }

      return true;
    });

    // Sort: newest start time first
    filtered.sort((a, b) => parseTimestamp(b.startTime) - parseTimestamp(a.startTime));

    const total = filtered.length;
    const page = filtered.slice(offset, offset + limit);

    return Response.json(
      { sessions: page, total, limit, offset } satisfies HistoryResponse,
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    console.error('Error querying session history:', err);
    return Response.json({ error: 'Failed to query history' }, { status: 500 });
  }
}
