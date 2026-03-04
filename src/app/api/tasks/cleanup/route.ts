import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const maxAgeDays = parseInt(searchParams.get('maxAgeDays') || '30', 10);

    const taskResultsDir = path.join(os.homedir(), '.openclaw', 'workspace', 'task-results');

    if (!fs.existsSync(taskResultsDir)) {
      return NextResponse.json({ ok: true, deleted: 0 });
    }

    const files = fs.readdirSync(taskResultsDir).filter((f) => f.endsWith('.json'));
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;

    let deleted = 0;
    for (const file of files) {
      const filePath = path.join(taskResultsDir, file);
      try {
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs < cutoff) {
          fs.unlinkSync(filePath);
          deleted++;
        }
      } catch {
        // Skip files we can't stat/delete
      }
    }

    return NextResponse.json({ ok: true, deleted });
  } catch (error) {
    console.error('Error cleaning up task results:', error);
    return NextResponse.json({ error: 'Failed to clean up task results' }, { status: 500 });
  }
}
