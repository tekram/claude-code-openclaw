import { existsSync, statSync } from 'fs';
import path from 'path';
import fs from 'fs';
import os from 'os';
import type { TodosData } from '@/types/todos';
import { CAPTURES_PATH, readCaptures, writeCaptures } from '@/lib/captures';

export async function GET() {
  try {
    const { items } = readCaptures();

    const lastUpdated = existsSync(CAPTURES_PATH)
      ? statSync(CAPTURES_PATH).mtime.toISOString()
      : new Date().toISOString();

    return Response.json(
      { items, lastUpdated } as TodosData,
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('Error reading captures:', error);
    return Response.json(
      { error: 'Failed to read captures' },
      { status: 500 }
    );
  }
}

// POST: Add a new item
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { text, project } = body as { text: string; project?: string };

    if (!text || !text.trim()) {
      return Response.json({ error: 'Text is required' }, { status: 400 });
    }

    const { items, headerLines } = readCaptures();
    items.push({ text: text.trim(), project: project?.trim() || undefined, completed: false, source: 'captures' });
    writeCaptures(items, headerLines);

    return Response.json({ ok: true, items }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Error adding capture:', error);
    return Response.json({ error: 'Failed to add item' }, { status: 500 });
  }
}

// PATCH: Update an item (toggle complete, edit text, edit project, promote, reorder)
export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { index, completed, text, project, promoted, reorder, targetPath } = body as {
      index?: number;
      completed?: boolean;
      text?: string;
      project?: string | null;
      promoted?: boolean;
      reorder?: number[];
      targetPath?: string; // explicit path override for promote (e.g. from picker modal)
    };

    const { items, headerLines } = readCaptures();

    // Reorder action
    if (Array.isArray(reorder)) {
      if (reorder.length !== items.length) {
        return Response.json({ error: 'Reorder array length mismatch' }, { status: 400 });
      }
      const reordered = reorder.map((i) => items[i]);
      writeCaptures(reordered, headerLines);
      return Response.json({ ok: true, items: reordered }, { headers: { 'Cache-Control': 'no-store' } });
    }

    if (typeof index !== 'number') {
      return Response.json({ error: 'Index is required' }, { status: 400 });
    }

    if (index < 0 || index >= items.length) {
      return Response.json({ error: 'Invalid index' }, { status: 400 });
    }

    if (typeof completed === 'boolean') items[index].completed = completed;
    if (typeof text === 'string') items[index].text = text.trim();
    if (project === null) items[index].project = undefined;
    else if (typeof project === 'string') items[index].project = project.trim() || undefined;

    // Promote: tag item text and write to a TODO.md
    if (promoted === true) {
      const originalText = items[index].text;
      items[index].text = originalText + ' _(promoted to TODO.md)_';
      writeCaptures(items, headerLines);

      // Resolve write destination:
      // 1. Explicit targetPath from picker modal
      // 2. Project tag → configured path lookup
      // 3. Fallback: ~/TODO.md
      let todoPath: string;
      try {
        if (targetPath) {
          todoPath = path.join(targetPath, 'TODO.md');
        } else {
          const itemProject = items[index].project;
          let resolvedProjectPath: string | undefined;
          if (itemProject) {
            const projectsPath = path.join(os.homedir(), '.openclaw', 'workspace', 'claude-dash-projects.json');
            if (existsSync(projectsPath)) {
              const projects = JSON.parse(fs.readFileSync(projectsPath, 'utf-8')) as Record<string, string>;
              resolvedProjectPath = projects[itemProject];
            }
          }
          todoPath = resolvedProjectPath
            ? path.join(resolvedProjectPath, 'TODO.md')
            : path.join(os.homedir(), 'TODO.md');
        }
        const todoLine = `\n- [ ] ${originalText}`;
        fs.appendFileSync(todoPath, todoLine, 'utf-8');
      } catch {
        // Graceful degradation — CAPTURES.md tag was already written
      }

      return Response.json({ ok: true, items }, { headers: { 'Cache-Control': 'no-store' } });
    }

    writeCaptures(items, headerLines);

    return Response.json({ ok: true, items }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Error updating capture:', error);
    return Response.json({ error: 'Failed to update item' }, { status: 500 });
  }
}

// DELETE: Remove item(s) by index or indices
export async function DELETE(request: Request) {
  try {
    const body = await request.json();
    const { index, indices } = body as { index?: number; indices?: number[] };

    const { items, headerLines } = readCaptures();

    if (Array.isArray(indices)) {
      // Bulk delete — sort descending to preserve index stability
      const sorted = [...indices].sort((a, b) => b - a);
      for (const i of sorted) {
        if (i >= 0 && i < items.length) {
          items.splice(i, 1);
        }
      }
    } else if (typeof index === 'number') {
      if (index < 0 || index >= items.length) {
        return Response.json({ error: 'Invalid index' }, { status: 400 });
      }
      items.splice(index, 1);
    } else {
      return Response.json({ error: 'index or indices is required' }, { status: 400 });
    }

    writeCaptures(items, headerLines);

    return Response.json({ ok: true, items }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Error deleting capture:', error);
    return Response.json({ error: 'Failed to delete item' }, { status: 500 });
  }
}
