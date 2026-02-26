import { readFileSync, existsSync } from 'fs';
import { LOG_PATH, parseLogLines } from '@/lib/sessions/parse';
import type { Session } from '@/types/sessions';

function sessionsToCSV(sessions: Session[]): string {
  const headers = [
    'project',
    'status',
    'startTime',
    'endTime',
    'lastActivityTime',
    'durationMs',
    'interruptReason',
    'details',
    'dismissedAt',
  ];

  const rows = sessions.map((s) =>
    [
      s.project,
      s.status,
      s.startTime,
      s.endTime || '',
      s.lastActivityTime || '',
      s.durationMs || '',
      s.interruptReason || '',
      (s.details || '').replace(/"/g, '""'), // Escape quotes
      s.dismissedAt || '',
    ].map((v) => `"${v}"`)
  );

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const format = searchParams.get('format') || 'json'; // json or csv
    const project = searchParams.get('project'); // optional project filter

    if (!existsSync(LOG_PATH)) {
      return Response.json({ sessions: [] });
    }

    const logContent = readFileSync(LOG_PATH, 'utf-8').replace(/\r\n/g, '\n');
    const lines = logContent.trim().split('\n').filter((l) => l);
    const allSessions = parseLogLines(lines);

    // Filter by project if requested
    const filteredSessions = project
      ? allSessions.filter((s) => s.project === project)
      : allSessions;

    // Return in requested format
    if (format === 'csv') {
      const csv = sessionsToCSV(filteredSessions);
      return new Response(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="sessions-${project || 'all'}-${new Date().toISOString().split('T')[0]}.csv"`,
        },
      });
    }

    return Response.json(
      { sessions: filteredSessions, count: filteredSessions.length },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('Error exporting sessions:', error);
    return Response.json({ error: 'Failed to export sessions' }, { status: 500 });
  }
}
