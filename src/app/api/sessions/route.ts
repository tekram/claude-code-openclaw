import { appendFileSync } from 'fs';
import { parseSessions, LOG_PATH } from '@/lib/sessions/parse';

export async function GET() {
  try {
    const data = parseSessions();
    return Response.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Error reading sessions:', error);
    return Response.json({ error: 'Failed to read sessions' }, { status: 500 });
  }
}

function logSessionAction(action: string, project: string, details?: string) {
  const now = new Date();
  const timestamp = now.toLocaleString('sv-SE');
  const detailsStr = details ? ` ${details}` : '';
  const entry = `[${timestamp}] ${action} ${project}${detailsStr}\n`;
  appendFileSync(LOG_PATH, entry, 'utf-8');
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, project, details } = body;

    if (!action || !project) {
      return Response.json(
        { error: 'Missing required fields: action, project' },
        { status: 400 }
      );
    }

    switch (action) {
      case 'dismiss':
        logSessionAction('DISMISSED', project, details || 'User dismissed');
        break;

      case 'resume':
        logSessionAction('RESUMED', project, details || 'Resumed from UI');
        break;

      case 'markDone':
        logSessionAction('DONE', project, details || 'Marked complete from UI');
        break;

      case 'addNote':
        if (!details) {
          return Response.json({ error: 'Note details required' }, { status: 400 });
        }
        logSessionAction('NOTE', project, details);
        break;

      default:
        return Response.json({ error: 'Invalid action' }, { status: 400 });
    }

    return Response.json({ success: true });
  } catch (error) {
    console.error('Error handling session action:', error);
    return Response.json({ error: 'Failed to process action' }, { status: 500 });
  }
}
