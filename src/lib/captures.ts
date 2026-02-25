import { readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';
import type { TodoItem } from '@/types/todos';

export const CAPTURES_PATH = path.join(
  process.env.HOME || process.env.USERPROFILE || '',
  'CAPTURES.md'
);

export const CAPTURES_HEADER = `# Captures — Quick Ideas from Telegram

Quick captures via OpenClaw from Telegram. Review regularly and promote promising items elsewhere when ready.

## Ideas\n`;

export function formatItem(item: TodoItem): string {
  const check = item.completed ? 'x' : ' ';
  const projectTag = item.project ? ` _(from ${item.project})_` : '';
  const assignedTag = item.assignedTo ? ` _(assigned: ${item.assignedTo})_` : '';
  const taskIdTag = item.taskId ? ` _(taskid: ${item.taskId})_` : '';
  return `- [${check}] ${item.text}${projectTag}${assignedTag}${taskIdTag}`;
}

export function readCaptures(): { items: TodoItem[]; rawLines: string[]; headerLines: string[] } {
  if (!existsSync(CAPTURES_PATH)) {
    return { items: [], rawLines: [], headerLines: CAPTURES_HEADER.split('\n') };
  }

  const content = readFileSync(CAPTURES_PATH, 'utf-8').replace(/\r\n/g, '\n');
  const allLines = content.split('\n');

  const headerLines: string[] = [];
  const itemLines: string[] = [];
  let inItems = false;

  for (const line of allLines) {
    if (!inItems) {
      headerLines.push(line);
      if (line.match(/^##\s/)) {
        inItems = true;
      }
    } else {
      itemLines.push(line);
    }
  }

  const items: TodoItem[] = [];

  for (const line of itemLines) {
    const match = line.match(/^-\s+\[([ x])\]\s+(.+)$/);
    if (!match) continue;

    const completed = match[1] === 'x';
    let text = match[2].trim();
    let project: string | undefined;
    let assignedTo: string | undefined;

    // Extract _(from project)_ tag
    const projectMatch = text.match(/\s*_\(from\s+(.+?)\)_/);
    if (projectMatch) {
      project = projectMatch[1];
      text = text.replace(projectMatch[0], '').trim();
    }

    // Extract _(assigned: agentId)_ tag
    const assignedMatch = text.match(/\s*_\(assigned:\s*(.+?)\)_/);
    if (assignedMatch) {
      assignedTo = assignedMatch[1].trim();
      text = text.replace(assignedMatch[0], '').trim();
    }

    // Extract _(taskid: uuid)_ tag
    let taskId: string | undefined;
    const taskIdMatch = text.match(/\s*_\(taskid:\s*(.+?)\)_/);
    if (taskIdMatch) {
      taskId = taskIdMatch[1].trim();
      text = text.replace(taskIdMatch[0], '').trim();
    }

    items.push({ text, project, assignedTo, taskId, completed, source: 'captures' });
  }

  return { items, rawLines: allLines, headerLines };
}

export function writeCaptures(items: TodoItem[], headerLines: string[]) {
  const itemLines = items.map(formatItem);
  const content = headerLines.join('\n') + '\n' + itemLines.join('\n') + '\n';
  writeFileSync(CAPTURES_PATH, content, 'utf-8');
}
