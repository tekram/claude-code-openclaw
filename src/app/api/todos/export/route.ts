import { NextResponse } from 'next/server';
import { readCaptures } from '@/lib/captures';
import type { TodoItem } from '@/types/todos';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const format = searchParams.get('format') || 'json';
  const project = searchParams.get('project') || null;

  try {
    const { items } = readCaptures();
    const filtered = project ? items.filter((i) => i.project === project) : items;

    if (format === 'csv') {
      const header = 'text,project,assignedTo,taskId,completed,source';
      const rows = filtered.map((item: TodoItem) =>
        [
          csvCell(item.text),
          csvCell(item.project || ''),
          csvCell(item.assignedTo || ''),
          csvCell(item.taskId || ''),
          item.completed ? 'true' : 'false',
          csvCell(item.source),
        ].join(',')
      );
      const csv = [header, ...rows].join('\n');

      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="captures${project ? `-${project}` : ''}.csv"`,
          'Cache-Control': 'no-store',
        },
      });
    }

    return NextResponse.json(filtered, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('Error exporting captures:', error);
    return NextResponse.json({ error: 'Failed to export captures' }, { status: 500 });
  }
}

function csvCell(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
